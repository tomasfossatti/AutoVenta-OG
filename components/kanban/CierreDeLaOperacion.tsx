"use client";

/**
 * A SEÑA E O FECHAMENTO NO DOSSIÊ — fork AutoVenta, etapa 3, parte 2.
 *
 * Seção do negócio, logo depois de "Usado e tasação". Só existe no funil com
 * os campos do usado (o "Ventas"): fora dele o dossiê fica como antes.
 *
 * O que cada um vê:
 *  - todos: a seña que vale (com o comprovante), a papelada e o histórico;
 *  - vendedor (`agent`+): registrar a seña, subir o comprovante, carregar a
 *    papelada e registrar a entrega;
 *  - gerente (`manager`+): também anular a seña.
 * A tela só esconde botões; quem barra é a rota e o banco (migration 9905).
 */
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  useAnularSena,
  useCierre,
  useGuardarCierre,
  useRegistrarSena,
  useSubirComprobante,
  useUnidadesSenables,
  type CierreDelNegocio,
  type SenaDelNegocio,
} from "@/hooks/autoventa/useCierre";
import {
  ESTADOS_DEL_08,
  ESTADOS_DE_LA_TRANSFERENCIA,
  ESTADOS_DEL_PATENTAMIENTO,
  MONEDAS_DE_LA_SENA,
  ROTULOS_DA_SENA,
  ROTULOS_DA_TRANSFERENCIA,
  ROTULOS_DO_08,
  ROTULOS_DO_PATENTAMIENTO,
  dominioValido,
  normalizarDominio,
  senaQueVale,
  tramitesDaUnidade,
  type EstadoDeLaSena,
  type GuardarCierre,
  type MonedaDeLaSena,
} from "@/lib/autoventa/sena";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const COR_DA_SENA: Record<EstadoDeLaSena, string> = {
  vigente: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  aplicada: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  anulada: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

const ROTULOS_DA_MOEDA: Record<MonedaDeLaSena, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

const CAMPO = "mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-70";
const BOTAO_PRIMARIO =
  "h-8 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-60";
const BOTAO = "h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-60";

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
  /** `agent`+: registrar seña, comprovante, papelada e entrega. */
  podeRegistrar: boolean;
  /** `manager`+: anular a seña. */
  podeAnular: boolean;
}

