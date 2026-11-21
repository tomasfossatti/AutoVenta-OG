import { describe, expect, it } from "vitest";

import { PROMPT_TEMPLATES } from "@/lib/schemas/onboarding";

import { promptDeConcesionaria, TONOS_DE_CONCESIONARIA } from "./prompt-de-concesionaria";

const base = { negocio: "Autos del Valle", tono: "ecommerce_friendly" as const };

describe("o prompt de concessionária (fork AutoVenta, etapa 1)", () => {
  it("resolve todas as variáveis com o que o onboarding recolhe", () => {
    for (const tono of PROMPT_TEMPLATES) {
      const prompt = promptDeConcesionaria({ ...base, tono, queVende: "Venta de 0km y usados" });
      expect(prompt).not.toMatch(/\{\{|\}\}/);
      expect(prompt).toContain("Autos del Valle, una agencia de autos de Neuquén.");
      expect(prompt).toContain(" La agencia se dedica a venta de 0km y usados.");
      expect(prompt).toContain(TONOS_DE_CONCESIONARIA[tono]);
    }
  });

  it("sem o que o negócio faz, a frase some em vez de ficar pela metade", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("una agencia de autos de Neuquén.\nTu trabajo");
    expect(prompt).not.toContain("se dedica a");
  });

  it("nome com `$` não vira padrão de substituição", () => {
    expect(promptDeConcesionaria({ ...base, negocio: "Autos $& Co" })).toContain("Autos $& Co, una agencia");
  });

  it("mantém os limites firmes", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("Nunca digas que una unidad está disponible");
    expect(prompt).toContain("No informes precios");
    expect(prompt).toContain("No informes tasas, cuotas");
    expect(prompt).toContain("Nunca digas que un crédito está aprobado");
    expect(prompt).toContain("No confirmes visitas ni test drives");
  });

  it("trata o ambíguo e o fora de tema, com um exemplo de cada", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("## Mensajes ambiguos, incompletos o fuera de tema");
    expect(prompt).toContain("Ejemplo 1, lead claro");
    expect(prompt).toContain("Ejemplo 2, lead ambiguo");
    expect(prompt).toContain("Ejemplo 3, fuera de tema");
  });

  it("não fala de recurso que ainda não existe como se estivesse ligado", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("Hoy no tenés el stock de la agencia");
    expect(prompt).not.toMatch(/agendá|te agendo|está agendad/i);
  });

  it("não usa travessão nem tuteio", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).not.toContain("—");
    expect(prompt).not.toMatch(/(?<!\p{L})(?:puedes|tienes|quieres|eres|tú|contigo)(?!\p{L})/iu);
  });
});
