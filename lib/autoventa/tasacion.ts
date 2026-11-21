/**
 * A TASAÇÃO DO USADO — fork AutoVenta, etapa 3.
 *
 * Mora em `autoventa_tasaciones` (migration 9904), uma linha por tasação de um
 * negócio. Retasar cria outra linha: a anterior fica como histórico, porque o
 * valor que a agência ofereceu pelo auto do cliente é exatamente o número que
 * alguém vai discutir depois.
 *
 * ─── Quem faz o quê ─────────────────────────────────────────────────────────
 *
 *  - O CLIENTE conta o usado (marca, modelo, km…): isso são campos do funil
 *    (`usado_*`), que o agente grava pelo `crm_update_lead`.
 *  - O agente de IA, o vendedor ou o gerente PEDEM a tasação (`pendiente`, sem
 *    valor). Um pedido aberto por negócio — o índice parcial do banco garante.
 *  - Só GERENTE para cima TASA: valor, moeda e vencimento.
 *  - O vendedor registra o que o cliente RESPONDEU: `aceptada` ou `rechazada`.
 *
 * O banco é quem barra (gatilho + RLS); este módulo dá a mesma régua à tela,
 * à rota e ao agente, para os três dizerem o mesmo sobre o que está vigente.
 *
 * ─── O que o agente pode dizer ──────────────────────────────────────────────
 *
 * Só o valor de uma tasação `tasado` VIGENTE (ou já aceita). Pendente,
 * vencida ou rechazada: ele não fala número nenhum — `tasacionParaOAgente`
 * nem devolve o valor nesses casos, para a regra não depender só do prompt.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { formatCents } from "@/lib/money";

export const ESTADOS_DE_LA_TASACION = ["pendiente", "tasado", "aceptada", "rechazada"] as const;
export const MONEDAS_DE_LA_TASACION = ["ARS", "USD"] as const;
export const ORIGENES_DE_LA_TASACION = ["persona", "agente"] as const;

export type EstadoDeLaTasacion = (typeof ESTADOS_DE_LA_TASACION)[number];
export type MonedaDeLaTasacion = (typeof MONEDAS_DE_LA_TASACION)[number];
export type OrigenDeLaTasacion = (typeof ORIGENES_DE_LA_TASACION)[number];

/** Quantos dias a oferta vale quando quem tasa não escolhe outra data. */
export const VIGENCIA_PADRAO_DIAS = 7;

/** Os campos do funil que descrevem o usado (migration 9904). */
export const CAMPOS_DEL_USADO = [
  "usado_entrega",
  "usado_marca",
  "usado_modelo",
  "usado_version",
  "usado_anio",
  "usado_kilometros",
  "usado_combustible",
  "usado_transmision",
  "usado_color",
  "usado_duenos",
  "usado_estado",
  "usado_fotos",
] as const;

/** O funil tem os campos do usado? É o sinal de que a seção da tasação existe. */
export function funilTemUsado(campos: ReadonlyArray<{ key: string }>): boolean {
  return campos.some((c) => c.key === "usado_entrega");
}

/**
 * Como a tasação está HOJE. "Vencida" não é estado do banco: é `tasado` com o
 * vencimento no passado, e por isso é lida na hora, no fuso da agência.
 */
export type SituacionDeLaTasacion = "pendiente" | "vigente" | "vencida" | "aceptada" | "rechazada";

export const ROTULOS_DA_SITUACAO: Record<SituacionDeLaTasacion, string> = {
  pendiente: "Pendente",
  vigente: "Vigente",
  vencida: "Vencida",
  aceptada: "Aceita pelo cliente",
  rechazada: "Recusada pelo cliente",
};

export interface TasacionGuardada {
  id: string;
  lead_id: string;
  estado: EstadoDeLaTasacion;
  valor_cents: number | null;
  moneda: MonedaDeLaTasacion | null;
  vence_en: string | null;
  notas: string | null;
  origen: OrigenDeLaTasacion;
  creada_por: string | null;
  tasada_por: string | null;
  tasada_en: string | null;
  created_at: string;
}

