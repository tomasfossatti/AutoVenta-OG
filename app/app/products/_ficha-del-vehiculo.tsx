"use client";

import { useT } from "@/hooks/i18n/useT";
import {
  COMBUSTIBLES,
  CONDICIONES,
  ESTADOS_DEL_VEHICULO,
  MONEDAS_DEL_VEHICULO,
  ROTULOS_DA_CONDICAO,
  ROTULOS_DO_CAMBIO,
  ROTULOS_DO_COMBUSTIVEL,
  ROTULOS_DO_ESTADO,
  TRANSMISIONES,
  lerInteiro,
  type FichaDelVehiculo,
  type FichaGuardada,
  type MonedaDelVehiculo,
} from "@/lib/catalogo/vehiculo";

/**
 * A FICHA DO VEÍCULO NA TELA — fork AutoVenta, etapa 2.
 *
 * Os mesmos campos no cadastro e na edição: condição, modelo, versão, ano, km,
 * combustível, câmbio, cor, estado e a moeda da unidade. O que é gravado é o que
 * `fichaDelVehiculoSchema` (`lib/catalogo/vehiculo.ts`) aceita; a régua de
 * conversão do rascunho mora aqui, ao lado dos campos.
 */
export interface RascunhoDaFicha {
  condicion: string;
  modelo: string;
  version: string;
  anio: string;
  kilometros: string;
  combustible: string;
  transmision: string;
  color: string;
  estado: string;
}

export function rascunhoDaFicha(ficha?: FichaGuardada | null): RascunhoDaFicha {
  return {
    condicion: ficha?.condicion ?? "usado",
    modelo: ficha?.modelo ?? "",
    version: ficha?.version ?? "",
    anio: ficha?.anio != null ? String(ficha.anio) : "",
    kilometros: ficha?.kilometros != null ? String(ficha.kilometros) : "",
    combustible: ficha?.combustible ?? "",
    transmision: ficha?.transmision ?? "",
    color: ficha?.color ?? "",
    estado: ficha?.estado ?? "disponible",
  };
}

/** O rascunho como a rota o recebe, ou o motivo de não poder gravar. */
export function fichaDoRascunho(
  r: RascunhoDaFicha,
  t: (texto: string) => string,
): { ficha: FichaDelVehiculo } | { erro: string } {
  const anio = lerInteiro(r.anio);
  if (anio === undefined || (anio !== null && (anio < 1950 || anio > 2100))) return { erro: t("Ano inválido.") };
  const kilometros = lerInteiro(r.kilometros);
  if (kilometros === undefined || (kilometros !== null && kilometros > 2_000_000)) {
    return { erro: t("Quilometragem inválida.") };
  }
  return {
    ficha: {
      condicion: r.condicion as FichaDelVehiculo["condicion"],
      modelo: r.modelo.trim() || null,
      version: r.version.trim() || null,
      anio,
      kilometros,
      combustible: (r.combustible || null) as FichaDelVehiculo["combustible"],
      transmision: (r.transmision || null) as FichaDelVehiculo["transmision"],
      color: r.color.trim() || null,
      estado: r.estado as FichaDelVehiculo["estado"],
    },
  };
}

const ROTULOS_DA_MOEDA: Record<MonedaDelVehiculo, string> = { ARS: "Pesos (ARS)", USD: "Dólares (USD)" };

export function CamposDaFicha({
  valor,
  aoMudar,
  moeda,
  aoMudarMoeda,
  desabilitado = false,
}: {
  valor: RascunhoDaFicha;
  aoMudar: (r: RascunhoDaFicha) => void;
  moeda: string;
  aoMudarMoeda: (m: MonedaDelVehiculo) => void;
  desabilitado?: boolean;
}) {
  const t = useT();
  const campo = "mt-1 h-9 w-full rounded-md border px-3";
  const muda = (chave: keyof RascunhoDaFicha) => (e: { target: { value: string } }) =>
    aoMudar({ ...valor, [chave]: e.target.value });

  return (
    <fieldset className="mt-3 rounded-md border p-3" data-testid="ficha-del-vehiculo">
      <legend className="px-1 text-sm font-medium">{t("Ficha do veículo")}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          {t("Estado")}
          <select value={valor.estado} onChange={muda("estado")} className={campo} disabled={desabilitado} data-testid="ficha-estado">
            {ESTADOS_DEL_VEHICULO.map((e) => (
              <option key={e} value={e}>
                {t(ROTULOS_DO_ESTADO[e])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Condição")}
          <select value={valor.condicion} onChange={muda("condicion")} className={campo} disabled={desabilitado} data-testid="ficha-condicion">
            {CONDICIONES.map((c) => (
              <option key={c} value={c}>
                {t(ROTULOS_DA_CONDICAO[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Moeda do preço")}
          <select
            value={moeda}
            onChange={(e) => aoMudarMoeda(e.target.value as MonedaDelVehiculo)}
            className={campo}
            disabled={desabilitado}
            data-testid="ficha-moneda"
          >
            {MONEDAS_DEL_VEHICULO.map((m) => (
              <option key={m} value={m}>
                {t(ROTULOS_DA_MOEDA[m])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Modelo")}
          <input value={valor.modelo} onChange={muda("modelo")} maxLength={80} className={campo} disabled={desabilitado} data-testid="ficha-modelo" />
        </label>
        <label className="text-sm">
          {t("Versão")}
          <input value={valor.version} onChange={muda("version")} maxLength={80} className={campo} disabled={desabilitado} data-testid="ficha-version" />
        </label>
        <label className="text-sm">
          {t("Ano")}
          <input value={valor.anio} onChange={muda("anio")} inputMode="numeric" placeholder="2021" className={campo} disabled={desabilitado} data-testid="ficha-anio" />
        </label>
        <label className="text-sm">
          {t("Quilometragem")}
          <input value={valor.kilometros} onChange={muda("kilometros")} inputMode="numeric" placeholder="85.000" className={campo} disabled={desabilitado} data-testid="ficha-km" />
        </label>
        <label className="text-sm">
          {t("Combustível")}
          <select value={valor.combustible} onChange={muda("combustible")} className={campo} disabled={desabilitado} data-testid="ficha-combustible">
            <option value="">{t("Sem informar")}</option>
            {COMBUSTIBLES.map((c) => (
              <option key={c} value={c}>
                {t(ROTULOS_DO_COMBUSTIVEL[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Câmbio")}
          <select value={valor.transmision} onChange={muda("transmision")} className={campo} disabled={desabilitado} data-testid="ficha-transmision">
            <option value="">{t("Sem informar")}</option>
            {TRANSMISIONES.map((c) => (
              <option key={c} value={c}>
                {t(ROTULOS_DO_CAMBIO[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Cor")}
          <input value={valor.color} onChange={muda("color")} maxLength={40} className={campo} disabled={desabilitado} data-testid="ficha-color" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          "O atendente de IA só oferece como disponível a unidade em Disponível. Reservada, com sinal ou vendida, ele avisa que não está disponível e passa a conversa a um vendedor.",
        )}
      </p>
    </fieldset>
  );
}

/** O resumo da ficha na linha da lista: "Disponível · Usado · 2021 · 85.000 km". */
export function resumoDaFicha(ficha: FichaGuardada, t: (texto: string) => string): string {
  const partes = [t(ROTULOS_DO_ESTADO[ficha.estado]), t(ROTULOS_DA_CONDICAO[ficha.condicion])];
  if (ficha.anio !== null) partes.push(String(ficha.anio));
  if (ficha.kilometros !== null) partes.push(`${ficha.kilometros.toLocaleString("es-AR")} km`);
  return partes.join(" · ");
}
