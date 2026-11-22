/**
 * GET  /api/v1/leads/:id/tasaciones — as tasações do usado deste negócio, a
 *      mais recente primeiro, com a situação de hoje (vigente, vencida…).
 * POST /api/v1/leads/:id/tasaciones — `{ accion: "pedir" }` (vendedor+) ou
 *      `{ accion: "tasar", valor_cents, moneda, vence_en? }` (gerente+).
 *
 * Fork AutoVenta, etapa 3 (migration 9904). O papel é decidido AQUI, antes de
 * escrever: pela chave de API a rota recebe o cliente de serviço, que passa
 * por cima da RLS, e o gatilho do banco trata a escrita sem usuário como do
 * servidor. Pela sessão, a RLS e o gatilho conferem de novo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken, type AuthDual } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  VIGENCIA_PADRAO_DIAS,
  crearTasacionSchema,
  hojeNoFuso,
  listarTasaciones,
  motivoDoErroDaTasacion,
  pedirTasacion,
  situacaoDaTasacion,
  somarDias,
  tasar,
  type TasacionGuardada,
} from "@/lib/autoventa/tasacion";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

type AuthOk = Extract<AuthDual, { ok: true }>;

/** O negócio existe e é da organização? Devolve o fuso da agência junto. */
async function negocioEFuso(
  authz: AuthOk,
  leadId: string,
): Promise<{ contactId: string | null; fuso: string | null } | null> {
  const { data: lead } = await authz.supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", authz.organizationId)
    .maybeSingle();
  if (!lead) return null;
  const { data: org } = await authz.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", authz.organizationId)
    .maybeSingle();
  return {
    contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
    fuso: (org as { timezone?: string | null } | null)?.timezone ?? null,
  };
}

function comSituacao(lista: TasacionGuardada[], hoje: string) {
  return lista.map((t) => ({ ...t, situacion: situacaoDaTasacion(t, hoje) }));
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

  const negocio = await negocioEFuso(authz, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  try {
    const lista = await listarTasaciones(authz.supabase, authz.organizationId, leadId);
    const hoje = hojeNoFuso(negocio.fuso);
    return ok({ tasaciones: comSituacao(lista, hoje), hoy: hoje }, { requestId });
  } catch (err) {
    logger.error("[autoventa/tasaciones] erro ao listar", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível carregar a tasação."), 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const corpo = await req.json().catch(() => null);
  const parsed = crearTasacionSchema.safeParse(corpo);
  // O papel depende da ação: pedir é do vendedor, tasar é do gerente.
  const tasando = parsed.success && parsed.data.accion === "tasar";
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: tasando ? "manager" : "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const teto = await tetoDeEscritaDoToken(authz, "autoventa_tasaciones", requestId);
  if (teto) return teto;

  const { id: leadId } = await ctx.params;
  const negocio = await negocioEFuso(authz, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const hoje = hojeNoFuso(negocio.fuso);
  const ator = {
    actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
    actorApiTokenId: authz.apiTokenId ?? null,
  };

  try {
    if (parsed.data.accion === "pedir") {
      const r = await pedirTasacion(authz.supabase, {
        organizationId: authz.organizationId,
        leadId,
        origen: "persona",
        notas: parsed.data.notas ?? null,
        hoje,
      });
      if (!r.ok) {
        if (r.codigo === "ja_tasada_vigente") {
          return fail("state_conflict", t("Este negócio já tem uma tasação vigente."), 409, { requestId });
        }
        return fail("validation_failed", t(motivoDoErroDaTasacion(r.mensagem)), 422, { requestId });
      }
      if (!r.jaExistia) {
        await audit({
          action: "autoventa_tasacion.requested",
          ...ator,
          organizationId: authz.organizationId,
          resourceType: "autoventa_tasaciones",
          resourceId: r.tasacion.id,
          metadata: { lead_id: leadId, origen: "persona" },
          requestId,
        });
        void emitLeadActivity(authz.supabase, {
          organizationId: authz.organizationId,
          leadId,
          contactId: negocio.contactId,
          type: "lead_edited",
          sourceModule: "autoventa/tasacion",
          sourceId: r.tasacion.id,
          actor: authz.actor,
          reason: "Tasación del usado pedida",
          payload: { tasacion_id: r.tasacion.id, estado: "pendiente" },
        }).catch(() => null);
      }
      return ok({ tasacion: { ...r.tasacion, situacion: "pendiente" } }, { requestId, status: r.jaExistia ? 200 : 201 });
    }

    const venceEn = parsed.data.vence_en ?? somarDias(hoje, VIGENCIA_PADRAO_DIAS);
    if (venceEn < hoje) {
      return fail("validation_failed", t("O vencimento não pode ser no passado."), 422, { requestId });
    }
    const r = await tasar(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      valorCents: parsed.data.valor_cents,
      moneda: parsed.data.moneda,
      venceEn,
      notas: parsed.data.notas,
    });
    if (!r.ok) {
      const status = r.mensagem.includes("tasar_exige_gerente") || r.mensagem.includes("row-level security") ? 403 : 422;
      return fail(status === 403 ? "forbidden_role" : "validation_failed", t(motivoDoErroDaTasacion(r.mensagem)), status, {
        requestId,
      });
    }
    const valor = formatCents(parsed.data.valor_cents, parsed.data.moneda);
    await audit({
      action: "autoventa_tasacion.valued",
      ...ator,
      organizationId: authz.organizationId,
      resourceType: "autoventa_tasaciones",
      resourceId: r.tasacion.id,
      metadata: {
        lead_id: leadId,
        valor_cents: parsed.data.valor_cents,
        moneda: parsed.data.moneda,
        vence_en: venceEn,
      },
      requestId,
    });
    void emitLeadActivity(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      contactId: negocio.contactId,
      type: "lead_edited",
      sourceModule: "autoventa/tasacion",
      sourceId: r.tasacion.id,
      actor: authz.actor,
      reason: `Usado tasado en ${valor}, vale hasta el ${venceEn}`,
      payload: { tasacion_id: r.tasacion.id, estado: "tasado", valor_cents: parsed.data.valor_cents, moneda: parsed.data.moneda },
    }).catch(() => null);
    return ok({ tasacion: { ...r.tasacion, situacion: situacaoDaTasacion(r.tasacion, hoje) } }, { requestId, status: 201 });
  } catch (err) {
    logger.error("[autoventa/tasaciones] erro ao gravar", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível salvar a tasação. Tente de novo."), 500, { requestId });
  }
}
