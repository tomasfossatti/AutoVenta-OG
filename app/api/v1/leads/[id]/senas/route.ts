/**
 * GET  /api/v1/leads/:id/senas — as unidades do estoque que podem receber seña
 *      agora (com ficha, `disponible` ou `reservado`), para o seletor da tela.
 * POST /api/v1/leads/:id/senas — registra a seña (multipart: `product_id`,
 *      `monto_cents`, `moneda`, `fecha?`, `notas?` e o arquivo `comprobante?`).
 *      Vendedor para cima. A unidade passa a `senado` pelo gatilho do banco, e
 *      o negócio vai para a etapa "Señado" do funil (só para frente).
 *
 * Fork AutoVenta, etapa 3, parte 2 (migration 9905). O estado da operação
 * inteiro (señas + papelada) se lê em `GET /api/v1/leads/:id/cierre`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { lerCorpoComTeto } from "@/lib/api/corpo-com-teto";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { COMPROBANTE_MAX_BYTES, descartarComprobante, subirComprobante } from "@/lib/autoventa/comprobante";
import {
  erroDePapel,
  listarUnidadesSenables,
  motivoDoErroDaSena,
  moverParaSenado,
  negocioDaOperacao,
  registrarSena,
  registrarSenaSchema,
} from "@/lib/autoventa/sena";
import { hojeNoFuso } from "@/lib/autoventa/tasacion";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "viewer",
    scope: "mcp:read",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  const { id: leadId } = await ctx.params;

  const negocio = await negocioDaOperacao(authz.supabase, authz.organizationId, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  try {
    const unidades = await listarUnidadesSenables(authz.supabase, authz.organizationId);
    return ok({ unidades }, { requestId });
  } catch (err) {
    logger.error("[autoventa/senas] erro ao listar unidades", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível carregar as unidades do estoque."), 500, { requestId });
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
  if (!form) return fail("validation_failed", t("Requisição multipart inválida."), 400, { requestId });

  const texto = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = registrarSenaSchema.safeParse({
    product_id: texto("product_id"),
    monto_cents: texto("monto_cents"),
    moneda: texto("moneda"),
    fecha: texto("fecha") || undefined,
    notas: texto("notas"),
  });
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const { id: leadId } = await ctx.params;
  const negocio = await negocioDaOperacao(authz.supabase, authz.organizationId, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const hoje = hojeNoFuso(negocio.fuso);
  const fecha = parsed.data.fecha ?? hoje;
  if (fecha > hoje) {
    return fail("validation_failed", t("A data da seña não pode ser no futuro."), 422, { requestId });
  }

  const ator = {
    actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
    actorApiTokenId: authz.apiTokenId ?? null,
  };

  // O comprovante sobe ANTES da seña (a linha aponta para ele); se a seña não
  // entrar, o anexo é desfeito.
  let comprobanteId: string | null = null;
  const arquivo = form.get("comprobante");
  if (arquivo instanceof File && arquivo.size > 0) {
    const subida = await subirComprobante(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      arquivo,
      criadoPor: ator.actorUserId,
      requestId,
    });
    if (!subida.ok) {
      const status = subida.codigo === "grande" ? 413 : subida.codigo === "formato" ? 415 : 500;
      const codigo = subida.codigo === "grande" ? "payload_too_large" : subida.codigo === "formato" ? "unsupported_media_type" : "internal_error";
      return fail(codigo, t(subida.mensagem), status, { requestId });
    }
    comprobanteId = subida.attachmentId;
  }

  try {
    const r = await registrarSena(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      dados: parsed.data,
      fecha,
      comprobanteId,
    });
    if (!r.ok) {
      if (comprobanteId) {
        await descartarComprobante(authz.supabase, { organizationId: authz.organizationId, attachmentId: comprobanteId });
      }
      const papel = erroDePapel(r.mensagem);
      const conflito = r.codigo === "23505" || r.mensagem.includes("unidad_no_disponible");
      return fail(
        papel ? "forbidden_role" : conflito ? "state_conflict" : "validation_failed",
        t(motivoDoErroDaSena(r.mensagem)),
        papel ? 403 : conflito ? 409 : 422,
        { requestId },
      );
    }

    const monto = formatCents(parsed.data.monto_cents, parsed.data.moneda);
    await audit({
      action: "autoventa_sena.registered",
      ...ator,
      organizationId: authz.organizationId,
      resourceType: "autoventa_senas",
      resourceId: r.sena.id,
      metadata: {
        lead_id: leadId,
        product_id: parsed.data.product_id,
        monto_cents: parsed.data.monto_cents,
        moneda: parsed.data.moneda,
        fecha,
        con_comprobante: comprobanteId !== null,
      },
      requestId,
    });
    void emitLeadActivity(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      contactId: negocio.contactId,
      type: "lead_edited",
      sourceModule: "autoventa/sena",
      sourceId: r.sena.id,
      actor: authz.actor,
      reason: `Seña de ${monto} registrada por ${r.sena.unidad_descripcion || "la unidad"}`,
      payload: { sena_id: r.sena.id, estado: "vigente", monto_cents: parsed.data.monto_cents, moneda: parsed.data.moneda },
    }).catch(() => null);

    // O card vai para "Señado". O cliente admin: a seña já foi autorizada
    // acima, e o movimento é efeito dela (mesmo desenho do agendamento).
    const movimento = await moverParaSenado(createAdminClient(), {
      organizationId: authz.organizationId,
      leadId,
      actor: authz.actor,
    });

    return ok({ sena: r.sena, movimento }, { requestId, status: 201 });
  } catch (err) {
    logger.error("[autoventa/senas] erro ao registrar", { error: String(err), requestId });
    if (comprobanteId) {
      await descartarComprobante(authz.supabase, { organizationId: authz.organizationId, attachmentId: comprobanteId });
    }
    return fail("internal_error", t("Não foi possível salvar a seña. Tente de novo."), 500, { requestId });
  }
}
