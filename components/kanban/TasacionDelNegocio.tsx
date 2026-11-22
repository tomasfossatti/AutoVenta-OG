"use client";

/**
 * A TASAÇÃO DO USADO NO DOSSIÊ — fork AutoVenta, etapa 3.
 *
 * Seção do negócio, logo depois de "Dados do negócio" (onde estão os campos
 * `usado_*` que o cliente contou). Só existe em funil com os campos do usado
 * (`funilTemUsado`): fora do "Ventas" o dossiê fica idêntico ao de antes.
 *
 * O que cada um vê:
 *  - todos: a tasação que vale (a mais recente), a situação de hoje e o histórico;
 *  - vendedor (`agent`+): pedir a tasação e registrar a resposta do cliente;
 *  - gerente (`manager`+): tasar, retasar, estender o vencimento.
 * A tela só esconde botões; quem barra é a rota e o banco (migration 9904).
 */
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  useActualizarTasacion,
  useCrearTasacion,
  useTasaciones,
  type TasacionDelNegocio as Tasacion,
} from "@/hooks/autoventa/useTasaciones";
import {
  MONEDAS_DE_LA_TASACION,
  ROTULOS_DA_SITUACAO,
  VIGENCIA_PADRAO_DIAS,
  somarDias,
  type MonedaDeLaTasacion,
  type SituacionDeLaTasacion,
} from "@/lib/autoventa/tasacion";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const COR_DA_SITUACAO: Record<SituacionDeLaTasacion, string> = {
  pendiente: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  vigente: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  vencida: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  aceptada: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  rechazada: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
};

const ROTULOS_DA_MOEDA: Record<MonedaDeLaTasacion, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

/** `2026-11-28` → `28/11/2026`. A data é dia de calendário, sem fuso. */
function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function mensagemDoErro(err: unknown, padrao: string): string {
  return err instanceof Error && err.message ? err.message : padrao;
}

interface Props {
  leadId: string;
  /** `manager`+: tasar, retasar, estender a oferta. */
  podeTasar: boolean;
  /** `agent`+: pedir a tasação e registrar a resposta do cliente. */
  podeResponder: boolean;
}

