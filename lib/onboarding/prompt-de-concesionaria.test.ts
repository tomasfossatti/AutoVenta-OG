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

  it("a província do primeiro passo entra no lugar de Neuquén", () => {
    const prompt = promptDeConcesionaria({ ...base, provincia: "Córdoba", queVende: "la venta de autos 0km" });
    expect(prompt).toContain("Autos del Valle, una agencia de autos de Córdoba. La agencia se dedica a la venta de autos 0km.");
    expect(prompt).not.toContain("{{provincia}}");
  });

  it("província em branco cai em Neuquén", () => {
    expect(promptDeConcesionaria({ ...base, provincia: "  " })).toContain("una agencia de autos de Neuquén.");
  });

  it("nome com `$` não vira padrão de substituição", () => {
    expect(promptDeConcesionaria({ ...base, negocio: "Autos $& Co" })).toContain("Autos $& Co, una agencia");
  });

  it("mantém os limites firmes", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("Nunca des un precio que no salga del catálogo");
    expect(prompt).toContain("no le des el precio y pasá la conversación a un vendedor");
    expect(prompt).toContain("No digas que la agencia no la tiene");
    expect(prompt).toContain("No informes tasas, cuotas");
    expect(prompt).toContain("Nunca digas que un crédito está aprobado");
    expect(prompt).toContain("No confirmes visitas ni test drives");
  });

  it("trata o ambíguo e o fora de tema, com um exemplo de cada", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("## Mensajes ambiguos, incompletos o fuera de tema");
    expect(prompt).toContain("Ejemplo 1, lead claro");
    expect(prompt).toContain("Ejemplo 2, unidad cargada en el catálogo");
    expect(prompt).toContain("Ejemplo 3, unidad que no está cargada");
    expect(prompt).toContain("Ejemplo 4, lead ambiguo");
    expect(prompt).toContain("Ejemplo 5, fuera de tema");
  });

  it("etapa 2: usa o catálogo, e segue sem financiamento nem agenda", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("buscala en el catálogo antes de responder");
    expect(prompt).toContain("No tenés las condiciones de financiación ni la agenda de visitas");
    expect(prompt).not.toMatch(/agendá|te agendo|está agendad/i);
  });

  it("etapa 3: o usado vai para os campos, e o valor só sai de uma tasação vigente", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("## Usado en parte de pago");
    expect(prompt).toContain("en los campos que empiezan con usado_");
    expect(prompt).toContain("consultá la tasación con autoventa_ver_tasacion");
    expect(prompt).toContain("pedila con autoventa_pedir_tasacion");
    expect(prompt).toContain("no des ningún número, ni aproximado ni en rango");
    expect(prompt).toContain("Ejemplo 6, usado con tasación vigente");
    // A frase antiga mandava NUNCA falar valor; agora há um valor que pode ser dito.
    expect(prompt).not.toContain("No le pongas valor al usado de la persona, porque");
  });

  it("etapa 3, parte 2: consulta a seña, nunca a registra e nunca promete entrega", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).toContain("## Seña, papeles y entrega");
    expect(prompt).toContain("La seña la registra siempre una persona del equipo, nunca vos.");
    expect(prompt).toContain("consultá autoventa_ver_cierre");
    expect(prompt).toContain("Nunca prometas ni estimes una fecha de entrega");
    expect(prompt).toContain("- pregunta cuándo le entregan el auto;");
    expect(prompt).toContain("Ejemplo 7, seña registrada y papeles en trámite");
  });

  it("não usa travessão nem tuteio", () => {
    const prompt = promptDeConcesionaria(base);
    expect(prompt).not.toContain("—");
    expect(prompt).not.toMatch(/(?<!\p{L})(?:puedes|tienes|quieres|eres|tú|contigo)(?!\p{L})/iu);
  });
});

describe("o catálogo que o prompt cita existe no agente do onboarding", () => {
  it("a busca do catálogo nasce ligada (pacote `vender`)", async () => {
    const { capacidadesPadraoDoOnboarding } = await import("@/lib/ai/agents/capacidades-padrao");
    expect(capacidadesPadraoDoOnboarding()).toContain("crm_search_products");
  });

  it("as duas ferramentas da tasação nascem ligadas, e quem atualiza o lead também", async () => {
    const { capacidadesPadraoDoOnboarding } = await import("@/lib/ai/agents/capacidades-padrao");
    const ligadas = capacidadesPadraoDoOnboarding();
    expect(ligadas).toContain("autoventa_ver_tasacion");
    expect(ligadas).toContain("autoventa_pedir_tasacion");
    expect(ligadas).toContain("crm_update_lead");
  });
  it("a consulta da seña nasce ligada, e nenhuma ferramenta registra seña", async () => {
    const { capacidadesPadraoDoOnboarding } = await import("@/lib/ai/agents/capacidades-padrao");
    const { allTools } = await import("@/lib/mcp/tools");
    expect(capacidadesPadraoDoOnboarding()).toContain("autoventa_ver_cierre");
    const daSena = allTools.filter((t) => /sena|cierre/.test(t.name));
    expect(daSena.map((t) => [t.name, t.category])).toEqual([["autoventa_ver_cierre", "read"]]);
  });
});
