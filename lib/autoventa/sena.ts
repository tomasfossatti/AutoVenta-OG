/**
 * A SEÑA E O FECHAMENTO DA OPERAÇÃO — fork AutoVenta, etapa 3, parte 2.
 *
 * Duas tabelas (migration 9905):
 *  - `autoventa_senas`: o dinheiro que o cliente deixou para reservar uma
 *    unidade do estoque. Registrar põe a unidade em `senado` (o gatilho do
 *    banco faz, não esta camada); anular (gerente+) a devolve a `disponible`.
 *  - `autoventa_cierres`: a papelada (domínio, 08, transferência ou
 *    emplacamento) e a entrega. Registrar a entrega aplica a seña e marca a
 *    unidade `vendido`.
 *
 * ─── Quem faz o quê ─────────────────────────────────────────────────────────
 *
 *  - Vendedor (`agent`+): registra a seña, sobe o comprovante, carrega a
 *    papelada e registra a entrega.
 *  - Gerente (`manager`+): também anula a seña (com motivo).
 *  - Agente de IA: só LÊ (`cierreParaOAgente`), sem monto e sem a data de
 *    entrega combinada — a regra "nunca prometa entrega" não depende só do
 *    prompt, a ferramenta nem devolve a data.
 *
 * O banco é quem barra (gatilhos + RLS); este módulo dá a mesma régua à tela,
 * à rota e ao agente. Ele é importado pela TELA também: nada de módulo de
 * servidor aqui (o movimento para "Señado" mora em `mover-para-senado.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";


export const ESTADOS_DE_LA_SENA = ["vigente", "anulada", "aplicada"] as const;
export const MONEDAS_DE_LA_SENA = ["ARS", "USD"] as const;
export const ESTADOS_DEL_08 = ["pendiente", "firmado", "certificado"] as const;
export const ESTADOS_DE_LA_TRANSFERENCIA = ["pendiente", "en_tramite", "inscripta"] as const;
export const ESTADOS_DEL_PATENTAMIENTO = ["pendiente", "en_tramite", "patentado"] as const;

export type EstadoDeLaSena = (typeof ESTADOS_DE_LA_SENA)[number];
export type MonedaDeLaSena = (typeof MONEDAS_DE_LA_SENA)[number];
export type EstadoDel08 = (typeof ESTADOS_DEL_08)[number];
export type EstadoDeLaTransferencia = (typeof ESTADOS_DE_LA_TRANSFERENCIA)[number];
export type EstadoDelPatentamiento = (typeof ESTADOS_DEL_PATENTAMIENTO)[number];

/** A chave do anexo do comprovante em `crm_lead_attachments`. */
export const CAMPO_DEL_COMPROBANTE = "sena_comprobante";

/** O slug da etapa "Señado" do embudo Ventas (migration 9901). */
export const SLUG_DA_ETAPA_SENADO = "senado";

export const ROTULOS_DA_SENA: Record<EstadoDeLaSena, string> = {
  vigente: "Seña vigente",
  anulada: "Seña anulada",
  aplicada: "Seña aplicada à venda",
};
export const ROTULOS_DO_08: Record<EstadoDel08, string> = {
  pendiente: "Pendente",
  firmado: "Assinado",
  certificado: "Assinatura certificada",
};
export const ROTULOS_DA_TRANSFERENCIA: Record<EstadoDeLaTransferencia, string> = {
  pendiente: "Pendente",
  en_tramite: "Em trâmite",
  inscripta: "Inscrita no registro",
};
export const ROTULOS_DO_PATENTAMIENTO: Record<EstadoDelPatentamiento, string> = {
  pendiente: "Pendente",
  en_tramite: "Em trâmite",
  patentado: "Emplacado",
};

export interface SenaGuardada {
  id: string;
  lead_id: string;
  product_id: string | null;
  unidad_descripcion: string;
  estado: EstadoDeLaSena;
  monto_cents: number;
  moneda: MonedaDeLaSena;
  fecha: string;
  comprobante_id: string | null;
  notas: string | null;
  motivo_anulacion: string | null;
  creada_por: string | null;
  anulada_por: string | null;
  anulada_en: string | null;
  aplicada_en: string | null;
  created_at: string;
}

