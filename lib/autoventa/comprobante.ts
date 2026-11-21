/**
 * O COMPROVANTE DA SEÑA — fork AutoVenta, etapa 3, parte 2.
 *
 * O arquivo é um anexo do negócio como qualquer outro (`crm_lead_attachments`,
 * campo `sena_comprobante`), no bucket privado `internal-media`, sob o mesmo
 * caminho que a rota de anexos usa (`{org}/leads/{lead}/{campo}/{id}.{ext}`).
 * Assim a rota de mídia assinada, a varredura de órfãos e a anonimização já o
 * alcançam, sem mecanismo novo. A diferença para a rota de anexos: o campo não
 * precisa estar declarado no funil — quem o cria é a seña.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { CAMPO_DEL_COMPROBANTE } from "./sena";

const BUCKET = "internal-media";
export const COMPROBANTE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB: foto ou PDF de transferência

const MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]);

export type ResultadoDoComprobante =
  | { ok: true; attachmentId: string; nome: string }
  | { ok: false; codigo: "grande" | "formato" | "falha"; mensagem: string };

export async function subirComprobante(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; arquivo: File; criadoPor: string | null; requestId: string },
): Promise<ResultadoDoComprobante> {
  const { arquivo } = input;
  if (arquivo.size > COMPROBANTE_MAX_BYTES) {
    return { ok: false, codigo: "grande", mensagem: "O comprovante excede o limite de 20 MB." };
  }
  if (!MIMES.has(arquivo.type.toLowerCase())) {
    return { ok: false, codigo: "formato", mensagem: "Formato inválido. Envie PDF ou imagem (PNG, JPG, WebP)." };
  }
  const id = randomUUID();
  const nomeSeguro = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = nomeSeguro.includes(".") ? nomeSeguro.split(".").pop() : "bin";
  // `leadId` em minúsculas: o banco confere o caminho contra `lead_id::text`.
  const caminho = `${input.organizationId}/leads/${input.leadId.toLowerCase()}/${CAMPO_DEL_COMPROBANTE}/${id}.${ext}`;

  const admin = createAdminClient();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const { error: erroUpload } = await admin.storage
    .from(BUCKET)
    .upload(caminho, bytes, { contentType: arquivo.type, upsert: false });
  if (erroUpload) {
    logger.error("[autoventa/comprobante] upload falhou", { detalhe: erroUpload.message, requestId: input.requestId });
    return { ok: false, codigo: "falha", mensagem: "Falha ao salvar o comprovante." };
  }

  const { error } = await supabase.from("crm_lead_attachments").insert({
    id,
    organization_id: input.organizationId,
    lead_id: input.leadId,
    field_key: CAMPO_DEL_COMPROBANTE,
    file_name: arquivo.name,
    file_size: arquivo.size,
    mime_type: arquivo.type,
    storage_path: caminho,
    created_by: input.criadoPor,
  });
  if (error) {
    logger.error("[autoventa/comprobante] insert falhou", { detalhe: error.message, requestId: input.requestId });
    await admin.storage.from(BUCKET).remove([caminho]).catch(() => null);
    return { ok: false, codigo: "falha", mensagem: "Falha ao salvar o comprovante." };
  }
  return { ok: true, attachmentId: id, nome: arquivo.name };
}

/** Desfaz um comprovante que subiu mas cuja seña não foi gravada. */
export async function descartarComprobante(
  supabase: SupabaseClient,
  input: { organizationId: string; attachmentId: string },
): Promise<void> {
  const { data } = await supabase
    .from("crm_lead_attachments")
    .delete()
    .eq("id", input.attachmentId)
    .eq("organization_id", input.organizationId)
    .select("storage_path")
    .maybeSingle();
  const caminho = (data as { storage_path?: string } | null)?.storage_path;
  if (caminho) await createAdminClient().storage.from(BUCKET).remove([caminho]).catch(() => null);
}

/** Os nomes dos comprovantes, para a tela mostrar o link com o nome do arquivo. */
export async function nomesDosComprobantes(
  supabase: SupabaseClient,
  organizationId: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from("crm_lead_attachments")
    .select("id, file_name")
    .eq("organization_id", organizationId)
    .in("id", ids);
  return Object.fromEntries(((data ?? []) as Array<{ id: string; file_name: string }>).map((r) => [r.id, r.file_name]));
}
