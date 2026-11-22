/**
 * O CAMPO `file` ESCONDIDO PELA CONDIÇÃO NÃO APARECE NO CARD (fork AutoVenta).
 *
 * O caso real: "Fotos del usado" (`usado_fotos`, migration 9904) só aparece na
 * ficha quando "¿Entrega usado?" é sim. O card do quadro ignorava a condição e
 * mostrava "0 · Fotos del usado · Ningún archivo adjunto" em TODA operação do
 * embudo Ventas — documento faltando num negócio sem usado nenhum.
 */
import { describe, expect, it } from "vitest";

import { anexarAnexosAosNegocios } from "@/lib/kanban/anexos-no-card";

const ENTREGA = { key: "usado_entrega", label: "¿Entrega usado?", type: "boolean" as const };
const FOTOS = {
  key: "usado_fotos",
  label: "Fotos del usado",
  type: "file" as const,
  mostrar_quando: { campo: "usado_entrega", igual: true },
};
const CONTRATO = { key: "contrato", label: "Contrato", type: "file" as const };
const TODOS = [ENTREGA, FOTOS, CONTRATO];

const negocio = (id: string, custom_fields: Record<string, unknown>) => ({ id, custom_fields });
const chaves = (lead: { anexos?: Array<{ campo: string }> }) => (lead.anexos ?? []).map((a) => a.campo);

describe("arquivo no card respeita mostrar_quando", () => {
  it("sem usado, o campo das fotos some; o campo sem condição continua (vazio aparece)", () => {
    const [lead] = anexarAnexosAosNegocios([negocio("a", {})], [], [FOTOS, CONTRATO], TODOS);
    expect(chaves(lead!)).toEqual(["contrato"]);
  });

  it("com usado, o campo das fotos aparece, mesmo vazio", () => {
    const [lead] = anexarAnexosAosNegocios([negocio("b", { usado_entrega: true })], [], [FOTOS, CONTRATO], TODOS);
    expect(chaves(lead!)).toEqual(["usado_fotos", "contrato"]);
  });

  it("cada card decide pelo PRÓPRIO negócio", () => {
    const leads = anexarAnexosAosNegocios(
      [negocio("sem", { usado_entrega: false }), negocio("com", { usado_entrega: true })],
      [],
      [FOTOS, CONTRATO],
      TODOS,
    );
    expect(leads.map(chaves)).toEqual([["contrato"], ["usado_fotos", "contrato"]]);
  });

  it("sem a lista inteira dos campos, o comportamento é o de antes", () => {
    const [lead] = anexarAnexosAosNegocios([negocio("c", {})], [], [FOTOS, CONTRATO]);
    expect(chaves(lead!)).toEqual(["usado_fotos", "contrato"]);
  });
});
