import { describe, expect, it } from "vitest";

import {
  actualizarTasacionSchema,
  crearTasacionSchema,
  funilTemUsado,
  hojeNoFuso,
  motivoDoErroDaTasacion,
  ordenarTasaciones,
  situacaoDaTasacion,
  somarDias,
  tasacionParaOAgente,
  type TasacionGuardada,
} from "./tasacion";

function tasacion(over: Partial<TasacionGuardada>): TasacionGuardada {
  return {
    id: "t1",
    lead_id: "l1",
    estado: "tasado",
    valor_cents: 1_200_000_000,
    moneda: "ARS",
    vence_en: "2026-11-28",
    notas: null,
    origen: "persona",
    creada_por: null,
    tasada_por: null,
    tasada_en: "2026-11-21T15:00:00Z",
    created_at: "2026-11-21T15:00:00Z",
    ...over,
  };
}

describe("a situação da tasação, lida no dia da agência", () => {
  it("o dia do vencimento ainda vale; o dia seguinte já venceu", () => {
    const t = tasacion({});
    expect(situacaoDaTasacion(t, "2026-11-28")).toBe("vigente");
    expect(situacaoDaTasacion(t, "2026-11-29")).toBe("vencida");
  });

  it("pendente, aceita e recusada não dependem da data", () => {
    expect(situacaoDaTasacion(tasacion({ estado: "pendiente", vence_en: null }), "2030-01-01")).toBe("pendiente");
    expect(situacaoDaTasacion(tasacion({ estado: "aceptada" }), "2030-01-01")).toBe("aceptada");
    expect(situacaoDaTasacion(tasacion({ estado: "rechazada" }), "2026-11-01")).toBe("rechazada");
  });

  it("o 'hoje' é o de Buenos Aires: às 23h de lá, em UTC já é amanhã", () => {
    const agora = new Date("2026-11-29T02:30:00Z"); // 23h30 do dia 28 em Buenos Aires
    expect(hojeNoFuso("America/Argentina/Buenos_Aires", agora)).toBe("2026-11-28");
    expect(hojeNoFuso("UTC", agora)).toBe("2026-11-29");
    expect(hojeNoFuso("Fuso/Inexistente", agora)).toBe("2026-11-29");
  });

  it("somar dias atravessa mês e ano", () => {
    expect(somarDias("2026-11-28", 7)).toBe("2026-12-05");
    expect(somarDias("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("a mais recente vem primeiro", () => {
    const lista = ordenarTasaciones([
      tasacion({ id: "velha", created_at: "2026-11-01T10:00:00Z" }),
      tasacion({ id: "nova", created_at: "2026-11-20T10:00:00Z" }),
    ]);
    expect(lista.map((t) => t.id)).toEqual(["nova", "velha"]);
  });
});

describe("o que o agente recebe", () => {
  it("sem tasação, sem número", () => {
    const r = tasacionParaOAgente([], "2026-11-21");
    expect(r.situacion).toBe("sin_tasacion");
    expect(r.valor).toBeUndefined();
    expect(r.instruccion).toContain("autoventa_pedir_tasacion");
  });

  it("vigente traz o valor formatado na moeda da tasação e até quando vale", () => {
    const r = tasacionParaOAgente([tasacion({})], "2026-11-21");
    expect(r.situacion).toBe("vigente");
    expect(r.valor).toMatch(/12\.000\.000/);
    expect(r.vence_en).toBe("2026-11-28");
  });

  it("em dólar, o valor sai em dólar", () => {
    const r = tasacionParaOAgente([tasacion({ valor_cents: 900_000, moneda: "USD" })], "2026-11-21");
    expect(r.moneda).toBe("USD");
    expect(r.valor).toMatch(/US\$/);
  });

  it.each([
    ["pendiente", tasacion({ estado: "pendiente", valor_cents: null, moneda: null, vence_en: null })],
    ["vencida", tasacion({})],
    ["rechazada", tasacion({ estado: "rechazada" })],
  ])("%s: o valor NÃO vem, nem o da tasação anterior", (situacion, atual) => {
    const anterior = tasacion({ id: "antes", created_at: "2026-10-01T10:00:00Z", vence_en: "2030-01-01" });
    const r = tasacionParaOAgente([anterior, { ...atual, created_at: "2026-11-21T15:00:00Z" }], "2026-12-15");
    expect(r.situacion).toBe(situacion);
    expect(r.valor).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/12\.000\.000/);
  });
});

describe("a entrada", () => {
  it("pedir não aceita valor; tasar exige valor positivo e moeda conhecida", () => {
    expect(crearTasacionSchema.safeParse({ accion: "pedir" }).success).toBe(true);
    expect(crearTasacionSchema.safeParse({ accion: "tasar", valor_cents: 0, moneda: "ARS" }).success).toBe(false);
    expect(crearTasacionSchema.safeParse({ accion: "tasar", valor_cents: 100, moneda: "BRL" }).success).toBe(false);
    expect(
      crearTasacionSchema.safeParse({ accion: "tasar", valor_cents: 100, moneda: "USD", vence_en: "2026-13-40" }).success,
    ).toBe(false);
    expect(crearTasacionSchema.safeParse({ accion: "tasar", valor_cents: 100, moneda: "USD" }).success).toBe(true);
  });

  it("atualizar sem nada é recusado, e o valor não é campo de atualização", () => {
    expect(actualizarTasacionSchema.safeParse({}).success).toBe(false);
    expect(actualizarTasacionSchema.safeParse({ estado: "aceptada" }).success).toBe(true);
    const comValor = actualizarTasacionSchema.safeParse({ estado: "aceptada", valor_cents: 1 });
    expect(comValor.success && "valor_cents" in comValor.data).toBe(false);
  });

  it("os erros do banco viram frase de gente", () => {
    expect(motivoDoErroDaTasacion("ERROR: tasar_exige_gerente")).toMatch(/gerente/);
    expect(motivoDoErroDaTasacion("retasar_e_uma_tasacion_nova")).toMatch(/tasação nova/);
    expect(motivoDoErroDaTasacion("qualquer coisa")).toMatch(/Tente de novo/);
  });

  it("a seção só existe em funil com os campos do usado", () => {
    expect(funilTemUsado([{ key: "usado_entrega" }, { key: "x" }])).toBe(true);
    expect(funilTemUsado([{ key: "x" }])).toBe(false);
  });
});
