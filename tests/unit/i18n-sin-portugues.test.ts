/**
 * NINGÚN TEXTO EN PORTUGUÉS EN ESPAÑOL — fork AutoVenta.
 *
 * Decisión de Tomás (2026-11-22), inamovible: el producto es solo para
 * Argentina y no muestra ningún texto en otro idioma. Este test recorre TODO el
 * producto (`app`, `components`, `hooks`, `lib`, API incluida: sus mensajes de
 * error llegan a la pantalla como avisos) y exige que cada clave de `t()` /
 * `traduzir()` salga, en `es`, sin marcas de portugués.
 *
 * La catraca del upstream (`i18n-espanhol-cobre-a-tela.test.ts`) deja afuera
 * `app/api` y `lib`, y su marca de portugués también agarra español ("para",
 * "antes", las tildes), así que no puede cobrar "cero portugués". Esta marca es
 * más angosta: solo letras y palabras que no existen en español. Lo que no
 * detecta (un "Tenants" o un "Broadcast") se traduce igual, pero no lo cobra.
 *
 * Arreglo: una línea en `lib/i18n/autoventa-completo-es.ts`, con voseo.
 */
import { describe, expect, it } from "vitest";

import { traduzir } from "@/lib/i18n/dicionario";
import { AREAS_DE_PRODUTO, varrerChavesDeI18n } from "./helpers/chave-dinamica";

const PALABRAS_SOLO_PORTUGUES = [
  "não", "você", "vocês", "estão", "são", "também", "através", "então",
  "desta", "deste", "nesta", "neste", "dessa", "desse", "nessa", "nesse",
  "dele", "dela", "quem", "quando", "onde", "pelo", "pela", "pelos", "pelas",
  "com", "sem", "mais", "ainda", "já", "só", "muito", "muita", "seu", "sua",
  "seus", "suas", "isso", "isto", "essa", "esse", "um", "uma", "uns", "umas",
  "em", "do", "das", "ao", "aos", "à", "às", "erro", "falha", "nenhum",
  "nenhuma", "obrigatório", "obrigatória", "escolha", "tente",
  "recarregue", "atualize", "foi", "há", "até", "agora",
  "depois", "novo", "nova", "arquivo", "senha", "tela", "chave", "mensagem",
  "usuário",
];

/** Letras y palabras que el español no tiene. Bordes por letra Unicode, no `\b`. */
export const MARCA_SOLO_PORTUGUES = new RegExp(
  "[çãõêôâ]|(?<!\\p{L})(?:" + PALABRAS_SOLO_PORTUGUES.join("|") + ")(?!\\p{L})",
  "iu",
);

/** Lo que se lee como idioma: sin variables (`{nome}`, `{{de}}`) ni direcciones de correo o web. */
export function textoVisible(texto: string): string {
  return texto
    .replace(/\{\{?[\w.]+\}?\}/g, " ")
    // Direcciones de correo y web: "crm.example.com" no es portugués.
    .replace(/\S+@\S+|https?:\/\/\S+|(?<!\p{L})[\w.-]+\.(?:com|ar|br|io|app)(?:\.\w+)*\b\S*/gu, " ");
}

export function suenaAPortugues(texto: string): boolean {
  return MARCA_SOLO_PORTUGUES.test(textoVisible(texto));
}

describe("la marca de portugués no confunde español", () => {
  it.each(["Página anterior", "Encontrado", "está desconectado", "Período", "Máximo de {n} caracteres.", "para confirmar", "Compará los dos", "Conversa con el cliente", "Generar informe", "Versión no encontrada.", "Comprobado el {quando}", "{criticos} sin respuesta y {em_risco} enfriándose"])(
    "español: %s",
    (texto) => expect(suenaAPortugues(texto)).toBe(false),
  );
  it.each(["Não foi possível ler a conversa.", "Você só pode alterar", "Erro ao salvar a voz.", "há 2 dias"])(
    "portugués: %s",
    (texto) => expect(suenaAPortugues(texto)).toBe(true),
  );
});

describe("el producto en español no muestra portugués", () => {
  const varredura = varrerChavesDeI18n(AREAS_DE_PRODUTO);

  it("la recorrida encuentra el producto (control positivo)", () => {
    expect(varredura.arquivosVarridos).toBeGreaterThan(500);
    expect(varredura.chaves.has("Você só pode alterar a sua própria agenda.")).toBe(true);
  });

  it("ninguna clave literal sale en portugués", () => {
    const enPortugues = [...varredura.chaves.keys()]
      .filter((chave) => suenaAPortugues(traduzir(chave, "es")))
      .map((chave) => `${chave}  ←  ${(varredura.chaves.get(chave) ?? []).slice(0, 2).join(", ")}`)
      .sort();
    expect(enPortugues).toEqual([]);
  });

  it("ningún valor de clave dinámica sale en portugués", () => {
    const enPortugues = varredura.dinamicos
      .flatMap((sitio) => sitio.valores.map((valor) => ({ sitio, valor })))
      .filter(({ valor }) => suenaAPortugues(traduzir(valor, "es")))
      .map(({ sitio, valor }) => `${valor}  ←  ${sitio.local}`)
      .sort();
    expect(enPortugues).toEqual([]);
  });
});
