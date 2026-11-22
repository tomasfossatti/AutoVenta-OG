import { describe, expect, it } from "vitest";

import { lerPlanilha } from "@/lib/catalogo/planilha";

/**
 * FORK AUTOVENTA: A PLANILHA DE STOCK DE UMA CONCESSIONÁRIA.
 *
 * As colunas da ficha (`condición`, `modelo`, `versión`, `año`, `km`,
 * `combustible`, `transmisión`, `color`, `estado`) e a `moneda` entram pelo
 * mesmo importador do catálogo. Valor que não se reconhece recusa a linha com
 * o motivo, como o preço ilegível.
 */
const CABECALHO = "codigo;nombre;marca;precio;moneda;condición;modelo;versión;año;km;combustible;transmisión;color;estado";

describe("planilha com ficha de veículo", () => {
  it("lê a ficha e a moeda da unidade", () => {
    const r = lerPlanilha(
      [
        CABECALHO,
        "HILUX-21;Toyota Hilux SRV 2021;Toyota;38.500.000;ARS;Usado;Hilux;SRV;2021;85.000;Diésel;Automática;Blanco;Disponible",
        "AMAROK-20;VW Amarok Highline 2020;Volkswagen;28.500;U$S;usado;Amarok;Highline;2020;60000;diesel;automatica;Gris;Señado",
        "CRONOS-24;Fiat Cronos Drive 2024;Fiat;21.000.000;pesos;0 km;Cronos;Drive;2024;0;Nafta;Manual;Rojo;Reservado",
      ].join("\n"),
    );
    if ("erro" in r) throw new Error(r.erro);
    expect(r.erros).toEqual([]);
    expect(r.colunasIgnoradas).toEqual([]);
    expect(r.produtos.map((p) => [p.codigo, p.preco_cents, p.moeda])).toEqual([
      ["HILUX-21", 3_850_000_000, "ARS"],
      ["AMAROK-20", 2_850_000, "USD"],
      ["CRONOS-24", 2_100_000_000, "ARS"],
    ]);
    expect(r.produtos[0]!.vehiculo).toEqual({
      condicion: "usado",
      modelo: "Hilux",
      version: "SRV",
      anio: 2021,
      kilometros: 85000,
      combustible: "diesel",
      transmision: "automatica",
      color: "Blanco",
      estado: "disponible",
    });
    expect(r.produtos[1]!.vehiculo?.estado).toBe("senado");
    expect(r.produtos[2]!.vehiculo).toMatchObject({ condicion: "0km", estado: "reservado" });
  });

  it("sem coluna da ficha, o produto entra como antes, sem ficha", () => {
    const r = lerPlanilha("nombre;precio\nFunda;1.000");
    if ("erro" in r) throw new Error(r.erro);
    expect(r.produtos[0]!.vehiculo).toBeUndefined();
    expect(r.produtos[0]!.moeda).toBeUndefined();
  });

  it("estado, combustível ou moeda que não se reconhecem recusam a linha com o motivo", () => {
    const r = lerPlanilha(
      [
        "nombre;precio;estado;combustible;moneda",
        "Auto A;1.000;En camino;Nafta;ARS",
        "Auto B;1.000;Disponible;Kerosene;ARS",
        "Auto C;1.000;Disponible;Nafta;Euros",
        "Auto D;1.000;Disponible;Nafta;ARS",
      ].join("\n"),
    );
    if ("erro" in r) throw new Error(r.erro);
    expect(r.produtos.map((p) => p.nome)).toEqual(["Auto D"]);
    expect(r.erros.map((e) => e.linha)).toEqual([2, 3, 4]);
    expect(r.erros[0]!.motivo).toContain("En camino");
    expect(r.erros[2]!.motivo).toContain("Euros");
  });

  it("faltando a condição e o estado, valem os padrões: usado e disponível", () => {
    const r = lerPlanilha("nombre;precio;modelo\nAuto;1.000;Gol");
    if ("erro" in r) throw new Error(r.erro);
    expect(r.produtos[0]!.vehiculo).toMatchObject({ condicion: "usado", estado: "disponible", modelo: "Gol" });
  });
});
