import { describe, expect, it } from "vitest";

import { DICIONARIO, traduzir } from "@/lib/i18n/dicionario";
import { TEXTOS_RIOPLATENSES } from "@/lib/i18n/rioplatense";

import { varrerChavesDeI18n } from "./helpers/chave-dinamica";

/**
 * O CAMINHO MÍNIMO DO FORK FALA COM VOSEO.
 *
 * O fork AutoVenta atende concessionárias da Argentina. Nesta etapa, o que o
 * cliente vê do cadastro até a primeira resposta do agente precisa estar em
 * espanhol rioplatense: login e cadastro, onboarding, conexão do WhatsApp,
 * inbox e configuração do agente. Quem troca o tom é `lib/i18n/rioplatense.ts`.
 *
 * O guarda tem três partes:
 *   1. toda chave da camada existe no dicionário com `es` (a camada troca o
 *      tom, não inventa frase nem esconde uma chave errada);
 *   2. nenhum valor da camada tem forma de "tú" nem travessão;
 *   3. toda chave que essas telas passam por `t()`/`traduzir` sai sem "tú".
 *
 * A detecção é por padrão de texto, então tem falso positivo: substantivo no
 * começo da frase ("Agenda del celular") ou terceira pessoa ("Sigue en el
 * inbox"). Esses ficam em `PERMITIDOS`, com o texto exato.
 */

const TELAS_DO_CAMINHO_MINIMO = [
  "app/onboarding",
  "app/app/connections",
  "app/app/inbox",
  "app/app/ai/agents",
  "app/(public)/login",
  "app/(public)/signup",
  "components/inbox",
  "components/connections",
] as const;

// `\b` do JavaScript só conhece letra ASCII ("Ten" casaria em "Tenés" e "aquí"
// nunca casaria), então as bordas aqui são por letra Unicode.
const FORMAS_DE_TU =
  /(?<!\p{L})(?:puedes|tienes|quieres|eres|necesitas|debes|sabes|prefieres|haces|sigues|vuelves|recibes|usas|escribes|eliges|envías|conectas|encuentras|ingresas|pierdes|cambias|guardas|abres|cierras|vuelvas|piensas|entiendes|esperas|ti|contigo|tú|aquí|móvil|vosotros)(?!\p{L})/iu;

const IMPERATIVOS_DE_TU = new RegExp(
  "(?:^|[.!?¿¡:;—(\\n\"“«]\\s*|\\s[–-]\\s)(?:" +
    [
      "Intenta", "Agrega", "Haz", "Escanea", "Abre", "Elige", "Revisa", "Conecta", "Usa", "Escribe",
      "Copia", "Pega", "Selecciona", "Espera", "Recarga", "Vuelve", "Toca", "Pulsa", "Configura",
      "Guarda", "Busca", "Activa", "Desactiva", "Cambia", "Envía", "Prueba", "Confirma", "Completa",
      "Define", "Crea", "Edita", "Borra", "Elimina", "Mira", "Ve", "Pon", "Asegúrate", "Recuerda",
      "Lee", "Responde", "Asigna", "Sube", "Descarga", "Invita", "Pide", "Vincula", "Cierra", "Inicia",
      "Ingresa", "Escoge", "Añade", "Quita", "Deja", "Llama", "Avisa", "Comprueba", "Verifica",
      "Actualiza", "Reconecta", "Repite", "Reintenta", "Entra", "Continúa", "Sigue", "Termina",
      "Publica", "Habilita", "Indica", "Informa", "Cuenta", "Explica", "Ajusta", "Introduce",
      "Instala", "Ignora", "Marca", "Mantén", "Ten", "Sal", "Ven", "Di", "Dime", "Cuéntame",
      "Regresa", "Arrastra", "Suelta", "Haga", "Vuelva", "Pruebe", "Descarta", "Archiva", "Reabre",
      "Asume", "Transfiere", "Pausa", "Reanuda", "Programa", "Agenda", "Fija", "Silencia",
      "Sincroniza", "Desconecta", "Restaura", "Comparte", "Cancela", "Acepta", "Rechaza", "Aprueba",
      "Exporta", "Importa", "Saca", "Filtra", "Ordena", "Limpia", "Oculta", "Muestra", "Etiqueta",
      "Seleccione", "Ingrese", "Escriba", "Indique", "Elija", "Pegue", "Cree", "Intente", "Revise",
      "Verifique", "Espere", "Agregue", "Conecte", "Use", "Abra", "Envíe", "Guarde", "Configure",
      "Pida", "Confirme", "Copie", "Escanee", "Déjelo", "Inténtelo",
    ].join("|") +
    ")(?!\\p{L})",
  "u",
);