export const COLUNAS_DA_SENA =
  "id, lead_id, product_id, unidad_descripcion, estado, monto_cents, moneda, fecha, comprobante_id, notas, " +
  "motivo_anulacion, creada_por, anulada_por, anulada_en, aplicada_en, created_at";

export interface CierreGuardado {
  lead_id: string;
  dominio: string | null;
  formulario_08: EstadoDel08;
  transferencia: EstadoDeLaTransferencia;
  patentamiento: EstadoDelPatentamiento;
  entrega_programada: string | null;
  entregado_en: string | null;
  notas: string | null;
  updated_at: string;
}

export const COLUNAS_DO_CIERRE =
  "lead_id, dominio, formulario_08, transferencia, patentamiento, entrega_programada, entregado_en, notas, updated_at";

/** O que vale enquanto não há linha em `autoventa_cierres`. */
export const CIERRE_VAZIO: Omit<CierreGuardado, "lead_id" | "updated_at"> = {
  dominio: null,
  formulario_08: "pendiente",
  transferencia: "pendiente",
  patentamiento: "pendiente",
  entrega_programada: null,
  entregado_en: null,
  notas: null,
};

// ─── O domínio (patente) ─────────────────────────────────────────────────────

/** `ab 123-cd` → `AB123CD`. A mesma limpeza que o gatilho faz. */
export function normalizarDominio(valor: string): string {
  return valor.replace(/[\s.-]/g, "").toUpperCase();
}

/** Mercosul (AB123CD) ou o formato anterior (ABC123). */
export function dominioValido(valor: string): boolean {
  return /^([A-Z]{2}[0-9]{3}[A-Z]{2}|[A-Z]{3}[0-9]{3})$/.test(normalizarDominio(valor));
}

/**
 * Quais trâmites a unidade tem: usado transfere (08 + transferência); 0 km
 * emplaca. Sem a condição (unidade apagada do catálogo), mostra os três.
 */