export const COLUNAS_DA_TASACAO =
  "id, lead_id, estado, valor_cents, moneda, vence_en, notas, origen, creada_por, tasada_por, tasada_en, created_at";

/** `YYYY-MM-DD` do dia de hoje no fuso pedido. Fuso inválido cai em UTC. */
export function hojeNoFuso(fuso: string | null | undefined, agora: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(agora);
  } catch {
    return agora.toISOString().slice(0, 10);
  }
}

/** Soma dias a uma data `YYYY-MM-DD`, sem passar por fuso. */
export function somarDias(data: string, dias: number): string {
  const [a = 1970, m = 1, d = 1] = data.split("-").map(Number);
  const utc = new Date(Date.UTC(a, m - 1, d + dias));
  return utc.toISOString().slice(0, 10);
}

export function situacaoDaTasacion(
  t: Pick<TasacionGuardada, "estado" | "vence_en">,
  hoje: string,
): SituacionDeLaTasacion {
  if (t.estado === "pendiente") return "pendiente";
  if (t.estado === "aceptada") return "aceptada";
  if (t.estado === "rechazada") return "rechazada";
  // `vence_en` é o ÚLTIMO dia em que a oferta vale.
  return t.vence_en !== null && t.vence_en < hoje ? "vencida" : "vigente";
}

/** A mais recente primeiro — é ela que vale; as outras são histórico. */
export function ordenarTasaciones<T extends Pick<TasacionGuardada, "created_at">>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Data inválida.");

const notas = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Pedir uma tasação: sem valor, no máximo uma observação. */
export const pedirTasacionSchema = z.object({
  accion: z.literal("pedir"),
  notas,
});

/** Tasar: o valor em centavos, a moeda e até quando a oferta vale. */
export const tasarSchema = z.object({
  accion: z.literal("tasar"),
  valor_cents: z.number().int().positive().max(9_000_000_000_000),
  moneda: z.enum(MONEDAS_DE_LA_TASACION),
  vence_en: dataIso.optional(),
  notas,
});

export const crearTasacionSchema = z.discriminatedUnion("accion", [pedirTasacionSchema, tasarSchema]);
export type CrearTasacion = z.infer<typeof crearTasacionSchema>;

/**
 * Mudar uma tasação existente: registrar a resposta do cliente, ou (gerente)
 * estender o vencimento e corrigir as notas. Valor e moeda não mudam aqui:
 * retasar é uma tasação nova.
 */
export const actualizarTasacionSchema = z
  .object({
    estado: z.enum(["aceptada", "rechazada"]).optional(),
    vence_en: dataIso.optional(),
    notas,
  })
  .refine((v) => v.estado !== undefined || v.vence_en !== undefined || v.notas !== undefined, {
    message: "Nada para alterar.",
  });
export type ActualizarTasacion = z.infer<typeof actualizarTasacionSchema>;

// ─── Leitura e escrita ───────────────────────────────────────────────────────

