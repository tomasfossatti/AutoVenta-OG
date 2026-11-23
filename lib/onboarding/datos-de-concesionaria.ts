/**
 * O QUE O PRIMEIRO PASSO PERGUNTA A UMA CONCESSIONÁRIA — fork AutoVenta.
 *
 * O passo de boas-vindas do upstream pergunta o ramo em texto livre ("clínica
 * odontológica, ou venda de roupa fitness") e o fuso numa lista de cidades do
 * mundo. Para uma agência de carros da Argentina as duas perguntas têm resposta
 * fechada: ela vende 0km, usados ou os dois, e fica numa das 24 províncias.
 *
 * ─── O ramo ────────────────────────────────────────────────────────────────
 *
 * Cada opção grava em `onboarding_state.welcome.o_que_faz` a FRASE que o prompt
 * usa (`fraseDoQueVende`, em `prompt-de-concesionaria.ts`): "La agencia se
 * dedica a la venta de autos 0km." O campo segue sendo texto, como no upstream,
 * para nenhum leitor dele (`createDefaultAgent`, `montarQuadro`) mudar.
 *
 * ─── A província e o fuso ──────────────────────────────────────────────────
 *
 * A Argentina inteira está em UTC-3, sem horário de verão desde 2009. O fuso
 * da IANA de cada província varia (Neuquén é `America/Argentina/Salta`), mas o
 * relógio é o mesmo — e as telas de configuração só oferecem Buenos Aires
 * (`FUSOS_OFERECIDOS`, `lib/tempo/fusos.ts`). Por isso a província não escolhe
 * fuso: todo cadastro grava Buenos Aires, e a província vai para o estado do
 * onboarding e para o prompt ("una agencia de autos de Neuquén").
 */

/** As 23 províncias e a Cidade Autônoma, na grafia oficial. */
export const PROVINCIAS_ARGENTINAS = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const;

export type ProvinciaArgentina = (typeof PROVINCIAS_ARGENTINAS)[number];

/** As concessionárias do fork nasceram em Neuquén: é a opção marcada. */
export const PROVINCIA_PADRAO: ProvinciaArgentina = "Neuquén";

/** O fuso de toda província (ver o cabeçalho). Está em `FUSOS_OFERECIDOS`. */
export const FUSO_DA_ARGENTINA = "America/Argentina/Buenos_Aires";

/**
 * As três respostas a "o que a agência vende". `rotulo` é a chave do
 * dicionário (português, como toda chave); `frase` é o que o prompt lê.
 */
export const RUBROS_DE_CONCESIONARIA = [
  { id: "0km", rotulo: "0km", frase: "la venta de autos 0km" },
  { id: "usados", rotulo: "Usados", frase: "la venta de autos usados" },
  { id: "ambos", rotulo: "0km e usados", frase: "la venta de autos 0km y usados" },
] as const;