export function tramitesDaUnidade(condicion: "0km" | "usado" | null): Array<"formulario_08" | "transferencia" | "patentamiento"> {
  if (condicion === "0km") return ["patentamiento"];
  if (condicion === "usado") return ["formulario_08", "transferencia"];
  return ["formulario_08", "transferencia", "patentamiento"];
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

const notas = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Registrar a seña: chega por multipart (o comprovante vai junto), por isso `coerce`. */
export const registrarSenaSchema = z.object({
  product_id: z.string().uuid("Escolha a unidade do estoque."),
  monto_cents: z.coerce.number().int().positive().max(9_000_000_000_000),
  moneda: z.enum(MONEDAS_DE_LA_SENA),
  fecha: dataIso.optional(),
  notas,
});
export type RegistrarSena = z.infer<typeof registrarSenaSchema>;

export const anularSenaSchema = z.object({
  accion: z.literal("anular"),
  motivo: z.string().trim().min(1, "Conte por que a seña foi anulada.").max(500),
});

export const guardarCierreSchema = z
  .object({
    dominio: z
      .string()
      .trim()
      .max(12)
      .transform((v) => (v === "" ? null : normalizarDominio(v)))
      .refine((v) => v === null || dominioValido(v), "Patente inválida. Use o formato AB123CD ou ABC123.")
      .nullable()
      .optional(),
    formulario_08: z.enum(ESTADOS_DEL_08).optional(),
    transferencia: z.enum(ESTADOS_DE_LA_TRANSFERENCIA).optional(),
    patentamiento: z.enum(ESTADOS_DEL_PATENTAMIENTO).optional(),
    entrega_programada: dataIso.nullable().optional(),
    entregado_en: dataIso.optional(),
    notas,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nada para alterar." });
export type GuardarCierre = z.infer<typeof guardarCierreSchema>;

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function listarSenas(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<SenaGuardada[]> {
  const { data, error } = await supabase
    .from("autoventa_senas")
    .select(COLUNAS_DA_SENA)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(50);
  // Falha de leitura LANÇA: tratar como "sem seña" faria a tela oferecer
  // registrar outra seña e o agente dizer que a operação não tem nenhuma.
  if (error) throw new Error(`ler_senas_falhou: ${error.message}`);
  return (data ?? []) as unknown as SenaGuardada[];
}

export async function lerCierre(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<CierreGuardado | null> {
  const { data, error } = await supabase
    .from("autoventa_cierres")
    .select(COLUNAS_DO_CIERRE)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error(`ler_cierre_falhou: ${error.message}`);
  return (data as unknown as CierreGuardado | null) ?? null;
}

/** A seña que vale: a vigente, ou a aplicada (a operação já entregou). */
export function senaQueVale<T extends Pick<SenaGuardada, "estado" | "created_at">>(lista: readonly T[]): T | null {
  return lista.find((s) => s.estado === "vigente") ?? lista.find((s) => s.estado === "aplicada") ?? null;
}

export async function condicaoDaUnidade(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string | null,
): Promise<"0km" | "usado" | null> {
  if (!productId) return null;
  const { data } = await supabase
    .from("catalog_vehicle_details")
    .select("condicion")
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .maybeSingle();
  const c = (data as { condicion?: string } | null)?.condicion;
  return c === "0km" || c === "usado" ? c : null;
}

export interface UnidadSenable {
  product_id: string;
  descripcion: string;
  estado: "disponible" | "reservado";
  condicion: "0km" | "usado";
  preco_cents: number;
  moeda: string;
}

/** As unidades que podem receber seña agora: com ficha, disponível ou reservada. */
export async function listarUnidadesSenables(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<UnidadSenable[]> {
  const { data, error } = await supabase
    .from("catalog_vehicle_details")
    .select("product_id, estado, condicion, modelo, version, anio, catalog_products!inner(nome, marca, preco_cents, moeda, ativo)")
    .eq("organization_id", organizationId)
    .in("estado", ["disponible", "reservado"])
    .limit(300);
  if (error) throw new Error(`ler_unidades_falhou: ${error.message}`);
  type Linha = {
    product_id: string;
    estado: "disponible" | "reservado";
    condicion: "0km" | "usado";
    modelo: string | null;
    version: string | null;
    anio: number | null;
    catalog_products: { nome: string; marca: string | null; preco_cents: number; moeda: string; ativo: boolean } | null;
  };
  return ((data ?? []) as unknown as Linha[])
    .filter((l) => l.catalog_products && l.catalog_products.ativo !== false)
    .map((l) => ({
      product_id: l.product_id,
      descripcion: descreverUnidade({
        marca: l.catalog_products?.marca ?? null,
        nome: l.catalog_products?.nome ?? "",
        modelo: l.modelo,
        version: l.version,
        anio: l.anio,
      }),
      estado: l.estado,
      condicion: l.condicion,
      preco_cents: Number(l.catalog_products?.preco_cents ?? 0),
      moeda: l.catalog_products?.moeda ?? "ARS",
    }))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
}

/** A mesma descrição que o gatilho guarda: marca + (modelo ou nome) + versão + ano. */
export function descreverUnidade(u: {
  marca: string | null;
  nome: string;
  modelo: string | null;
  version: string | null;
  anio: number | null;
}): string {
  return [u.marca?.trim(), u.modelo?.trim() || u.nome.trim(), u.version?.trim(), u.anio ? String(u.anio) : null]
    .filter((x): x is string => Boolean(x))
    .join(" ");
}

// ─── Escrita ─────────────────────────────────────────────────────────────────

export async function registrarSena(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    leadId: string;
    dados: RegistrarSena;
    fecha: string;
    comprobanteId: string | null;
  },
): Promise<{ ok: true; sena: SenaGuardada } | { ok: false; mensagem: string; codigo?: string }> {
  const { data, error } = await supabase
    .from("autoventa_senas")
    .insert({
      organization_id: input.organizationId,
      lead_id: input.leadId,
      product_id: input.dados.product_id,
      monto_cents: input.dados.monto_cents,
      moneda: input.dados.moneda,
      fecha: input.fecha,
      notas: input.dados.notas ?? null,
      comprobante_id: input.comprobanteId,
    })
    .select(COLUNAS_DA_SENA)
    .single();
  if (error) return { ok: false, mensagem: error.message, codigo: error.code };
  return { ok: true, sena: data as unknown as SenaGuardada };
}

export async function anularSena(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; senaId: string; motivo: string },
): Promise<{ ok: true; sena: SenaGuardada } | { ok: false; codigo: "nao_encontrada" | "erro"; mensagem: string }> {
  const { data, error } = await supabase
    .from("autoventa_senas")
    .update({ estado: "anulada", motivo_anulacion: input.motivo })
    .eq("id", input.senaId)
    .eq("organization_id", input.organizationId)
    .eq("lead_id", input.leadId)
    .select(COLUNAS_DA_SENA)
    .maybeSingle();
  if (error) return { ok: false, codigo: "erro", mensagem: error.message };
  if (!data) return { ok: false, codigo: "nao_encontrada", mensagem: "sena_nao_encontrada" };
  return { ok: true, sena: data as unknown as SenaGuardada };
}

export async function ponerComprobante(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; senaId: string; comprobanteId: string },
): Promise<{ ok: true; sena: SenaGuardada } | { ok: false; codigo: "nao_encontrada" | "erro"; mensagem: string }> {
  const { data, error } = await supabase
    .from("autoventa_senas")
    .update({ comprobante_id: input.comprobanteId })
    .eq("id", input.senaId)
    .eq("organization_id", input.organizationId)
    .eq("lead_id", input.leadId)
    .eq("estado", "vigente")
    .select(COLUNAS_DA_SENA)
    .maybeSingle();
  if (error) return { ok: false, codigo: "erro", mensagem: error.message };
  if (!data) return { ok: false, codigo: "nao_encontrada", mensagem: "sena_nao_encontrada" };
  return { ok: true, sena: data as unknown as SenaGuardada };
}

export async function guardarCierre(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; cambios: GuardarCierre },
): Promise<{ ok: true; cierre: CierreGuardado } | { ok: false; mensagem: string }> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.cambios)) if (v !== undefined) patch[k] = v;
  const { data, error } = await supabase
    .from("autoventa_cierres")
    .upsert({ lead_id: input.leadId, organization_id: input.organizationId, ...patch }, { onConflict: "lead_id" })
    .select(COLUNAS_DO_CIERRE)
    .single();
  if (error) return { ok: false, mensagem: error.message };
  return { ok: true, cierre: data as unknown as CierreGuardado };
}