export async function listarTasaciones(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<TasacionGuardada[]> {
  const { data, error } = await supabase
    .from("autoventa_tasaciones")
    .select(COLUNAS_DA_TASACAO)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(50);
  // Falha de leitura LANÇA: tratar como "sem tasação" faria o agente dizer ao
  // cliente que ninguém tasou o auto dele, e a tela esconder uma oferta feita.
  if (error) throw new Error(`ler_tasaciones_falhou: ${error.message}`);
  return (data ?? []) as unknown as TasacionGuardada[];
}

export type ResultadoDoPedido =
  | { ok: true; tasacion: TasacionGuardada; jaExistia: boolean }
  | { ok: false; codigo: "ja_tasada_vigente"; tasacion: TasacionGuardada }
  | { ok: false; codigo: "erro"; mensagem: string };

/**
 * Pede uma tasação. Idempotente: se já há um pedido aberto, devolve o mesmo
 * (o agente pedir duas vezes na conversa não cria duas pendências). Se já há
 * uma tasação vigente, não pede outra — quem quer retasar é o gerente, pela tela.
 */
export async function pedirTasacion(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    leadId: string;
    origen: OrigenDeLaTasacion;
    notas?: string | null;
    hoje: string;
  },
): Promise<ResultadoDoPedido> {
  const existentes = await listarTasaciones(supabase, input.organizationId, input.leadId);
  const aberta = existentes.find((t) => t.estado === "pendiente");
  if (aberta) return { ok: true, tasacion: aberta, jaExistia: true };
  const atual = existentes[0];
  if (atual && situacaoDaTasacion(atual, input.hoje) === "vigente") {
    return { ok: false, codigo: "ja_tasada_vigente", tasacion: atual };
  }

  const { data, error } = await supabase
    .from("autoventa_tasaciones")
    .insert({
      organization_id: input.organizationId,
      lead_id: input.leadId,
      estado: "pendiente",
      origen: input.origen,
      notas: input.notas ?? null,
    })
    .select(COLUNAS_DA_TASACAO)
    .single();
  if (error) {
    // Corrida com outro pedido do mesmo negócio: o índice parcial recusou, e o
    // pedido que ganhou é a resposta certa.
    if (error.code === "23505") {
      const depois = await listarTasaciones(supabase, input.organizationId, input.leadId);
      const ganhou = depois.find((t) => t.estado === "pendiente");
      if (ganhou) return { ok: true, tasacion: ganhou, jaExistia: true };
    }
    return { ok: false, codigo: "erro", mensagem: error.message };
  }
  return { ok: true, tasacion: data as unknown as TasacionGuardada, jaExistia: false };
}

/**
 * Tasa: se há pedido aberto, é ele que recebe o valor (pendiente → tasado);
 * senão nasce uma tasação nova, já feita. A anterior, se houver, vira histórico.
 */
export async function tasar(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    leadId: string;
    valorCents: number;
    moneda: MonedaDeLaTasacion;
    venceEn: string;
    notas?: string | null;
  },
): Promise<{ ok: true; tasacion: TasacionGuardada } | { ok: false; mensagem: string }> {
  const existentes = await listarTasaciones(supabase, input.organizationId, input.leadId);
  const aberta = existentes.find((t) => t.estado === "pendiente");
  const valores = {
    estado: "tasado" as const,
    valor_cents: input.valorCents,
    moneda: input.moneda,
    vence_en: input.venceEn,
    ...(input.notas !== undefined ? { notas: input.notas } : {}),
  };

  const consulta = aberta
    ? supabase
        .from("autoventa_tasaciones")
        .update(valores)
        .eq("id", aberta.id)
        .eq("organization_id", input.organizationId)
        .eq("estado", "pendiente")
    : supabase.from("autoventa_tasaciones").insert({
        organization_id: input.organizationId,
        lead_id: input.leadId,
        origen: "persona",
        ...valores,
      });

  const { data, error } = await consulta.select(COLUNAS_DA_TASACAO).maybeSingle();
  if (error) return { ok: false, mensagem: error.message };
  if (!data) return { ok: false, mensagem: "tasacion_nao_gravada" };
  return { ok: true, tasacion: data as unknown as TasacionGuardada };
}

export async function actualizarTasacion(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; tasacionId: string; cambios: ActualizarTasacion },
): Promise<{ ok: true; tasacion: TasacionGuardada } | { ok: false; codigo: "nao_encontrada" | "erro"; mensagem: string }> {
  const patch: Record<string, unknown> = {};
  if (input.cambios.estado !== undefined) patch.estado = input.cambios.estado;
  if (input.cambios.vence_en !== undefined) patch.vence_en = input.cambios.vence_en;
  if (input.cambios.notas !== undefined) patch.notas = input.cambios.notas;

  const { data, error } = await supabase
    .from("autoventa_tasaciones")
    .update(patch)
    .eq("id", input.tasacionId)
    .eq("organization_id", input.organizationId)
    .eq("lead_id", input.leadId)
    .select(COLUNAS_DA_TASACAO)
    .maybeSingle();
  if (error) return { ok: false, codigo: "erro", mensagem: error.message };
  if (!data) return { ok: false, codigo: "nao_encontrada", mensagem: "tasacion_nao_encontrada" };
  return { ok: true, tasacion: data as unknown as TasacionGuardada };
}

