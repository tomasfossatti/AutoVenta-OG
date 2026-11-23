/**
 * AS PALAVRAS DE PASSAGEM COM QUE UM AGENTE NASCE — por idioma.
 *
 * `ai_agent_versions.handoff_keywords` é o vocabulário do tenant que, contido na
 * mensagem do cliente, passa a conversa para uma pessoa na hora (substring, sem
 * caixa — `matchesHandoffKeyword`). Até aqui o padrão era um só, em português,
 * escrito em quatro lugares (default do banco, schema da rota, formulário e o
 * campo de palavras), e a versão do onboarding nem o escrevia: herdava o default
 * do banco.
 *
 * O defeito medido (fork AutoVenta, 2026-11-22): a organização em `es` recebia
 * um agente cujas palavras eram "falar com humano", "atendente" e "pessoa real".
 * Um cliente de Neuquén que escreve "quiero hablar con una persona" não casa
 * nenhuma — nem a regex determinística, que era só PT-BR (ver
 * `human-handoff.ts`). A passagem ficava inteira na mão do modelo.
 *
 * Por que lista própria e não o dicionário: "atendente" sozinha é chave comum
 * de tela, e traduzi-la no dicionário mudaria qualquer rótulo que a use. As
 * palavras de passagem são vocabulário do cliente final, não da interface.
 *
 * Idioma sem lista própria (hoje só existem `pt-BR` e `es`) fica com o português — o comportamento
 * anterior. O default do banco segue em português pela mesma razão: ele é o piso
 * de quem cria versão sem dizer nada.
 */
import type { Idioma } from "@/lib/i18n/idiomas";

/** O padrão histórico (e o do banco, migration 0023). */
export const PALAVRAS_DE_PASSAGEM_PT: readonly string[] = ["falar com humano", "atendente", "pessoa real"];

/**
 * Espanhol, escrito como o cliente rioplatense escreve. Frases, não palavras
 * soltas: a régua é substring, e "vendedor" sozinho casaria "el vendedor me
 * dijo que…", passando a conversa sem que ninguém tenha pedido.
 */
export const PALAVRAS_DE_PASSAGEM_ES: readonly string[] = [
  "hablar con una persona",
  "que me atienda alguien",
  "persona real",
];

export function palavrasDePassagemPadrao(idioma: Idioma): string[] {
  return [...(idioma === "es" ? PALAVRAS_DE_PASSAGEM_ES : PALAVRAS_DE_PASSAGEM_PT)];
}
