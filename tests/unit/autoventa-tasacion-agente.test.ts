/**
 * AS FERRAMENTAS DA TASAÇÃO PELO AGENTE — fork AutoVenta, etapa 3.
 *
 * O que sustenta a entrega, um caso por requisito:
 *   (a) sem tasação vigente, a resposta NÃO traz número — nem o de uma
 *       tasação anterior;
 *   (b) vigente, traz o valor e o vencimento;
 *   (c) o negócio de outro cliente (ou de outra agência) recebe a mesma
 *       recusa, sem escrever nada;
 *   (d) pedir duas vezes não cria dois pedidos, e o pedido nasce sem valor e
 *       com origem `agente`;
 *   (e) com tasação vigente, pedir não abre outra.
 *
 * Não se mocka a regra (`lib/autoventa/tasacion.ts`) nem o schema das
 * ferramentas: só o banco (dublê de duas empresas) e as bordas de auditoria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoDeDuasEmpresas } from "@/tests/helpers/postgrest-de-duas-empresas";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));

const { autoventaPedirTasacion, autoventaVerTasacion } = await import("@/lib/mcp/tools/autoventa");

const ORG_A = "org-a";
const ORG_B = "org-b";
const CONTATO = "contato-1";
const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD_OUTRO_CLIENTE = "22222222-2222-4222-8222-222222222222";
const LEAD_OUTRA_AGENCIA = "33333333-3333-4333-8333-333333333333";

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
    autoventa_tasaciones: [],
  });
  const ctx = {
    organizationId: ORG_A,
    contatoDoTurno: CONTATO,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agente-1" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: banco.cliente,
  } as unknown as Parameters<typeof autoventaVerTasacion.handler>[1];
  return { banco, ctx };
}

function hojeEmBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}
function emDias(dias: number): string {
  const [a, m, d] = hojeEmBuenosAires().split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

let banco: ReturnType<typeof montar>["banco"];
let ctx: ReturnType<typeof montar>["ctx"];
beforeEach(() => {
  ({ banco, ctx } = montar());
});

describe("autoventa_ver_tasacion", () => {
  it("(a) sem tasação: sem número, e a instrução manda pedir", async () => {
    const r = (await autoventaVerTasacion.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r.situacion).toBe("sin_tasacion");
    expect(r).not.toHaveProperty("valor");
    expect(String(r.instruccion)).toContain("autoventa_pedir_tasacion");
  });

  it("(a) vencida: sem número, nem o da tasação anterior", async () => {
    banco.semear("autoventa_tasaciones", [
      {
        id: "velha", organization_id: ORG_A, lead_id: LEAD, estado: "tasado", valor_cents: 1_100_000_000,
        moneda: "ARS", vence_en: emDias(30), created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "nova", organization_id: ORG_A, lead_id: LEAD, estado: "tasado", valor_cents: 1_200_000_000,
        moneda: "ARS", vence_en: emDias(-1), created_at: "2026-02-01T00:00:00Z",
      },
    ]);
    const r = (await autoventaVerTasacion.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r.situacion).toBe("vencida");
    expect(JSON.stringify(r)).not.toMatch(/11\.000\.000|12\.000\.000/);
  });

  it("(b) vigente: o valor na moeda da tasação e o vencimento", async () => {
    banco.semear("autoventa_tasaciones", [
      {
        id: "t", organization_id: ORG_A, lead_id: LEAD, estado: "tasado", valor_cents: 900_000,
        moneda: "USD", vence_en: emDias(3), created_at: "2026-02-01T00:00:00Z",
      },
    ]);
    const r = (await autoventaVerTasacion.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r.situacion).toBe("vigente");
    expect(String(r.valor)).toMatch(/US\$/);
    expect(r.vence_en).toBe(emDias(3));
  });

  it("(c) negócio de outro cliente ou de outra agência: a mesma recusa", async () => {
    banco.semear("autoventa_tasaciones", [
      {
        id: "alheia", organization_id: ORG_B, lead_id: LEAD_OUTRA_AGENCIA, estado: "tasado", valor_cents: 500_000,
        moneda: "USD", vence_en: emDias(3), created_at: "2026-02-01T00:00:00Z",
      },
    ]);
    const outroCliente = await autoventaVerTasacion.handler({ lead_id: LEAD_OUTRO_CLIENTE }, ctx);
    const outraAgencia = await autoventaVerTasacion.handler({ lead_id: LEAD_OUTRA_AGENCIA }, ctx);
    expect(outroCliente).toEqual(outraAgencia);
    expect(outroCliente).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(JSON.stringify(outraAgencia)).not.toMatch(/5\.000/);
  });
});

describe("autoventa_pedir_tasacion", () => {
  it("(d) o pedido nasce sem valor, com origem agente, e pedir de novo não duplica", async () => {
    const r1 = (await autoventaPedirTasacion.handler({ lead_id: LEAD, resumen: "Cruze LTZ 2017, 85 mil km" }, ctx)) as Record<string, unknown>;
    const r2 = (await autoventaPedirTasacion.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r1).toMatchObject({ pedida: true, ya_existia: false });
    expect(r2).toMatchObject({ pedida: true, ya_existia: true });
    const linhas = banco.linhas("autoventa_tasaciones");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ estado: "pendiente", origen: "agente", notas: "Cruze LTZ 2017, 85 mil km" });
    expect(linhas[0]).not.toHaveProperty("valor_cents");
  });

  it("(e) com tasação vigente, não abre outra", async () => {
    banco.semear("autoventa_tasaciones", [
      {
        id: "t", organization_id: ORG_A, lead_id: LEAD, estado: "tasado", valor_cents: 1_200_000_000,
        moneda: "ARS", vence_en: emDias(3), created_at: "2026-02-01T00:00:00Z",
      },
    ]);
    const r = (await autoventaPedirTasacion.handler({ lead_id: LEAD }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({ pedida: false, motivo: "ya_hay_tasacion_vigente", situacion: "vigente" });
    expect(banco.contar("autoventa_tasaciones")).toBe(1);
  });

  it("(c) negócio de outro cliente: recusa e não escreve", async () => {
    const r = await autoventaPedirTasacion.handler({ lead_id: LEAD_OUTRO_CLIENTE }, ctx);
    expect(r).toMatchObject({ permitido: false, motivo: "fora_da_conversa" });
    expect(banco.escritas()).toHaveLength(0);
  });
});
