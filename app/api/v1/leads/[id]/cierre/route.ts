/**
 * GET   /api/v1/leads/:id/cierre — o fechamento da operação: as señas (a que
 *       vale primeiro), a papelada, a condição da unidade (0 km ou usado,
 *       que decide os trâmites) e o "hoje" no fuso da agência.
 * PATCH /api/v1/leads/:id/cierre — papelada (`dominio`, `formulario_08`,
 *       `transferencia`, `patentamiento`, `entrega_programada`, `notas`) e a
 *       entrega (`entregado_en`). Vendedor para cima. Registrar a entrega
 *       aplica a seña vigente e marca a unidade `vendido` (gatilho do banco).
 *
 * Fork AutoVenta, etapa 3, parte 2 (migration 9905).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { nomesDosComprobantes } from "@/lib/autoventa/comprobante";
import {
  CIERRE_VAZIO,
  condicaoDaUnidade,
  erroDePapel,
  guardarCierre,
  guardarCierreSchema,
  lerCierre,
  listarSenas,
  motivoDoErroDaSena,
  negocioDaOperacao,
  senaQueVale,
} from "@/lib/autoventa/sena";
import { hojeNoFuso } from "@/lib/autoventa/tasacion";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";

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
    const [senas, cierre] = await Promise.all([
      listarSenas(authz.supabase, authz.organizationId, leadId),
      lerCierre(authz.supabase, authz.organizationId, leadId),
    ]);
    const vale = senaQueVale(senas);
    const condicion = await condicaoDaUnidade(authz.supabase, authz.organizationId, vale?.product_id ?? null);
    const nomes = await nomesDosComprobantes(
      authz.supabase,
      authz.organizationId,
      senas.map((s) => s.comprobante_id).filter((x): x is string => Boolean(x)),
    );
    return ok(
      {
        senas: senas.map((s) => ({
          ...s,
          comprobante: s.comprobante_id
            ? {
                id: s.comprobante_id,
                nombre: nomes[s.comprobante_id] ?? null,
                url: `/api/v1/leads/${leadId}/attachments/${s.comprobante_id}/media`,
              }
            : null,
        })),
        cierre: cierre ?? { lead_id: leadId, ...CIERRE_VAZIO, updated_at: null },
        condicion,
        hoy: hojeNoFuso(negocio.fuso),
      },
      { requestId },
    );
  } catch (err) {
    logger.error("[autoventa/cierre] erro ao ler", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível carregar a seña e o fechamento."), 500, { requestId });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const parsed = guardarCierreSchema.safeParse(await req.json().catch(() => null));
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  if (!parsed.success) {
    return fail("validation_failed", t(parsed.error.issues[0]?.message ?? "Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const teto = await tetoDeEscritaDoToken(authz, "autoventa_cierres", requestId);
  if (teto) return teto;

  const { id: leadId } = await ctx.params;
  const negocio = await negocioDaOperacao(authz.supabase, authz.organizationId, leadId);
  if (!negocio) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const hoje = hojeNoFuso(negocio.fuso);
  if (parsed.data.entregado_en !== undefined && parsed.data.entregado_en > hoje) {
    return fail("validation_failed", t("A data da entrega não pode ser no futuro."), 422, { requestId });
  }

  try {
    const antes = await lerCierre(authz.supabase, authz.organizationId, leadId);
    const r = await guardarCierre(authz.supabase, {
      organizationId: authz.organizationId,
      leadId,
      cambios: parsed.data,
    });
    if (!r.ok) {
      const papel = erroDePapel(r.mensagem);
      const conflito = r.mensagem.includes("entrega_ya_registrada") || r.mensagem.includes("entrega_sin_sena");
      return fail(
        papel ? "forbidden_role" : conflito ? "state_conflict" : "validation_failed",
        t(motivoDoErroDaSena(r.mensagem)),
        papel ? 403 : conflito ? 409 : 422,
        { requestId },
      );
    }
    const entregou = !antes?.entregado_en && Boolean(r.cierre.entregado_en);
    const ator = {
      actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
      actorApiTokenId: authz.apiTokenId ?? null,
    };
    await audit({
      action: entregou ? "autoventa_cierre.delivered" : "autoventa_cierre.updated",
      ...ator,
      organizationId: authz.organizationId,
      resourceType: "autoventa_cierres",
      resourceId: leadId,
      metadata: { lead_id: leadId, ...parsed.data },
      requestId,
    });
    const mudancas = mudancasLegiveis(antes, r.cierre);
    if (entregou || mudancas.length > 0) {
      void emitLeadActivity(authz.supabase, {
        organizationId: authz.organizationId,
        leadId,
        contactId: negocio.contactId,
        type: "lead_edited",
        sourceModule: "autoventa/cierre",
        sourceId: leadId,
        actor: authz.actor,
        reason: entregou ? `Unidad entregada el ${r.cierre.entregado_en}` : `Papelería: ${mudancas.join(", ")}`,
        payload: { ...parsed.data },
      }).catch(() => null);
    }
    return ok({ cierre: r.cierre, entregado_ahora: entregou }, { requestId });
  } catch (err) {
    logger.error("[autoventa/cierre] erro ao gravar", { error: String(err), requestId });
    return fail("internal_error", t("Não foi possível salvar a seña. Tente de novo."), 500, { requestId });
  }
}

/** O que mudou na papelada, em espanhol, para a linha do tempo. */
function mudancasLegiveis(
  antes: Awaited<ReturnType<typeof lerCierre>>,
  depois: NonNullable<Awaited<ReturnType<typeof lerCierre>>>,
): string[] {
  const a = antes ?? { ...CIERRE_VAZIO };
  const out: string[] = [];
  if (a.dominio !== depois.dominio) out.push(depois.dominio ? `dominio ${depois.dominio}` : "dominio borrado");
  if (a.formulario_08 !== depois.formulario_08) out.push(`08 ${depois.formulario_08.replace("_", " ")}`);
  if (a.transferencia !== depois.transferencia) out.push(`transferencia ${depois.transferencia.replace("_", " ")}`);
  if (a.patentamiento !== depois.patentamiento) out.push(`patentamiento ${depois.patentamiento.replace("_", " ")}`);
  if (a.entrega_programada !== depois.entrega_programada) {
    out.push(depois.entrega_programada ? `entrega programada para el ${depois.entrega_programada}` : "sin fecha de entrega");
  }
  return out;
}