export function CierreDeLaOperacion({ leadId, podeRegistrar, podeAnular }: Props) {
  const t = useT();
  const { data, isLoading, isError } = useCierre(leadId);
  const [formAberto, setFormAberto] = useState(false);

  if (isLoading) return <p className="text-xs text-text-muted">{t("Carregando…")}</p>;
  if (isError || !data) {
    return <p className="text-xs text-destructive">{t("Não foi possível carregar a seña e o fechamento.")}</p>;
  }

  const vale = senaQueVale(data.senas);
  const historico = data.senas.filter((s) => s !== vale);

  return (
    <div className="flex flex-col gap-3" data-testid="cierre-de-la-operacion">
      {!vale && !formAberto && (
        <>
          <p className="text-sm text-text-muted" data-testid="sena-vazia">
            {t("Sem seña registrada. Ao registrar, a unidade fica como señada no estoque e o atendente de IA deixa de oferecê-la.")}
          </p>
          {podeRegistrar && (
            <div>
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => setFormAberto(true)} data-testid="sena-abrir-form">
                {t("Registrar seña")}
              </button>
            </div>
          )}
        </>
      )}

      {!vale && formAberto && (
        <FormularioDeSena leadId={leadId} hoje={data.hoy} aoFechar={() => setFormAberto(false)} />
      )}

      {vale && (
        <>
          <CartaoDaSena leadId={leadId} sena={vale} destaque podeRegistrar={podeRegistrar} podeAnular={podeAnular} />
          <Papelada leadId={leadId} dados={data} podeEditar={podeRegistrar} />
        </>
      )}

      {historico.length > 0 && (
        <details className="text-xs" data-testid="sena-historico">
          <summary className="cursor-pointer text-text-muted">
            {t("Señas anteriores")} ({historico.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {historico.map((s) => (
              <li key={s.id}>
                <CartaoDaSena leadId={leadId} sena={s} podeRegistrar={false} podeAnular={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ─── A seña ──────────────────────────────────────────────────────────────────

function CartaoDaSena({
  leadId,
  sena,
  destaque = false,
  podeRegistrar,
  podeAnular,
}: {
  leadId: string;
  sena: SenaDelNegocio;
  destaque?: boolean;
  podeRegistrar: boolean;
  podeAnular: boolean;
}) {
  const t = useT();
  const anular = useAnularSena(leadId);
  const subir = useSubirComprobante(leadId);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const vigente = sena.estado === "vigente";

  return (
    <div
      className={cn("rounded-md border p-3", destaque ? "bg-surface" : "opacity-80")}
      data-testid={destaque ? "sena-atual" : "sena-anterior"}
      data-estado={sena.estado}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", COR_DA_SENA[sena.estado])} data-testid="sena-estado">
          {t(ROTULOS_DA_SENA[sena.estado])}
        </span>
        <span className={cn("font-semibold tabular-nums", destaque ? "text-lg" : "text-sm")} data-testid="sena-monto">
          {formatCents(sena.monto_cents, sena.moneda)}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-muted">
        <dt>{t("Unidade")}</dt>
        <dd className="text-text" data-testid="sena-unidad">{sena.unidad_descripcion || t("Unidade removida do catálogo")}</dd>
        <dt>{t("Data da seña")}</dt>
        <dd className="text-text">{dataCurta(sena.fecha)}</dd>
        <dt>{t("Comprovante")}</dt>
        <dd className="text-text">
          {sena.comprobante ? (
            <a
              href={sena.comprobante.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
              data-testid="sena-comprobante"
            >
              {sena.comprobante.nombre ?? t("Ver comprovante")}
            </a>
          ) : (
            <span className="font-medium text-amber-700 dark:text-amber-300" data-testid="sena-sin-comprobante">
              {t("Sem comprovante")}
            </span>
          )}
        </dd>
        {sena.estado === "anulada" && (
          <>
            <dt>{t("Motivo da anulação")}</dt>
            <dd className="text-text">{sena.motivo_anulacion}</dd>
          </>
        )}
      </dl>
      {sena.notas && <p className="mt-2 whitespace-pre-wrap text-xs">{sena.notas}</p>}

      {erro && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="sena-erro">
          {erro}
        </p>
      )}

      {vigente && (podeRegistrar || podeAnular) && !anulando && (
        <div className="mt-3 flex flex-wrap gap-2">
          {podeRegistrar && (
            <label className={cn(BOTAO, "inline-flex cursor-pointer items-center", subir.isPending && "opacity-60")}>
              {sena.comprobante ? t("Trocar comprovante") : t("Subir comprovante")}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={subir.isPending}
                data-testid="sena-subir-comprobante"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  e.target.value = "";
                  if (!arquivo) return;
                  setErro(null);
                  subir.mutate(
                    { senaId: sena.id, arquivo },
                    { onError: (err) => setErro(mensagemDoErro(err, t("Não foi possível salvar a seña. Tente de novo."))) },
                  );
                }}
              />
            </label>
          )}
          {podeAnular && (
            <button type="button" className={BOTAO} onClick={() => setAnulando(true)} data-testid="sena-anular">
              {t("Anular seña")}
            </button>
          )}
        </div>
      )}

      {anulando && (
        <form
          className="mt-3 flex flex-col gap-2"
          data-testid="sena-anular-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!motivo.trim()) {
              setErro(t("Conte por que a seña foi anulada."));
              return;
            }
            setErro(null);
            anular.mutate(
              { senaId: sena.id, motivo: motivo.trim() },
              {
                onSuccess: () => setAnulando(false),
                onError: (err) => setErro(mensagemDoErro(err, t("Não foi possível salvar a seña. Tente de novo."))),
              },
            );
          }}
        >
          <label className="text-sm">
            {t("Por que a seña foi anulada?")}
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              className={CAMPO}
              disabled={anular.isPending}
              data-testid="sena-motivo"
              autoFocus
            />
          </label>
          <p className="text-xs text-text-muted">{t("A unidade volta a ficar disponível no estoque.")}</p>
          <div className="flex gap-2">
            <button type="submit" className={BOTAO_PRIMARIO} disabled={anular.isPending} data-testid="sena-confirmar-anulacion">
              {t("Confirmar anulação")}
            </button>
            <button type="button" className={BOTAO} onClick={() => setAnulando(false)} disabled={anular.isPending}>
              {t("Cancelar")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FormularioDeSena({ leadId, hoje, aoFechar }: { leadId: string; hoje: string; aoFechar: () => void }) {
  const t = useT();
  const unidades = useUnidadesSenables(leadId, true);
  const registrar = useRegistrarSena(leadId);
  const [productId, setProductId] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<MonedaDeLaSena>("ARS");
  const [fecha, setFecha] = useState(hoje);
  const [notas, setNotas] = useState("");
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ocupado = registrar.isPending;

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return setErro(t("Escolha a unidade do estoque."));
    const cents = parseReaisToCents(monto, moneda);
    if (cents === null || cents <= 0) return setErro(t("Informe o valor da seña."));
    if (!fecha || fecha > hoje) return setErro(t("A data da seña não pode ser no futuro."));
    setErro(null);
    registrar.mutate(
      { product_id: productId, monto_cents: cents, moneda, fecha, notas: notas.trim() || null, comprobante },
      {
        onSuccess: aoFechar,
        onError: (err) => setErro(mensagemDoErro(err, t("Não foi possível salvar a seña. Tente de novo."))),
      },
    );
  };

  const lista = unidades.data ?? [];

  return (
    <form onSubmit={enviar} className="rounded-md border p-3" data-testid="sena-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          {t("Unidade do estoque")}
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              const u = lista.find((x) => x.product_id === e.target.value);
              if (u && (u.moeda === "ARS" || u.moeda === "USD")) setMoneda(u.moeda);
            }}
            className={CAMPO}
            disabled={ocupado || unidades.isLoading}
            data-testid="sena-unidad-select"
            autoFocus
          >
            <option value="">{unidades.isLoading ? t("Carregando…") : t("Escolha a unidade")}</option>
            {lista.map((u) => (
              <option key={u.product_id} value={u.product_id}>
                {u.descripcion} · {formatCents(u.preco_cents, u.moeda)}
                {u.estado === "reservado" ? ` · ${t("Reservado")}` : ""}
              </option>
            ))}
          </select>
          {!unidades.isLoading && lista.length === 0 && (
            <span className="mt-1 block text-xs text-text-muted" data-testid="sena-sin-unidades">
              {t("Nenhuma unidade disponível ou reservada no estoque.")}
            </span>
          )}
        </label>
        <label className="text-sm">
          {t("Valor da seña")}
          <input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            inputMode="decimal"
            placeholder="500.000"
            className={CAMPO}
            disabled={ocupado}
            data-testid="sena-monto-input"
          />
        </label>
        <label className="text-sm">
          {t("Moeda")}
          <select
            value={moneda}
            onChange={(e) => setMoneda(e.target.value as MonedaDeLaSena)}
            className={CAMPO}
            disabled={ocupado}
            data-testid="sena-moneda"
          >
            {MONEDAS_DE_LA_SENA.map((m) => (
              <option key={m} value={m}>
                {t(ROTULOS_DA_MOEDA[m])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Data da seña")}
          <input
            type="date"
            value={fecha}
            max={hoje}
            onChange={(e) => setFecha(e.target.value)}
            className={CAMPO}
            disabled={ocupado}
            data-testid="sena-fecha"
          />
        </label>
        <label className="text-sm">
          {t("Comprovante (PDF ou foto)")}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs"
            disabled={ocupado}
            data-testid="sena-comprobante-input"
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
            data-testid="sena-notas"
          />
        </label>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="sena-form-erro">
          {erro}
        </p>
      )}
      <p className="mt-2 text-xs text-text-muted">
        {t("A unidade passa a señada no estoque e a operação vai para a etapa Señado.")}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={ocupado} className={BOTAO_PRIMARIO} data-testid="sena-salvar">
          {t("Registrar seña")}
        </button>
        <button type="button" onClick={aoFechar} disabled={ocupado} className={BOTAO}>
          {t("Cancelar")}
        </button>
      </div>
    </form>
  );
}

// ─── A papelada e a entrega ──────────────────────────────────────────────────

function Papelada({ leadId, dados, podeEditar }: { leadId: string; dados: CierreDelNegocio; podeEditar: boolean }) {
  const t = useT();
  const guardar = useGuardarCierre(leadId);
  const c = dados.cierre;
  const [dominio, setDominio] = useState(c.dominio ?? "");
  const [f08, setF08] = useState(c.formulario_08);
  const [transferencia, setTransferencia] = useState(c.transferencia);
  const [patentamiento, setPatentamiento] = useState(c.patentamiento);
  const [programada, setProgramada] = useState(c.entrega_programada ?? "");
  const [entregaAberta, setEntregaAberta] = useState(false);
  const [entregaEm, setEntregaEm] = useState(dados.hoy);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const tramites = tramitesDaUnidade(dados.condicion);
  const entregue = Boolean(c.entregado_en);
  const editavel = podeEditar && !entregue;
  const ocupado = guardar.isPending;

  const salvar = (cambios: GuardarCierre, depois?: () => void) => {
    setErro(null);
    setSalvo(false);
    guardar.mutate(cambios, {
      onSuccess: () => {
        setSalvo(true);
        depois?.();
      },
      onError: (err) => setErro(mensagemDoErro(err, t("Não foi possível salvar a seña. Tente de novo."))),
    });
  };

  const salvarPapelada = (e: React.FormEvent) => {
    e.preventDefault();
    if (dominio.trim() && !dominioValido(dominio)) {
      setErro(t("Patente inválida. Use o formato AB123CD ou ABC123."));
      return;
    }
    salvar({
      dominio: dominio.trim() ? normalizarDominio(dominio) : null,
      ...(tramites.includes("formulario_08") ? { formulario_08: f08 } : {}),
      ...(tramites.includes("transferencia") ? { transferencia } : {}),
      ...(tramites.includes("patentamiento") ? { patentamiento } : {}),
      entrega_programada: programada || null,
    });
  };

  return (
    <div className="rounded-md border p-3" data-testid="cierre-papelada">
      <h4 className="text-sm font-medium">{t("Papelada e entrega")}</h4>
      <form onSubmit={salvarPapelada} className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {t("Patente (domínio)")}
          <input
            value={dominio}
            onChange={(e) => setDominio(e.target.value.toUpperCase())}
            placeholder="AB123CD"
            maxLength={12}
            className={cn(CAMPO, "uppercase")}
            disabled={!editavel || ocupado}
            data-testid="cierre-dominio"
          />
        </label>
        {tramites.includes("formulario_08") && (
          <label className="text-sm">
            {t("Formulário 08")}
            <select
              value={f08}
              onChange={(e) => setF08(e.target.value as typeof f08)}
              className={CAMPO}
              disabled={!editavel || ocupado}
              data-testid="cierre-08"
            >
              {ESTADOS_DEL_08.map((v) => (
                <option key={v} value={v}>
                  {t(ROTULOS_DO_08[v])}
                </option>
              ))}
            </select>
          </label>
        )}
        {tramites.includes("transferencia") && (
          <label className="text-sm">
            {t("Transferência")}
            <select
              value={transferencia}
              onChange={(e) => setTransferencia(e.target.value as typeof transferencia)}
              className={CAMPO}
              disabled={!editavel || ocupado}
              data-testid="cierre-transferencia"
            >
              {ESTADOS_DE_LA_TRANSFERENCIA.map((v) => (
                <option key={v} value={v}>
                  {t(ROTULOS_DA_TRANSFERENCIA[v])}
                </option>
              ))}
            </select>
          </label>
        )}
        {tramites.includes("patentamiento") && (
          <label className="text-sm">
            {t("Emplacamento")}
            <select
              value={patentamiento}
              onChange={(e) => setPatentamiento(e.target.value as typeof patentamiento)}
              className={CAMPO}
              disabled={!editavel || ocupado}
              data-testid="cierre-patentamiento"
            >
              {ESTADOS_DEL_PATENTAMIENTO.map((v) => (
                <option key={v} value={v}>
                  {t(ROTULOS_DO_PATENTAMIENTO[v])}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          {t("Entrega combinada para")}
          <input
            type="date"
            value={programada}
            onChange={(e) => setProgramada(e.target.value)}
            className={CAMPO}
            disabled={!editavel || ocupado}
            data-testid="cierre-entrega-programada"
          />
          <span className="mt-1 block text-xs text-text-muted">{t("O atendente de IA não vê esta data e nunca promete entrega.")}</span>
        </label>
        {editavel && (
          <div className="flex items-end sm:col-span-2">
            <button type="submit" className={BOTAO_PRIMARIO} disabled={ocupado} data-testid="cierre-salvar">
              {t("Salvar papelada")}
            </button>
            {salvo && !erro && (
              <span className="ml-3 text-xs text-emerald-700 dark:text-emerald-300" data-testid="cierre-salvo">
                {t("Salvo.")}
              </span>
            )}
          </div>
        )}
      </form>

      {erro && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="cierre-erro">
          {erro}
        </p>
      )}

      <div className="mt-3 border-t pt-3">
        {entregue ? (
          <div data-testid="cierre-entregado">
            <p className="text-sm font-medium text-sky-800 dark:text-sky-200">
              {t("Unidade entregue em")} {dataCurta(c.entregado_en)}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("A seña foi aplicada e a unidade ficou como vendida no estoque. Mova a operação para Vendido quando fechar o negócio.")}
            </p>
          </div>
        ) : podeEditar && dados.senas.some((s) => s.estado === "vigente") ? (
          entregaAberta ? (
            <div className="flex flex-wrap items-end gap-2" data-testid="cierre-entrega-form">
              <label className="text-sm">
                {t("Data da entrega")}
                <input
                  type="date"
                  value={entregaEm}
                  max={dados.hoy}
                  onChange={(e) => setEntregaEm(e.target.value)}
                  className={CAMPO}
                  disabled={ocupado}
                  data-testid="cierre-entregado-en"
                />
              </label>
              <button
                type="button"
                className={BOTAO_PRIMARIO}
                disabled={ocupado || !entregaEm}
                onClick={() => salvar({ entregado_en: entregaEm }, () => setEntregaAberta(false))}
                data-testid="cierre-confirmar-entrega"
              >
                {t("Confirmar entrega")}
              </button>
              <button type="button" className={BOTAO} onClick={() => setEntregaAberta(false)} disabled={ocupado}>
                {t("Cancelar")}
              </button>
              <p className="w-full text-xs text-text-muted">
                {t("A entrega registrada não muda depois: a seña é aplicada e a unidade fica como vendida.")}
              </p>
            </div>
          ) : (
            <button type="button" className={BOTAO} onClick={() => setEntregaAberta(true)} data-testid="cierre-registrar-entrega">
              {t("Registrar entrega")}
            </button>
          )
        ) : (
          <p className="text-xs text-text-muted">{t("Entrega ainda não registrada.")}</p>
        )}
      </div>
    </div>
  );
}
