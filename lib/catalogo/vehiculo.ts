/**
 * A FICHA DO VEÍCULO — fork AutoVenta, etapa 2.
 *
 * Mora em `catalog_vehicle_details` (migration 9902), uma linha por produto do
 * catálogo. Preço, moeda e marca continuam em `catalog_products`: é a fonte que
 * a tela, a planilha e a busca do agente já leem. Aqui fica o que é do ramo:
 * condição, modelo, versão, ano, km, combustível, câmbio, cor e o ESTADO da
 * unidade, que é o que decide se ela é oferecida como disponível.
 *
 * Um módulo só, usado pelas três portas (rota da tela, importação por planilha
 * e busca do agente), para os três dizerem o mesmo sobre o que é válido e o que
 * está disponível.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const CONDICIONES = ["0km", "usado"] as const;
export const COMBUSTIBLES = ["nafta", "diesel", "gnc", "hibrido", "electrico"] as const;
export const TRANSMISIONES = ["manual", "automatica"] as const;
export const ESTADOS_DEL_VEHICULO = ["disponible", "reservado", "senado", "vendido"] as const;
/** As moedas em que uma unidade pode ser publicada. */
export const MONEDAS_DEL_VEHICULO = ["ARS", "USD"] as const;

export type Condicion = (typeof CONDICIONES)[number];
export type Combustible = (typeof COMBUSTIBLES)[number];
export type Transmision = (typeof TRANSMISIONES)[number];
export type EstadoDelVehiculo = (typeof ESTADOS_DEL_VEHICULO)[number];
export type MonedaDelVehiculo = (typeof MONEDAS_DEL_VEHICULO)[number];

/**
 * Os rótulos da tela. A chave é o texto em português (a regra do dicionário,
 * `lib/i18n/dicionario.ts`); o espanhol mora em `lib/i18n/autoventa-vehiculo.ts`.
 */
export const ROTULOS_DA_CONDICAO: Record<Condicion, string> = { "0km": "0 km", usado: "Usado" };
export const ROTULOS_DO_COMBUSTIVEL: Record<Combustible, string> = {
  nafta: "Gasolina",
  diesel: "Diesel",
  gnc: "GNV",
  hibrido: "Híbrido",
  electrico: "Elétrico",
};
export const ROTULOS_DO_CAMBIO: Record<Transmision, string> = { manual: "Câmbio manual", automatica: "Câmbio automático" };
export const ROTULOS_DO_ESTADO: Record<EstadoDelVehiculo, string> = {
  disponible: "Disponível",
  reservado: "Reservado",
  senado: "Com sinal",
  vendido: "Vendido",
};

const textoCurto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** A ficha como a rota a recebe: substitui a ficha inteira do produto. */
export const fichaDelVehiculoSchema = z.object({
  condicion: z.enum(CONDICIONES),
  modelo: textoCurto(80),
  version: textoCurto(80),
  anio: z.number().int().min(1950).max(2100).nullable().optional(),
  kilometros: z.number().int().min(0).max(2_000_000).nullable().optional(),
  combustible: z.enum(COMBUSTIBLES).nullable().optional(),
  transmision: z.enum(TRANSMISIONES).nullable().optional(),
  color: textoCurto(40),
  estado: z.enum(ESTADOS_DEL_VEHICULO),
});
export type FichaDelVehiculo = z.infer<typeof fichaDelVehiculoSchema>;

/** A linha como o banco a devolve. */
export interface FichaGuardada {
  product_id: string;
  condicion: Condicion;
  modelo: string | null;
  version: string | null;
  anio: number | null;
  kilometros: number | null;
  combustible: Combustible | null;
  transmision: Transmision | null;
  color: string | null;
  estado: EstadoDelVehiculo;
}

export const COLUNAS_DA_FICHA =
  "product_id, condicion, modelo, version, anio, kilometros, combustible, transmision, color, estado";

/** Só a unidade `disponible` é oferecida como disponível. */
export function unidadeDisponivel(ficha: Pick<FichaGuardada, "estado">): boolean {
  return ficha.estado === "disponible";
}

/**
 * A ficha como o agente a recebe na busca do catálogo: só o que está
 * preenchido, com o estado sempre presente.
 */