/**
 * Traduz o erro do banco para a frase da tela. O gatilho fala por códigos, e a
 * tela não pode mostrar um identificador.
 */
export function motivoDoErroDaSena(mensagem: string): string {
  if (mensagem.includes("anular_exige_gerente")) return "Só gerente ou administrador pode anular uma seña.";
  if (mensagem.includes("row-level security") || mensagem.includes("permission denied")) {
    return "Seu papel não permite registrar a seña nem a papelada.";
  }
  if (mensagem.includes("unidad_no_disponible") || mensagem.includes("una_vigente_por_unidad")) {
    return "Essa unidade não está mais disponível: outra operação já a reservou ou ela foi vendida.";
  }
  if (mensagem.includes("una_vigente_por_negocio")) return "Esta operação já tem uma seña vigente.";
  if (mensagem.includes("sena_sem_ficha_do_veiculo") || mensagem.includes("sena_sem_unidade")) {
    return "Escolha uma unidade do estoque com a ficha do veículo preenchida.";
  }
  if (mensagem.includes("sena_campo_imutavel")) {
    return "O valor, a moeda, a data e a unidade de uma seña não mudam. Se houve erro, anule e registre outra.";
  }
  if (mensagem.includes("sena_transicao_invalida") || mensagem.includes("sena_encerrada")) {
    return "Essa seña já foi encerrada e não pode mudar.";
  }
  if (mensagem.includes("entrega_sin_sena")) return "Para registrar a entrega, a operação precisa de uma seña vigente.";
  if (mensagem.includes("entrega_ya_registrada")) return "A entrega já foi registrada e não pode mudar.";
  if (mensagem.includes("entrega_no_futuro")) return "A data da entrega não pode ser no futuro.";
  if (mensagem.includes("autoventa_cierres_dominio_check")) return "Patente inválida. Use o formato AB123CD ou ABC123.";
  if (mensagem.includes("sena_nao_encontrada")) return "Seña não encontrada.";
  return "Não foi possível salvar a seña. Tente de novo.";
}