/**
 * Traduz o erro do banco para a frase da tela. O gatilho fala por códigos
 * (`tasar_exige_gerente`, `retasar_e_uma_tasacion_nova`…), e a tela não pode
 * mostrar um identificador.
 */
export function motivoDoErroDaTasacion(mensagem: string): string {
  if (mensagem.includes("tasar_exige_gerente") || mensagem.includes("row-level security")) {
    return "Só gerente ou administrador pode tasar ou mudar a tasação.";
  }
  if (mensagem.includes("retasar_e_uma_tasacion_nova")) {
    return "O valor de uma tasação feita não muda. Para outro valor, faça uma tasação nova.";
  }
  if (mensagem.includes("tasacion_transicao_invalida")) {
    return "Essa tasação já foi respondida e não pode mudar de estado.";
  }
  if (mensagem.includes("tasacion_nao_encontrada")) return "Tasação não encontrada.";
  return "Não foi possível salvar a tasação. Tente de novo.";
}

// ─── O que o agente recebe ───────────────────────────────────────────────────

export interface TasacionParaOAgente {
  situacion: SituacionDeLaTasacion | "sin_tasacion";
  /** Só presente quando o agente PODE repetir o valor ao cliente. */
  valor?: string;
  moneda?: MonedaDeLaTasacion;
  vence_en?: string;
  instruccion: string;
}

export function tasacionParaOAgente(
  lista: readonly TasacionGuardada[],
  hoje: string,
): TasacionParaOAgente {
  const atual = ordenarTasaciones(lista)[0];
  if (!atual) {
    return {
      situacion: "sin_tasacion",
      instruccion:
        "Nadie tasó todavía el usado de esta persona. No le des ningún valor, ni aproximado. " +
        "Si ya tenés los datos del usado, pedí la tasación con autoventa_pedir_tasacion.",
    };
  }
  const situacion = situacaoDaTasacion(atual, hoje);
  if (situacion === "pendiente") {
    return {
      situacion,
      instruccion:
        "La tasación está pedida y el equipo todavía no la hizo. No le des ningún valor; " +
        "decile que un tasador la está revisando y que le avisan.",
    };
  }
  if (situacion === "vigente" || situacion === "aceptada") {
    return {
      situacion,
      valor: formatCents(atual.valor_cents ?? 0, atual.moneda ?? "ARS"),
      moneda: atual.moneda ?? undefined,
      vence_en: atual.vence_en ?? undefined,
      instruccion:
        situacion === "vigente"
          ? "Podés decirle este valor, tal cual, en la moneda en que está, y hasta qué día vale la oferta. " +
            "Aclarale que está sujeto a ver el auto en persona. No lo cambies ni lo negocies: si pide más, pasá la conversación a un vendedor."
          : "La persona ya aceptó esta tasación. Podés recordarle el valor tal cual; para avanzar, pasá la conversación a un vendedor.",
    };
  }
  if (situacion === "vencida") {
    return {
      situacion,
      vence_en: atual.vence_en ?? undefined,
      instruccion:
        "La oferta por el usado venció. No repitas el valor anterior: decile que hay que actualizar la tasación y pedila de nuevo con autoventa_pedir_tasacion.",
    };
  }
  return {
    situacion,
    instruccion:
      "La persona rechazó la tasación. No ofrezcas otro valor: si quiere negociar, pasá la conversación a un vendedor.",
  };
}
