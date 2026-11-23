/**
 * O PEDIDO DE UMA PESSOA EM ESPANHOL — fork AutoVenta.
 *
 * Defeito medido em 2026-11-22: a regex determinística de passagem era só
 * PT-BR e as palavras de passagem do agente nasciam em português, então numa
 * organização `es` "quiero hablar con una persona" não acionava nenhuma das
 * duas camadas. Aqui ficam o que TEM de passar e o que NÃO pode passar (a régua
 * é conservadora: falso positivo silencia o bot para sempre — `force_human`).
 */
import { describe, expect, it } from "vitest";

import { detectHumanHandoffRequest } from "./human-handoff";
import { matchesHandoffKeyword, palavrasDePassagem } from "./agent-config";
import {
  PALAVRAS_DE_PASSAGEM_ES,
  PALAVRAS_DE_PASSAGEM_PT,
  palavrasDePassagemPadrao,
} from "@/lib/ai/agents/palavras-de-passagem-padrao";

describe("detectHumanHandoffRequest — espanhol rioplatense", () => {
  it.each([
    "quiero hablar con una persona",
    "Quiero hablar con un humano por favor",
    "puedo hablar con el vendedor?",
    "necesito hablar con un asesor",
    "me pasás con un vendedor?",
    "pasame con alguien",
    "comunicame con una persona",
    "quiero que me atienda una persona",
    "que me atienda alguien",
    "hay atención humana?",
    "quiero una persona real",
    "no quiero hablar con un bot",
    "quiero hablar con alguien.",
    "quiero hablar con alguien de la agencia",
    "HABLAR CON UNA PERSONA",
  ])("passa: %s", (texto) => {
    expect(detectHumanHandoffRequest(texto)).toBe(true);
  });

  it.each([
    "el vendedor me dijo que estaba disponible",
    "tengo que hablar con mi esposa y te aviso",
    "tengo que hablar con alguien de mi familia",
    "la persona que me atendió fue muy amable",
    "sos un bot?",
    "hablé con el banco y me aprueban el prendario",
    "busco una camioneta usada",
    "¿la hilux sigue disponible?",
  ])("não passa: %s", (texto) => {
    expect(detectHumanHandoffRequest(texto)).toBe(false);
  });

  it("o português continua casando como antes", () => {
    expect(detectHumanHandoffRequest("quero falar com um atendente")).toBe(true);
    expect(detectHumanHandoffRequest("me passa pra um humano")).toBe(true);
  });
});

describe("palavras de passagem com que o agente nasce", () => {
  it("organização em `es` nasce com palavras em espanhol", () => {
    expect(palavrasDePassagemPadrao("es")).toEqual([...PALAVRAS_DE_PASSAGEM_ES]);
  });

  it("pt-BR fica com o padrão de antes (o mesmo do banco)", () => {
    expect(palavrasDePassagemPadrao("pt-BR")).toEqual(["falar com humano", "atendente", "pessoa real"]);
    expect(palavrasDePassagemPadrao("pt-BR")).toEqual([...PALAVRAS_DE_PASSAGEM_PT]);
  });

  it("devolve cópia: quem edita a lista não muda o padrão", () => {
    palavrasDePassagemPadrao("es").push("x");
    expect(palavrasDePassagemPadrao("es")).toHaveLength(PALAVRAS_DE_PASSAGEM_ES.length);
  });

  it("as palavras em espanhol casam com o que o cliente escreve, pela régua do turno", () => {
    const kws = palavrasDePassagem(palavrasDePassagemPadrao("es"));
    expect(matchesHandoffKeyword("Hola, quiero hablar con una persona", kws)).toBe(true);
    expect(matchesHandoffKeyword("prefiero que me atienda alguien", kws)).toBe(true);
    expect(matchesHandoffKeyword("el vendedor me dijo que sí", kws)).toBe(false);
  });

  it("o default do banco continua sendo o padrão português", async () => {
    const { readFileSync } = await import("node:fs");
    const baseline = readFileSync("supabase/baseline.sql", "utf8");
    expect(baseline).toContain(
      `"handoff_keywords" "text"[] DEFAULT ARRAY['falar com humano'::"text", 'atendente'::"text", 'pessoa real'::"text"]`,
    );
  });
});
