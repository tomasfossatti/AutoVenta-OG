import { describe, expect, it } from "vitest";

import {
  cierreParaOAgente,
  descreverUnidade,
  dominioValido,
  guardarCierreSchema,
  motivoDoErroDaSena,
  normalizarDominio,
  registrarSenaSchema,
  senaQueVale,
  tramitesDaUnidade,
} from "./sena";

describe("a patente", () => {
  it.each([
    ["ab 123 cd", "AB123CD", true],
    ["abc-123", "ABC123", true],
    ["AB123CD", "AB123CD", true],
    ["A123BCD", "A123BCD", false],
    ["HOLA", "HOLA", false],
  ])("%s → %s (válida: %s)", (entrada, normal, valida) => {
    expect(normalizarDominio(entrada)).toBe(normal);
    expect(dominioValido(entrada)).toBe(valida);
  });

  it("o schema normaliza e recusa a inválida; vazio apaga", () => {
    expect(guardarCierreSchema.parse({ dominio: "ab 123 cd" }).dominio).toBe("AB123CD");
    expect(guardarCierreSchema.safeParse({ dominio: "HOLA" }).success).toBe(false);
    expect(guardarCierreSchema.parse({ dominio: "" }).dominio).toBeNull();
    expect(guardarCierreSchema.safeParse({}).success).toBe(false);
  });
});

describe("registrar a seña", () => {
  it("aceita o que vem do multipart (texto) e exige unidade, monto e moeda", () => {
    const ok = registrarSenaSchema.parse({
      product_id: "44444444-4444-4444-8444-444444444444",
      monto_cents: "50000000",
      moneda: "USD",
      notas: "",
    });
    expect(ok).toMatchObject({ monto_cents: 50_000_000, moneda: "USD", notas: null });
    expect(registrarSenaSchema.safeParse({ ...ok, monto_cents: "0" }).success).toBe(false);
    expect(registrarSenaSchema.safeParse({ ...ok, moneda: "BRL" }).success).toBe(false);
    expect(registrarSenaSchema.safeParse({ ...ok, product_id: "x" }).success).toBe(false);
  });
});

describe("a regra", () => {
  it("os trâmites seguem a condição da unidade", () => {
    expect(tramitesDaUnidade("usado")).toEqual(["formulario_08", "transferencia"]);
    expect(tramitesDaUnidade("0km")).toEqual(["patentamiento"]);
    expect(tramitesDaUnidade(null)).toHaveLength(3);
  });

  it("a seña que vale é a vigente, senão a aplicada; anulada não vale", () => {
    const a = { estado: "anulada" as const, created_at: "3" };
    const v = { estado: "vigente" as const, created_at: "2" };
    const ap = { estado: "aplicada" as const, created_at: "1" };
    expect(senaQueVale([a, v, ap])).toBe(v);
    expect(senaQueVale([a, ap])).toBe(ap);
    expect(senaQueVale([a])).toBeNull();
  });

  it("a descrição da unidade é a mesma do gatilho", () => {
    expect(descreverUnidade({ marca: "Toyota", nome: "Hilux", modelo: "Hilux", version: "SRV", anio: 2021 })).toBe(
      "Toyota Hilux SRV 2021",
    );
    expect(descreverUnidade({ marca: null, nome: "Gol", modelo: null, version: null, anio: null })).toBe("Gol");
  });

  it("o agente sem papelada ainda vê os trâmites pendentes", () => {
    const r = cierreParaOAgente([{ estado: "vigente", unidad_descripcion: "Gol", created_at: "1" }], null, "usado");
    expect(r).toMatchObject({ sena: "vigente", tramites: { formulario_08: "pendiente", transferencia: "pendiente" } });
  });

  it("todo código do banco vira frase, nunca um identificador", () => {
    for (const codigo of [
      "anular_exige_gerente",
      "unidad_no_disponible: senado",
      'duplicate key value violates unique constraint "autoventa_senas_una_vigente_por_negocio_idx"',
      "sena_campo_imutavel",
      "entrega_sin_sena",
      "entrega_ya_registrada",
      'violates check constraint "autoventa_cierres_dominio_check"',
    ]) {
      const frase = motivoDoErroDaSena(codigo);
      expect(frase).not.toMatch(/_/);
      expect(frase).not.toBe("Não foi possível salvar a seña. Tente de novo.");
    }
  });
});
