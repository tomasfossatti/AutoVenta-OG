/**
 * PATCH /api/v1/leads/:id/tasaciones/:tasacionId
 *
 *  - `{ estado: "aceptada" | "rechazada" }` — o que o cliente respondeu à
 *    oferta. Vendedor para cima: é ele quem está na conversa.
 *  - `{ vence_en, notas }` — estender a oferta ou corrigir a observação.
 *    Gerente para cima.
 *
 * Valor e moeda não mudam por aqui: retasar é uma tasação nova (POST), e o
 * banco recusa a troca do valor de uma tasação feita (migration 9904).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  actualizarTasacion,
  actualizarTasacionSchema,
  hojeNoFuso,
  motivoDoErroDaTasacion,
  situacaoDaTasacion,
} from "@/lib/autoventa/tasacion";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; tasacionId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const parsed = actualizarTasacionSchema.safeParse(await req.json().catch(() => null));
  // Só a resposta do cliente é do vendedor; vencimento e notas são do gerente.
  const soResposta =
    parsed.success && parsed.data.estado !== undefined && parsed.data.vence_en === undefined && parsed.data.notas === undefined;
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: soResposta ? "agent" : "manager",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten() as Record<string, unknown>,
    });
  }
  const teto = await tetoDeEscritaDoToken(authz, "autoventa_tasaciones", requestId);
  if (teto) return teto;

  const { id: leadId, tasacionId } = await ctx.params;
  const { data: lead } = await authz.supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", authz.organizationId)
    .maybeSingle();
  if (!lead) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const { data: org } = await authz.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", authz.organizationId)
    .maybeSingle();
  const hoje = hojeNoFuso((org as { timezone?: string | null } | null)?.timezone ?? null);
  if (parsed.data.vence_en !== undefined && parsed.data.vence_en < hoje) {
    return fail("validation_failed", t("O vencimento não pode ser no passado."), 422, { requestId });
  }

  try {
    const r = await actualizarTasacion(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      tasacionId,
      cambios: parsed.data,
    });
    if (!r.ok) {
      if (r.codigo === "nao_encontrada") return fail("not_found", t("Tasação não encontrada."), 404, { requestId });
      const proibido = r.mensagem.includes("tasar_exige_gerente") || r.mensagem.includes("row-level security");
      return fail(proibido ? "forbidden_role" : "validation_failed", t(motivoDoErroDaTasacion(r.mensagem)), proibido ? 403 : 422, {
        requestId,
      });
    }

    const decisao = parsed.data.estado;
    await audit({
      action: decisao ? "autoventa_tasacion.decided" : "autoventa_tasacion.updated",
      actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
      actorApiTokenId: authz.apiTokenId ?? null,
      organizationId: authz.organizationId,
      resourceType: "autoventa_tasaciones",
      resourceId: tasacionId,
      metadata: { lead_id: leadId, ...parsed.data },
      requestId,
    });
    if (decisao) {
      void emitLeadActivity(authz.supabase, {
        organizationId: authz.organizationId,
        leadId,
        contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
        type: "lead_edited",
        sourceModule: "autoventa/tasacion",
        sourceId: tasacionId,
        actor: authz.actor,
        reason: decisao === "aceptada" ? "El cliente aceptó la tasación del usado" : "El cliente rechazó la tasación del usado",
        payload: { tasacion_id: tasacionId, estado: decisao },
      }).catch(() => null);
    }
    return ok({ tasacion: { ...r.tasacion, situacion: situacaoDaTasacion(r.tasacion, hoje) } }, { requestId });
  } catch (err) {
    logger.error("[autoventa/tasaciones] erro ao atualizar", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível salvar a tasação. Tente de novo."), 500, { requestId });
  }
}
