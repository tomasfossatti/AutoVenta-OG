import { describe, expect, it } from "vitest";

import { perfilDaEmpresaDaInstalacao } from "./perfil-da-empresa-da-instalacao";

describe("perfilDaEmpresaDaInstalacao — a empresa criada pelo admin nasce no idioma da instalação", () => {
  it("APP_LOCALE=es: espanhol, fuso de Buenos Aires e pesos", () => {
    expect(perfilDaEmpresaDaInstalacao("es")).toEqual({
      locale: "es",
      timezone: "America/Argentina/Buenos_Aires",
      currency: "ARS",
    });
  });

  it("sem APP_LOCALE ou com pt-BR: nada muda (defaults da coluna)", () => {
    expect(perfilDaEmpresaDaInstalacao(undefined)).toBeNull();
    expect(perfilDaEmpresaDaInstalacao("  ")).toBeNull();
    expect(perfilDaEmpresaDaInstalacao("pt-BR")).toBeNull();
  });
});
