/**
 * Registrada a seña, o negócio vai para a etapa "Señado" — fork AutoVenta,
 * etapa 3, parte 2. Só servidor (linha do tempo, evento, logger): fica fora de
 * `sena.ts`, que a tela também importa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { observeServiceOrigin } from "@/lib/atendimento/origem";
import { emitLeadActivity, stageChangeReason, type EmitLeadActivityInput } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { lerPosicaoDeEntrada } from "@/lib/leads/posicao-de-entrada";
import { logger } from "@/lib/logger";
import { SLUG_DA_ETAPA_SENADO } from "./sena";

// ─── A etapa "Señado" ────────────────────────────────────────────────────────

export type ResultadoDoMovimentoParaSenado =
  | "movido"
  | "sem_etapa"
  | "ja_esta_la_ou_adiante"
  | "lead_fechado"
  | "conflito"
  | "falha";

/**
 * Registrada a seña, o negócio passa à etapa "Señado" do seu funil — só para
 * FRENTE: quem já está em "Señado" ou adiante (ou fechado) fica onde está. Funil
 * sem etapa `senado` não muda nada. O mesmo desenho de
 * `lib/leads/appointment-stage-move.ts`: trava otimista pela etapa de origem,
 * linha do tempo, `lead.stage_changed`. Nunca lança: a seña já foi gravada e
 * o card atrasado é melhor do que uma seña que some.
 */
export async function moverParaSenado(
  admin: SupabaseClient,
  input: { organizationId: string; leadId: string; actor: EmitLeadActivityInput["actor"] },
): Promise<ResultadoDoMovimentoParaSenado> {
  try {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, pipeline_id, stage_id, contact_id, status")
      .eq("id", input.leadId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const l = lead as { id: string; pipeline_id: string; stage_id: string; contact_id: string | null; status: string } | null;
    if (!l) return "falha";
    if (l.status !== "open") return "lead_fechado";

    const { data: etapas } = await admin
      .from("crm_stages")
      .select("id, name, slug, position, is_won, is_lost")
      .eq("pipeline_id", l.pipeline_id)
      .eq("organization_id", input.organizationId)
      .eq("is_archived", false);
    const lista = (etapas ?? []) as Array<{ id: string; name: string; slug: string | null; position: number; is_won: boolean; is_lost: boolean }>;
    const alvo = lista.find((e) => e.slug === SLUG_DA_ETAPA_SENADO);
    if (!alvo) return "sem_etapa";
    const atual = lista.find((e) => e.id === l.stage_id);
    if (!atual || atual.is_won || atual.is_lost || Number(atual.position) >= Number(alvo.position)) {
      return "ja_esta_la_ou_adiante";
    }

    const posicao = await lerPosicaoDeEntrada(admin, input.organizationId, alvo.id);
    const { data: movidas, error } = await admin
      .from("crm_leads")
      .update({ stage_id: alvo.id, ...(posicao === null ? {} : { position_in_stage: posicao }) })
      .eq("id", l.id)
      .eq("organization_id", input.organizationId)
      .eq("stage_id", l.stage_id)
      .select("id");
    if (error) {
      logger.warn("[autoventa/sena] mover para Señado falhou", { lead_id: l.id, error: error.message });
      return "falha";
    }
    if ((movidas ?? []).length === 0) return "conflito";

    const atividade = await emitLeadActivity(admin, {
      organizationId: input.organizationId,
      leadId: l.id,
      contactId: l.contact_id,
      type: "stage_changed",
      sourceModule: "autoventa/sena",
      sourceId: l.id,
      actor: input.actor,
      reason: stageChangeReason(atual.name, alvo.name),
      payload: { motivo_do_movimento: "sena_registrada", de: l.stage_id, para: alvo.id },
    });
    if (!atividade.ok) {
      await registraFalhaDeAtividade(admin, {
        organizationId: input.organizationId,
        leadId: l.id,
        tipo: "stage_changed",
        origem: "lib/autoventa/sena",
        erro: atividade.error,
      });
    }

    const serviceOrigin = await observeServiceOrigin(admin, input.organizationId, l.contact_id);
    const { error: erroEvento } = await admin.rpc("emit_event" as never, {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: l.id,
      p_payload: {
        service_origin: serviceOrigin,
        pipeline_id: l.pipeline_id,
        from_stage_id: l.stage_id,
        to_stage_id: alvo.id,
        status: l.status,
      },
      p_metadata: { actor_kind: "system", source: "autoventa-sena" },
      p_organization_id: input.organizationId,
    } as never);
    if (erroEvento) {
      logger.error("[autoventa/sena] emit_event lead.stage_changed falhou", {
        lead_id: l.id,
        error: (erroEvento as { message?: string }).message ?? String(erroEvento),
      });
    }
    return "movido";
  } catch (err) {
    logger.warn("[autoventa/sena] mover para Señado lançou", { lead_id: input.leadId, error: String(err) });
    return "falha";
  }
}
