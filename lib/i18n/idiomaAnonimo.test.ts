import { afterEach, describe, expect, it, vi } from "vitest";

const cena = vi.hoisted(() => ({ acceptLanguage: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (nome: string) => (nome === "accept-language" ? cena.acceptLanguage : null),
  }),
}));

import { idiomaDoVisitante } from "./idiomaAnonimo";

afterEach(() => {
  vi.unstubAllEnvs();
  cena.acceptLanguage = null;
});

describe("idiomaDoVisitante — o idioma de quem não tem sessão", () => {
  it("com APP_LOCALE=es, o visitante sem cabeçalho (robô da prévia do link) vê espanhol", async () => {
    vi.stubEnv("APP_LOCALE", "es");
    expect(await idiomaDoVisitante(null)).toBe("es");
  });

  it("com APP_LOCALE=es, o navegador em inglês também vê espanhol: a instalação vence o navegador", async () => {
    vi.stubEnv("APP_LOCALE", "es");
    cena.acceptLanguage = "en-US,en;q=0.9";
    expect(await idiomaDoVisitante(null)).toBe("es");
  });

  it("a preferência salva vence a instalação", async () => {
    vi.stubEnv("APP_LOCALE", "es");
    expect(await idiomaDoVisitante("pt-BR")).toBe("pt-BR");
  });

  it("sem APP_LOCALE, o navegador decide, como antes", async () => {
    vi.stubEnv("APP_LOCALE", "");
    cena.acceptLanguage = "es-AR,es;q=0.9";
    expect(await idiomaDoVisitante(null)).toBe("es");
    cena.acceptLanguage = null;
    expect(await idiomaDoVisitante(null)).toBe("pt-BR");
  });
});