export function fichaParaOAgente(ficha: FichaGuardada): Record<string, string | number> {
  const saida: Record<string, string | number> = { condicion: ficha.condicion, estado: ficha.estado };
  if (ficha.modelo) saida.modelo = ficha.modelo;
  if (ficha.version) saida.version = ficha.version;
  if (ficha.anio !== null) saida.anio = ficha.anio;
  if (ficha.kilometros !== null) saida.kilometros = ficha.kilometros;
  if (ficha.combustible) saida.combustible = ficha.combustible;
  if (ficha.transmision) saida.transmision = ficha.transmision;
  if (ficha.color) saida.color = ficha.color;
  return saida;
}

/** Grava (ou substitui) a ficha de um produto da organização. */
export async function guardarFicha(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  ficha: FichaDelVehiculo,
): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const { error } = await supabase.from("catalog_vehicle_details").upsert(
    {
      product_id: productId,
      organization_id: organizationId,
      condicion: ficha.condicion,
      modelo: ficha.modelo ?? null,
      version: ficha.version ?? null,
      anio: ficha.anio ?? null,
      kilometros: ficha.kilometros ?? null,
      combustible: ficha.combustible ?? null,
      transmision: ficha.transmision ?? null,
      color: ficha.color ?? null,
      estado: ficha.estado,
    },
    { onConflict: "product_id" },
  );
  return error ? { ok: false, mensagem: error.message } : { ok: true };
}

/**
 * As fichas dos produtos pedidos, por id. Falha de leitura LANÇA: tratar o erro
 * como "sem ficha" faria a busca do agente oferecer como disponível uma unidade
 * reservada ou vendida.
 */
export async function fichasDosProdutos(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: readonly string[],
): Promise<Map<string, FichaGuardada>> {
  const fichas = new Map<string, FichaGuardada>();
  if (productIds.length === 0) return fichas;
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await supabase
      .from("catalog_vehicle_details")
      .select(COLUNAS_DA_FICHA)
      .eq("organization_id", organizationId)
      .in("product_id", productIds.slice(i, i + 200));
    if (error) throw new Error(`ler_fichas_falhou: ${error.message}`);
    for (const linha of (data ?? []) as unknown as FichaGuardada[]) fichas.set(linha.product_id, linha);
  }
  return fichas;
}

// ─── A planilha ──────────────────────────────────────────────────────────────
//
// As células chegam como a concessionária escreve: "0 km", "Nuevo", "Diésel",
// "Automática", "Señado", "U$S". Cada leitor devolve o valor do banco, `null`
// para célula vazia, ou `undefined` quando o texto não é reconhecido (a linha
// é recusada com o motivo, como o preço ilegível).

function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s.]+/g, "")
    .trim();
}

function leitor<T extends string>(mapa: Record<string, T>) {
  return (texto: string): T | null | undefined => {
    const k = chave(texto);
    if (k === "") return null;
    return mapa[k];
  };
}

export const lerCondicion = leitor<Condicion>({ "0km": "0km", "0": "0km", nuevo: "0km", nueva: "0km", usado: "usado", usada: "usado" });
export const lerCombustible = leitor<Combustible>({
  nafta: "nafta",
  gasolina: "nafta",
  diesel: "diesel",
  gasoil: "diesel",
  gnc: "gnc",
  hibrido: "hibrido",
  electrico: "electrico",
});
export const lerTransmision = leitor<Transmision>({
  manual: "manual",
  mecanica: "manual",
  automatica: "automatica",
  automatico: "automatica",
  at: "automatica",
  cvt: "automatica",
});
export const lerEstado = leitor<EstadoDelVehiculo>({
  disponible: "disponible",
  reservado: "reservado",
  reservada: "reservado",
  senado: "senado",
  senada: "senado",
  vendido: "vendido",
  vendida: "vendido",
});
export const lerMoneda = leitor<MonedaDelVehiculo>({
  ars: "ARS",
  $: "ARS",
  pesos: "ARS",
  peso: "ARS",
  usd: "USD",
  us$: "USD",
  u$s: "USD",
  dolares: "USD",
  dolar: "USD",
});

/** Número inteiro escrito com ou sem ponto de milhar ("85.000", "85000"). */
export function lerInteiro(texto: string): number | null | undefined {
  const limpo = texto.replace(/\s|km/gi, "");
  if (limpo === "") return null;
  if (!/^\d{1,3}(?:\.\d{3})*$|^\d+$/.test(limpo)) return undefined;
  return Number(limpo.replace(/\./g, ""));
}
