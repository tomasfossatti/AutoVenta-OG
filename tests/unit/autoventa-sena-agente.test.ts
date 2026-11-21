/**
 * A FERRAMENTA DA SEÑA PELO AGENTE — fork AutoVenta, etapa 3, parte 2.
 *
 * Um caso por requisito:
 *   (a) sem seña (ou só anulada): nada de "quedó reservada";
 *   (b) seña vigente: a unidade e os trâmites da condição dela (usado → 08 e
 *       transferência; 0 km → emplacamento), e NUNCA o monto nem a data de
 *       entrega combinada;
 *   (c) entregue: `entregado` e a instrução de passar a um vendedor;
 *   (d) negócio de outro cliente (ou de outra agência): a mesma recusa;
 *   (e) é leitura: a ferramenta não escreve nada.
 *
 * Não se mocka a regra (`lib/autoventa/sena.ts`): só o banco (dublê de duas
 * empresas).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoDeDuasEmpresas } from "@/tests/helpers/postgrest-de-duas-empresas";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));

const { autoventaVerCierre } = await import("@/lib/mcp/tools/autoventa");

const ORG_A = "org-a";
const ORG_B = "org-b";
const CONTATO = "contato-1";
const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD_OUTRO_CLIENTE = "22222222-2222-4222-8222-222222222222";
const LEAD_OUTRA_AGENCIA = "33333333-3333-4333-8333-333333333333";
const HILUX = "44444444-4444-4444-8444-444444444444";

function montar() {
  const banco = bancoDeDuasEmpresas({
    organizations: [
      { id: ORG_A, timezone: "America/Argentina/Buenos_Aires" },
      { id: ORG_B, timezone: "America/Argentina/Buenos_Aires" },
    ],
    contacts: [
      { id: CONTATO, organization_id: ORG_A, is_personal: false },
      { id: "contato-2", organization_id: ORG_A, is_personal: false },
    ],
    crm_leads: [
      { id: LEAD, organization_id: ORG_A, contact_id: CONTATO },
      { id: LEAD_OUTRO_CLIENTE, organization_id: ORG_A, contact_id: "contato-2" },
      { id: LEAD_OUTRA_AGENCIA, organization_id: ORG_B, contact_id: CONTATO },
    ],
    catalog_vehicle_details: [{ product_id: HILUX, organization_id: ORG_A, condicion: "usado", estado: "senado" }],
    autoventa_senas: [],
    autoventa_cierres: [],
  });
  const ctx = {
    organizationId: ORG_A,
    contatoDoTurno: CONTATO,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agente-1" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: banco.cliente,
  } as unknown as Parameters<typeof autoventaVerCierre.handler>[1];
  return { banco, ctx };
}

const SENA = {
  organization_id: ORG_A,
  lead_id: LEAD,
  product_id: HILUX,
  unidad_descripcion: "Toyota Hilux SRV 2021",
  monto_cents: 50_000_000,
  moneda: "ARS",
  fecha: "2026-11-20",
};

let banco: ReturnType<typeof montar>["banco"];
let ctx: ReturnType<typeof montar>["ctx"];
beforeEach(() => {
  ({ banco, ctx } = montar());
});

describe("autoventa_ver_cierre", () => {
  it("(a) sem seña, ou só anulada: sin_sena, sem unidade", async () => {
    const vazio = (await autoventaVerCierre.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(vazio).toMatchObject({ sena: "sin_sena" });
    expect(vazio).not.toHaveProperty("unidad");

    banco.semear("autoventa_senas", [
      { ...SENA, id: "s0", estado: "anulada", motivo_anulacion: "se arrepintió", created_at: "2026-11-19T00:00:00Z" },
    ]);
    const anulada = (await autoventaVerCierre.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(anulada).toMatchObject({ sena: "sin_sena" });
    expect(JSON.stringify(anulada)).not.toMatch(/arrepinti/);
  });

  it("(b) vigente: unidade e trâmites do usado, sem monto nem data de entrega", async () => {
    banco.semear("autoventa_senas", [{ ...SENA, id: "s1", estado: "vigente", created_at: "2026-11-20T00:00:00Z" }]);
    banco.semear("autoventa_cierres", [
      {
        lead_id: LEAD, organization_id: ORG_A, dominio: "AB123CD", formulario_08: "firmado",
        transferencia: "en_tramite", patentamiento: "pendiente", entrega_programada: "2026-11-30", entregado_en: null,
      },
    ]);
    const r = (await autoventaVerCierre.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({
      sena: "vigente",
      unidad: "Toyota Hilux SRV 2021",
      tramites: { formulario_08: "firmado", transferencia: "en trámite" },
      dominio_asignado: true,
      entregado: false,
    });
    expect(r.tramites).not.toHaveProperty("patentamiento");
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/2026-11-30|30\/11|500\.000|50000000|AB123CD/);
    expect(String(r.instruccion)).toContain("nunca prometas ni estimes una fecha de entrega");
  });

  it("(b) 0 km: só o emplacamento", async () => {
    banco.semear("catalog_vehicle_details", [{ product_id: "okm", organization_id: ORG_A, condicion: "0km", estado: "senado" }]);
    banco.semear("autoventa_senas", [{ ...SENA, id: "s2", product_id: "okm", estado: "vigente", created_at: "2026-11-20T00:00:00Z" }]);
    const r = (await autoventaVerCierre.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r.tramites).toEqual({ patentamiento: "pendiente" });
  });

  it("(c) entregue", async () => {
    banco.semear("autoventa_senas", [{ ...SENA, id: "s3", estado: "aplicada", created_at: "2026-11-20T00:00:00Z" }]);
    banco.semear("autoventa_cierres", [
      {
        lead_id: LEAD, organization_id: ORG_A, dominio: "AB123CD", formulario_08: "certificado",
        transferencia: "inscripta", patentamiento: "pendiente", entrega_programada: null, entregado_en: "2026-11-21",
      },
    ]);
    const r = (await autoventaVerCierre.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({ sena: "aplicada", entregado: true });
    expect(JSON.stringify(r)).not.toMatch(/2026-11-21/);
  });

  it("(d) negócio de outro cliente ou de outra agência: a mesma recusa", async () => {
    banco.semear("autoventa_senas", [
      { ...SENA, id: "alheia", organization_id: ORG_B, lead_id: LEAD_OUTRA_AGENCIA, estado: "vigente", created_at: "2026-11-20T00:00:00Z" },
    ]);
    const outroCliente = await autoventaVerCierre.handler({ lead_id: LEAD_OUTRO_CLIENTE }, ctx);
    const outraAgencia = await autoventaVerCierre.handler({ lead_id: LEAD_OUTRA_AGENCIA }, ctx);
    expect(outroCliente).toEqual(outraAgencia);
    expect(outroCliente).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
  });

  it("(e) é só leitura", async () => {
    banco.semear("autoventa_senas", [{ ...SENA, id: "s4", estado: "vigente", created_at: "2026-11-20T00:00:00Z" }]);
    await autoventaVerCierre.handler({ lead_id: LEAD }, ctx);
    expect(banco.escritas()).toHaveLength(0);
    expect(autoventaVerCierre.category).toBe("read");
  });
});