/** O erro do banco é de papel (403) ou de regra (422)? */
export function erroDePapel(mensagem: string): boolean {
  return (
    mensagem.includes("anular_exige_gerente") ||
    mensagem.includes("row-level security") ||
    mensagem.includes("permission denied")
  );
}

// ─── O que o agente recebe ───────────────────────────────────────────────────

export interface CierreParaOAgente {
  sena: "sin_sena" | "vigente" | "aplicada";
  unidad?: string;
  tramites?: Record<string, string>;
  dominio_asignado?: boolean;
  entregado?: boolean;
  instruccion: string;
}

const TRAMITE_PARA_O_AGENTE: Record<string, Record<string, string>> = {
  formulario_08: { pendiente: "pendiente", firmado: "firmado", certificado: "firma certificada" },
  transferencia: { pendiente: "pendiente", en_tramite: "en trámite", inscripta: "inscripta en el registro" },
  patentamiento: { pendiente: "pendiente", en_tramite: "en trámite", patentado: "patentado" },
};

/**
 * O estado da operação como o agente pode contar. NUNCA leva o monto da seña,
 * o comprovante nem a data de entrega combinada: o agente não confirma
 * dinheiro nem promete entrega — a ferramenta não tem o dado para errar.
 * Seña anulada conta como "sin_sena": o motivo é assunto interno.
 */
export function cierreParaOAgente(
  senas: readonly Pick<SenaGuardada, "estado" | "unidad_descripcion" | "created_at">[],
  cierre: Pick<CierreGuardado, "dominio" | "formulario_08" | "transferencia" | "patentamiento" | "entregado_en"> | null,
  condicion: "0km" | "usado" | null,
): CierreParaOAgente {
  const sena = senaQueVale(senas);
  if (!sena) {
    return {
      sena: "sin_sena",
      instruccion:
        "Esta operación no tiene una seña registrada. Nunca le digas a la persona que su seña entró ni que la unidad " +
        "quedó reservada: si dice que ya señó o quiere señar, pasá la conversación a un vendedor.",
    };
  }
  const c = cierre ?? { ...CIERRE_VAZIO };
  const tramites: Record<string, string> = {};
  for (const t of tramitesDaUnidade(condicion)) {
    tramites[t] = TRAMITE_PARA_O_AGENTE[t]?.[c[t]] ?? c[t];
  }
  const entregado = Boolean(c.entregado_en);
  return {
    sena: sena.estado === "aplicada" ? "aplicada" : "vigente",
    unidad: sena.unidad_descripcion || undefined,
    tramites,
    dominio_asignado: Boolean(c.dominio),
    entregado,
    instruccion: entregado
      ? "La unidad ya fue entregada. Si la persona tiene una consulta sobre la papelería o el auto, pasá la conversación a un vendedor."
      : "La seña está registrada y la unidad reservada para esta persona. Podés contarle en qué estado está cada trámite, " +
        "tal cual figura acá. No confirmes montos ni pagos, y nunca prometas ni estimes una fecha de entrega: " +
        "si pregunta cuándo se lo entregan, decile que eso se lo confirma su vendedor y pasale la conversación.",
  };
}

// ─── O negócio ───────────────────────────────────────────────────────────────

/** O negócio existe e é da organização? Devolve o contato e o fuso da agência. */
export async function negocioDaOperacao(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<{ contactId: string | null; fuso: string | null } | null> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!lead) return null;
  const { data: org } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  return {
    contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
    fuso: (org as { timezone?: string | null } | null)?.timezone ?? null,
  };
}
