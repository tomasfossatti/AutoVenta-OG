/**
 * AS FERRAMENTAS DA TASAÇÃO — fork AutoVenta, etapa 3.
 *
 * Duas, e nenhuma põe valor:
 *
 *  - `autoventa_ver_tasacion` lê a tasação do usado do negócio e devolve o que
 *    o agente PODE dizer. O valor só vem quando a tasação está vigente (ou já
 *    foi aceita): pendente, vencida ou recusada, a resposta não traz número —
 *    a regra "nunca invente o valor do usado" não depende só do prompt.
 *  - `autoventa_pedir_tasacion` abre o pedido (`pendiente`, sem valor) para a
 *    equipe tasar. Idempotente: pedir de novo devolve o pedido aberto.
 *
 * Etapa 3, parte 2: `autoventa_ver_cierre` lê a seña e a papelada da operação.
 * Só leitura, e sem o monto nem a data de entrega combinada — o agente nunca
 * registra uma seña nem promete entrega (`lib/autoventa/sena.ts`).
 *
 * As três valem só para o negócio do cliente desta conversa — a mesma cerca
 * das leituras de anexo (`lib/leads/anexos-do-negocio.ts`).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { condicaoDaUnidade, cierreParaOAgente, lerCierre, listarSenas, senaQueVale } from "@/lib/autoventa/sena";
import {
  hojeNoFuso,
  listarTasaciones,
  pedirTasacion,
  tasacionParaOAgente,
} from "@/lib/autoventa/tasacion";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import type { McpContext, McpToolDefinition } from "../types";
import { recusaSeLeadDePessoal } from "./leads";

const FORA_DA_CONVERSA = {
  permitido: false,
  motivo: "fora_da_conversa",
  mensagem:
    "esta conversa é com outra pessoa — um negócio que não é deste cliente não é seu para ver; " +
    "siga a conversa com quem está falando.",
} as const;

const FALHA = {
  erro: "nao_consegui_ler_a_tasacion",
  instruccion:
    "No pude revisar la tasación ahora. No le des ningún valor por el usado; decile que lo confirma un vendedor.",
} as const;

/**
 * O negócio é da organização e do cliente deste turno? Devolve o fuso da
 * agência (o "vence hoje" é no dia de Neuquén, não no de UTC) e o contato.
 */
async function negocioDoTurno(
  ctx: McpContext,
  leadId: string,
): Promise<{ ok: true; contactId: string | null; fuso: string | null } | { ok: false; resposta: unknown }> {
  const pessoal = await recusaSeLeadDePessoal(ctx, leadId);
  if (pessoal) return { ok: false, resposta: pessoal };
  const { data: lead, error } = await ctx.supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) return { ok: false, resposta: FALHA };
  const contactId = (lead as { contact_id?: string | null } | null)?.contact_id ?? null;
  // Inexistente, de outra organização ou de outro cliente: a MESMA recusa —
  // um uuid não vira oráculo de existência.
  if (!lead || (ctx.contatoDoTurno && contactId !== ctx.contatoDoTurno)) {
    return { ok: false, resposta: FORA_DA_CONVERSA };
  }
  const { data: org } = await ctx.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", ctx.organizationId)
    .maybeSingle();
  return { ok: true, contactId, fuso: (org as { timezone?: string | null } | null)?.timezone ?? null };
}

const verInputShape = {
  lead_id: z.string().uuid(),
};

export const autoventaVerTasacion: McpToolDefinition<typeof verInputShape> = {
  name: "autoventa_ver_tasacion",
  description:
    "Muestra la TASACIÓN del usado que la persona entrega en parte de pago, en la operación de esta conversación. " +
    "Usala SIEMPRE antes de hablar de cuánto le dan por su auto. Devuelve `situacion` " +
    "(sin_tasacion, pendiente, vigente, vencida, aceptada, rechazada) y una `instruccion` que tenés que seguir. " +
    "El `valor` solo viene cuando podés decirlo: si no viene, no hay valor para dar — nunca lo estimes, " +
    "ni aproximado ni en rango, y nunca uses un valor de una charla anterior.",
  inputSchema: verInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const negocio = await negocioDoTurno(ctx, input.lead_id);
    if (!negocio.ok) return negocio.resposta;
    try {
      const lista = await listarTasaciones(ctx.supabase, ctx.organizationId, input.lead_id);
      return tasacionParaOAgente(lista, hojeNoFuso(negocio.fuso));
    } catch (err) {
      logger.error("[mcp/autoventa] erro ao ler tasación", { erro: String(err), lead_id: input.lead_id });
      return FALHA;
    }
  },
};

const pedirInputShape = {
  lead_id: z.string().uuid(),
  /**
   * Um resumo curto do usado, com as palavras da pessoa ("Cruze LTZ 2017,
   * 85 mil km, un raspón en la puerta"). Vai para a equipe que tasa.
   */
  resumen: z.string().trim().max(500).optional(),
};