/** Palavras com acento terminadas como pronome que NÃO são verbo com pronome. */
const NAO_SAO_ENCLITICOS = new Set([
  "título", "títulos", "módulo", "módulos", "vínculo", "vínculos", "círculo", "cálculo", "cálculos",
  "artículo", "artículos", "rótulo", "rótulos", "capítulo", "vehículo", "vehículos", "película",
  "fórmula", "cápsula", "límite", "límites", "términos", "vértice", "óvalo", "ángulo", "obstáculo",
]);

/**
 * Imperativo de "tú" com pronome leva acento ("Inténtalo", "Revísala"); o de
 * "vos" com um pronome só, não ("Intentalo", "Revisala"). Gerúndio
 * ("usándolo") e dois pronomes ("mandáselo") levam acento nas duas formas,
 * então não contam.
 */
function temEncliticoDeTu(texto: string): boolean {
  for (const [palavra] of texto.matchAll(/\p{L}+/gu)) {
    const minuscula = palavra.toLowerCase();
    if (!/[áéíó]/u.test(minuscula) || NAO_SAO_ENCLITICOS.has(minuscula)) continue;
    if (minuscula.endsWith("mente")) continue; // advérbio: "automáticamente"
    const pronome = /(?:los|las|les|nos|lo|la|le|me|te)$/u.exec(minuscula);
    if (!pronome) continue;
    const base = minuscula.slice(0, -pronome[0].length);
    if (/nd[oa]$/u.test(base) || /(?:se|me|te|nos)$/u.test(base)) continue;
    return true;
  }
  return false;
}

function temTuteo(texto: string): boolean {
  return FORMAS_DE_TU.test(texto) || IMPERATIVOS_DE_TU.test(texto) || temEncliticoDeTu(texto);
}

/** Falsos positivos medidos: substantivo no começo da frase ou terceira pessoa. */
const PERMITIDOS = new Set([
  " es anterior a esta versión y quedó superado por ella. Sigue en el Historial.",
  "Agenda del celular",
  "Espera",
  "Cuenta disponible en el proveedor. La atención por mensajes de esta red todavía no está integrada en el CRM.",
  "Sigue funcionando en el celular. Meta muestra un QR para escanear con la app.",
  "Sigue en el inbox:",
  "Marca de esta herramienta",
  "Pausa entre una respuesta y la siguiente (segundos)",
  "Responde en audio cuando el cliente envía audio, pide audio por escrito o avisa que no puede leer. Quien pide seguir por texto sigue recibiendo texto.",
  "Etiqueta (opcional)",
  "Prueba ejecutada.",
  "Prueba",
  "Cuenta",
]);

describe("o detector de tuteo distingue tú de vos", () => {
  it.each([
    "Intenta de nuevo.",
    "Inténtalo de nuevo.",
    "¿Ya tienes cuenta?",
    "Pega aquí la clave",
    "Desactivada por ti",
  ])("acusa %s", (texto) => {
    expect(temTuteo(texto)).toBe(true);
  });

  it.each([
    "Intentá de nuevo.",
    "Intentalo de nuevo.",
    "¿Ya tenés cuenta?",
    "Pegá acá la clave",
    "Desactivada por vos",
    "Copiá el enlace y mandáselo por WhatsApp.",
    "Suscribite para seguir usándolo.",
    "El título supera el límite.",
  ])("não acusa %s", (texto) => {
    expect(temTuteo(texto)).toBe(false);
  });
});

describe("a camada rioplatense", () => {
  const entradas = Object.entries(TEXTOS_RIOPLATENSES);

  it("não está vazia", () => {
    expect(entradas.length).toBeGreaterThan(300);
  });

  it("só troca frases que o dicionário já tem em espanhol", () => {
    const orfas = entradas.map(([chave]) => chave).filter((chave) => !DICIONARIO[chave]?.es);
    expect(orfas).toEqual([]);
  });

  it("não tem tuteo nem travessão", () => {
    const ruins = entradas.filter(([, valor]) => temTuteo(valor) || valor.includes("—"));
    expect(ruins).toEqual([]);
  });

  it("vence o espanhol neutro e deixa o português intacto", () => {
    expect(traduzir("Escaneie o QR code", "es")).toBe("Escaneá el código QR");
    expect(traduzir("Escaneie o QR code", "pt-BR")).toBe("Escaneie o QR code");
  });
});

describe("as telas do caminho mínimo", () => {
  const varredura = varrerChavesDeI18n(TELAS_DO_CAMINHO_MINIMO);

  it("a varredura encontra as telas (controle positivo)", () => {
    expect(varredura.arquivosVarridos).toBeGreaterThan(100);
    expect(varredura.chaves.has("Escreva uma mensagem…")).toBe(true);
  });

  it("nenhuma frase sai com tuteo", () => {
    const comTuteo = [...varredura.chaves.keys()]
      .map((chave) => ({ chave, es: traduzir(chave, "es") }))
      .filter(({ es }) => temTuteo(es) && !PERMITIDOS.has(es));
    expect(comTuteo).toEqual([]);
  });
});
