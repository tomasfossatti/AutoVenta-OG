/**
 * PATCH /api/v1/leads/:id/senas/:senaId — `{ accion: "anular", motivo }`.
 *       Só gerente para cima: a unidade volta a `disponible` pelo gatilho.
 * POST  /api/v1/leads/:id/senas/:senaId — sobe o comprovante (multipart,
 *       arquivo `comprobante`) de uma seña vigente. Vendedor para cima.
 *
 * Monto, moeda, data e unidade não mudam: errou, anula e registra outra
 * (o banco recusa, migration 9905).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { lerCorpoComTeto } from "@/lib/api/corpo-com-teto";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { COMPROBANTE_MAX_BYTES, descartarComprobante, subirComprobante } from "@/lib/autoventa/comprobante";
import {
  anularSena,
  anularSenaSchema,
  erroDePapel,
  motivoDoErroDaSena,
  negocioDaOperacao,
  ponerComprobante,
} from "@/lib/autoventa/sena";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; senaId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const parsed = anularSenaSchema.safeParse(await req.json().catch(() => null));
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "manager",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  if (!parsed.success) {
    return fail("validation_failed", t(parsed.error.issues[0]?.message ?? "Dados inválidos."), 422, { requestId });
  }
  const teto = await tetoDeEscritaDoToken(authz, "autoventa_senas", requestId);
  if (teto) return teto;

  const { id: leadId, senaId } = await ctx.params;
  const negocio = await negocioDaOperacao(authz.supabase, authz.organizationId, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  try {
    const r = await anularSena(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      senaId,
      motivo: parsed.data.motivo,
    });
    if (!r.ok) {
      if (r.codigo === "nao_encontrada") return fail("not_found", t("Seña não encontrada."), 404, { requestId });
      const papel = erroDePapel(r.mensagem);
      return fail(papel ? "forbidden_role" : "validation_failed", t(motivoDoErroDaSena(r.mensagem)), papel ? 403 : 422, {
        requestId,
      });
    }
    await audit({
      action: "autoventa_sena.voided",
      actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
      actorApiTokenId: authz.apiTokenId ?? null,
      organizationId: authz.organizationId,
      resourceType: "autoventa_senas",
      resourceId: senaId,
      metadata: { lead_id: leadId, motivo: parsed.data.motivo, product_id: r.sena.product_id },
      requestId,
    });
    void emitLeadActivity(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      contactId: negocio.contactId,
      type: "lead_edited",
      sourceModule: "autoventa/sena",
      sourceId: senaId,
      actor: authz.actor,
      reason: `Seña anulada: ${parsed.data.motivo}`,
      payload: { sena_id: senaId, estado: "anulada" },
    }).catch(() => null);
    return ok({ sena: r.sena }, { requestId });
  } catch (err) {
    logger.error("[autoventa/senas] erro ao anular", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível salvar a seña. Tente de novo."), 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  const teto = await tetoDeEscritaDoToken(authz, "autoventa_senas", requestId);
  if (teto) return teto;

  const corpo = await lerCorpoComTeto(req, COMPROBANTE_MAX_BYTES + 1_048_576, {
    requestId,
    idioma: authz.idioma,
    acimaDoTeto: t("O comprovante excede o limite de 20 MB."),
  });
  if (!corpo.ok) return corpo.response;
  const form = await corpo.corpo.formData().catch(() => null);
  const arquivo = form?.get("comprobante");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return fail("validation_failed", t("Arquivo não informado."), 422, { requestId });
  }

  const { id: leadId, senaId } = await ctx.params;
  const negocio = await negocioDaOperacao(authz.supabase, authz.organizationId, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  const actorUserId = authz.actor.type === "user" ? authz.actor.id : null;
  const subida = await subirComprobante(authz.supabase, {
    organizationId: authz.organizationId,
    leadId,
    arquivo,
    criadoPor: actorUserId,
    requestId,
  });
  if (!subida.ok) {
    const status = subida.codigo === "grande" ? 413 : subida.codigo === "formato" ? 415 : 500;
    const codigo = subida.codigo === "grande" ? "payload_too_large" : subida.codigo === "formato" ? "unsupported_media_type" : "internal_error";
    return fail(codigo, t(subida.mensagem), status, { requestId });
  }

  const r = await ponerComprobante(authz.supabase, {
    organizationId: authz.organizationId,
    leadId,
    senaId,
    comprobanteId: subida.attachmentId,
  });
  if (!r.ok) {
    await descartarComprobante(authz.supabase, { organizationId: authz.organizationId, attachmentId: subida.attachmentId });
    if (r.codigo === "nao_encontrada") {
      return fail("not_found", t("Seña não encontrada ou já encerrada."), 404, { requestId });
    }
    const papel = erroDePapel(r.mensagem);
    return fail(papel ? "forbidden_role" : "validation_failed", t(motivoDoErroDaSena(r.mensagem)), papel ? 403 : 422, {
      requestId,
    });
  }
  await audit({
    action: "autoventa_sena.receipt_attached",
    actorUserId,
    actorApiTokenId: authz.apiTokenId ?? null,
    organizationId: authz.organizationId,
    resourceType: "autoventa_senas",
    resourceId: senaId,
    metadata: { lead_id: leadId, attachment_id: subida.attachmentId, file_name: subida.nome },
    requestId,
  });
  void emitLeadActivity(authz.supabase, {
    organizationId: authz.organizationId,
    leadId,
    contactId: negocio.contactId,
    type: "document_attached",
    sourceModule: "autoventa/sena",
    sourceId: senaId,
    actor: authz.actor,
    reason: "Comprobante de la seña adjuntado",
    payload: { sena_id: senaId, file_name: subida.nome },
  }).catch(() => null);
  return ok({ sena: r.sena }, { requestId });
}