export const autoventaPedirTasacion: McpToolDefinition<typeof pedirInputShape> = {
  name: "autoventa_pedir_tasacion",
  description:
    "Le pide al equipo que tase el usado que la persona entrega en parte de pago. Usala cuando ya " +
    "anotaste los datos del usado en la operación (campos usado_*, con crm_update_lead) y todavía no hay " +
    "una tasación vigente. No pone ningún valor: la tasación la hace una persona del equipo. " +
    "Pedir dos veces no duplica el pedido. En `resumen` poné, con las palabras de la persona, lo que contó del auto. " +
    "Después de pedirla, decile a la persona que un tasador lo revisa y que le avisan; no le prometas plazo ni valor.",
  inputSchema: pedirInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const negocio = await negocioDoTurno(ctx, input.lead_id);
    if (!negocio.ok) return negocio.resposta;
    const hoje = hojeNoFuso(negocio.fuso);
    try {
      const r = await pedirTasacion(ctx.supabase, {
        organizationId: ctx.organizationId,
        leadId: input.lead_id,
        origen: "agente",
        notas: input.resumen ?? null,
        hoje,
      });
      if (!r.ok) {
        if (r.codigo === "ja_tasada_vigente") {
          return { pedida: false, motivo: "ya_hay_tasacion_vigente", ...tasacionParaOAgente([r.tasacion], hoje) };
        }
        logger.error("[mcp/autoventa] erro ao pedir tasación", { erro: r.mensagem, lead_id: input.lead_id });
        return FALHA;
      }
      if (!r.jaExistia) {
        await audit({
          action: "autoventa_tasacion.requested",
          actorUserId: ctx.actor.type === "user" ? (ctx.actor.id as string) : null,
          actorApiTokenId: ctx.apiTokenId ?? null,
          organizationId: ctx.organizationId,
          resourceType: "autoventa_tasaciones",
          resourceId: r.tasacion.id,
          requestId: ctx.requestId,
          metadata: { lead_id: input.lead_id, origen: "agente" },
        });
        void emitLeadActivity(ctx.supabase, {
          organizationId: ctx.organizationId,
          leadId: input.lead_id,
          contactId: negocio.contactId,
          type: "lead_edited",
          sourceModule: "autoventa/tasacion",
          sourceId: r.tasacion.id,
          actor: ctx.actor,
          reason: "El asistente de IA pidió la tasación del usado",
          payload: { tasacion_id: r.tasacion.id, estado: "pendiente" },
        }).catch(() => null);
      }
      return {
        pedida: true,
        ya_existia: r.jaExistia,
        instruccion:
          "La tasación quedó pedida. Decile a la persona que un tasador revisa su usado y que le avisan; " +
          "no le des valor ni plazo.",
      };
    } catch (err) {
      logger.error("[mcp/autoventa] erro ao pedir tasación", { erro: String(err), lead_id: input.lead_id });
      return FALHA;
    }
  },
};

const FALHA_DO_CIERRE = {
  erro: "nao_consegui_ler_a_operacion",
  instruccion:
    "No pude revisar la seña ni la papelería ahora. No confirmes nada sobre la seña ni la entrega; " +
    "decile que lo confirma su vendedor.",
} as const;

export const autoventaVerCierre: McpToolDefinition<typeof verInputShape> = {
  name: "autoventa_ver_cierre",
  description:
    "Muestra si la operación de esta conversación tiene SEÑA registrada, qué unidad quedó reservada y en qué estado " +
    "está la papelería (formulario 08, transferencia o patentamiento, si ya tiene dominio) y si ya se entregó. " +
    "Usala cuando la persona pregunte por su seña, sus papeles o la entrega. Solo lectura: no registra señas. " +
    "No trae montos ni fecha de entrega: nunca confirmes un pago ni prometas una fecha; seguí la `instruccion`.",
  inputSchema: verInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const negocio = await negocioDoTurno(ctx, input.lead_id);
    if (!negocio.ok) return negocio.resposta;
    try {
      const [senas, cierre] = await Promise.all([
        listarSenas(ctx.supabase, ctx.organizationId, input.lead_id),
        lerCierre(ctx.supabase, ctx.organizationId, input.lead_id),
      ]);
      const condicion = await condicaoDaUnidade(ctx.supabase, ctx.organizationId, senaQueVale(senas)?.product_id ?? null);
      return cierreParaOAgente(senas, cierre, condicion);
    } catch (err) {
      logger.error("[mcp/autoventa] erro ao ler seña y cierre", { erro: String(err), lead_id: input.lead_id });
      return FALHA_DO_CIERRE;
    }
  },
};