export function TasacionDelNegocio({ leadId, podeTasar, podeResponder }: Props) {
  const t = useT();
  const { data, isLoading, isError } = useTasaciones(leadId);
  const crear = useCrearTasacion(leadId);
  const actualizar = useActualizarTasacion(leadId);
  const [formAberto, setFormAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (isLoading) return <p className="text-xs text-text-muted">{t("Carregando…")}</p>;
  if (isError || !data) {
    return <p className="text-xs text-destructive">{t("Não foi possível carregar a tasação.")}</p>;
  }

  const [atual, ...historico] = data.tasaciones;
  const ocupado = crear.isPending || actualizar.isPending;

  const pedir = () => {
    setErro(null);
    crear.mutate({ accion: "pedir" }, { onError: (e) => setErro(mensagemDoErro(e, t("Não foi possível salvar a tasação. Tente de novo."))) });
  };
  const responder = (estado: "aceptada" | "rechazada") => {
    if (!atual) return;
    setErro(null);
    actualizar.mutate(
      { tasacionId: atual.id, estado },
      { onError: (e) => setErro(mensagemDoErro(e, t("Não foi possível salvar a tasação. Tente de novo."))) },
    );
  };

  const podeTasarAgora = podeTasar && (!atual || atual.situacion !== "aceptada");
  const textoDoBotaoDeTasar =
    atual && atual.situacion !== "pendiente" ? t("Retasar") : t("Fazer tasação");

  return (
    <div className="flex flex-col gap-3" data-testid="tasacion-del-negocio">
      {!atual && (
        <p className="text-sm text-text-muted" data-testid="tasacion-vazia">
          {t("Ninguém tasou o usado ainda. O atendente de IA nunca diz um valor ao cliente sem uma tasação vigente.")}
        </p>
      )}

      {atual && <CartaoDaTasacion tasacion={atual} destaque />}

      {erro && (
        <p role="alert" className="text-xs text-destructive" data-testid="tasacion-erro">
          {erro}
        </p>
      )}

      {formAberto ? (
        <FormularioDeTasacion
          hoje={data.hoy}
          ocupado={ocupado}
          aoCancelar={() => setFormAberto(false)}
          aoTasar={(input) => {
            setErro(null);
            crear.mutate(
              { accion: "tasar", ...input },
              {
                onSuccess: () => setFormAberto(false),
                onError: (e) => setErro(mensagemDoErro(e, t("Não foi possível salvar a tasação. Tente de novo."))),
              },
            );
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {podeTasarAgora && (
            <button
              type="button"
              onClick={() => setFormAberto(true)}
              disabled={ocupado}
              className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-60"
              data-testid="tasacion-abrir-form"
            >
              {textoDoBotaoDeTasar}
            </button>
          )}
          {podeResponder && (!atual || atual.situacion === "vencida" || atual.situacion === "rechazada") && (
            <button
              type="button"
              onClick={pedir}
              disabled={ocupado}
              className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-60"
              data-testid="tasacion-pedir"
            >
              {atual ? t("Pedir nova tasação") : t("Pedir tasação")}
            </button>
          )}
          {podeResponder && atual?.situacion === "vigente" && (
            <>
              <button
                type="button"
                onClick={() => responder("aceptada")}
                disabled={ocupado}
                className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-60"
                data-testid="tasacion-aceita"
              >
                {t("Cliente aceitou")}
              </button>
              <button
                type="button"
                onClick={() => responder("rechazada")}
                disabled={ocupado}
                className="h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-60"
                data-testid="tasacion-recusada"
              >
                {t("Cliente recusou")}
              </button>
            </>
          )}
        </div>
      )}

      {historico.length > 0 && (
        <details className="text-xs" data-testid="tasacion-historico">
          <summary className="cursor-pointer text-text-muted">
            {t("Tasações anteriores")} ({historico.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {historico.map((h) => (
              <li key={h.id}>
                <CartaoDaTasacion tasacion={h} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CartaoDaTasacion({ tasacion, destaque = false }: { tasacion: Tasacion; destaque?: boolean }) {
  const t = useT();
  const temValor = tasacion.valor_cents !== null && tasacion.moneda !== null;
  return (
    <div
      className={cn("rounded-md border p-3", destaque ? "bg-surface" : "opacity-80")}
      data-testid={destaque ? "tasacion-atual" : "tasacion-anterior"}
      data-situacion={tasacion.situacion}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn("rounded-md px-2 py-0.5 text-xs font-medium", COR_DA_SITUACAO[tasacion.situacion])}
          data-testid="tasacion-situacao"
        >
          {t(ROTULOS_DA_SITUACAO[tasacion.situacion])}
        </span>
        {temValor && (
          <span className={cn("font-semibold tabular-nums", destaque ? "text-lg" : "text-sm")} data-testid="tasacion-valor">
            {formatCents(tasacion.valor_cents ?? 0, tasacion.moneda ?? "ARS")}
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
        {tasacion.estado !== "pendiente" && (
          <>
            <dt>{t("Vale até")}</dt>
            <dd className="text-text" data-testid="tasacion-vence">{dataCurta(tasacion.vence_en)}</dd>
          </>
        )}
        <dt>{tasacion.estado === "pendiente" ? t("Pedida em") : t("Tasada em")}</dt>
        <dd className="text-text">{dataCurta(tasacion.tasada_en ?? tasacion.created_at)}</dd>
        {tasacion.origen === "agente" && (
          <>
            <dt>{t("Origem")}</dt>
            <dd className="text-text">{t("Pedida pelo atendente de IA")}</dd>
          </>
        )}
      </dl>
      {tasacion.notas && <p className="mt-2 whitespace-pre-wrap text-xs">{tasacion.notas}</p>}
    </div>
  );
}

function FormularioDeTasacion({
  hoje,
  ocupado,
  aoCancelar,
  aoTasar,
}: {
  hoje: string;
  ocupado: boolean;
  aoCancelar: () => void;
  aoTasar: (input: { valor_cents: number; moneda: MonedaDeLaTasacion; vence_en: string; notas: string | null }) => void;
}) {
  const t = useT();
  const [valor, setValor] = useState("");
  const [moneda, setMoneda] = useState<MonedaDeLaTasacion>("ARS");
  const [venceEn, setVenceEn] = useState(somarDias(hoje, VIGENCIA_PADRAO_DIAS));
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const campo = "mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm";

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseReaisToCents(valor, moneda);
    if (cents === null || cents <= 0) {
      setErro(t("Informe o valor da tasação."));
      return;
    }
    if (!venceEn || venceEn < hoje) {
      setErro(t("O vencimento não pode ser no passado."));
      return;
    }
    setErro(null);
    aoTasar({ valor_cents: cents, moneda, vence_en: venceEn, notas: notas.trim() || null });
  };

  return (
    <form onSubmit={enviar} className="rounded-md border p-3" data-testid="tasacion-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {t("Valor oferecido")}
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            placeholder="12.000.000"
            className={campo}
            disabled={ocupado}
            data-testid="tasacion-valor-input"
            autoFocus
          />
        </label>
        <label className="text-sm">
          {t("Moeda")}
          <select
            value={moneda}
            onChange={(e) => setMoneda(e.target.value as MonedaDeLaTasacion)}
            className={campo}
            disabled={ocupado}
            data-testid="tasacion-moneda"
          >
            {MONEDAS_DE_LA_TASACION.map((m) => (
              <option key={m} value={m}>
                {t(ROTULOS_DA_MOEDA[m])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Vale até")}
          <input
            type="date"
            value={venceEn}
            min={hoje}
            onChange={(e) => setVenceEn(e.target.value)}
            className={campo}
            disabled={ocupado}
            data-testid="tasacion-vence-input"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          {t("Observações")}
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            disabled={ocupado}
            data-testid="tasacion-notas"
          />
        </label>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {erro}
        </p>
      )}
      <p className="mt-2 text-xs text-text-muted">
        {t("O atendente de IA pode informar este valor ao cliente até o vencimento, sempre sujeito a ver o carro.")}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={ocupado}
          className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-60"
          data-testid="tasacion-salvar"
        >
          {t("Salvar tasação")}
        </button>
        <button type="button" onClick={aoCancelar} disabled={ocupado} className="h-8 rounded-md border px-3 text-xs">
          {t("Cancelar")}
        </button>
      </div>
    </form>
  );
}
