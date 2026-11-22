// hooks/autoventa/useCierre.ts — fork AutoVenta, etapa 3, parte 2.
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { ApiError, type ApiErrorBody } from "@/lib/api/types";
import type {
  CierreGuardado,
  GuardarCierre,
  MonedaDeLaSena,
  SenaGuardada,
  UnidadSenable,
} from "@/lib/autoventa/sena";

export interface SenaDelNegocio extends SenaGuardada {
  comprobante: { id: string; nombre: string | null; url: string } | null;
}

export interface CierreDelNegocio {
  senas: SenaDelNegocio[];
  cierre: Omit<CierreGuardado, "updated_at"> & { updated_at: string | null };
  condicion: "0km" | "usado" | null;
  hoy: string;
}

const chave = (leadId: string) => ["autoventa", "cierre", leadId] as const;

/** A seña, a papelada e a condição da unidade, numa leitura só. */
export function useCierre(leadId: string | null) {
  return useQuery({
    queryKey: chave(leadId ?? ""),
    queryFn: () => apiClient.get<{ data: CierreDelNegocio }>(`/api/v1/leads/${leadId}/cierre`),
    enabled: Boolean(leadId),
    select: (res) => res.data,
  });
}

/** As unidades que podem receber seña agora — só quando o formulário abre. */
export function useUnidadesSenables(leadId: string, aberto: boolean) {
  return useQuery({
    queryKey: ["autoventa", "unidades-senables", leadId] as const,
    queryFn: () => apiClient.get<{ data: { unidades: UnidadSenable[] } }>(`/api/v1/leads/${leadId}/senas`),
    enabled: aberto,
    select: (res) => res.data.unidades,
    staleTime: 0,
  });
}

/** Multipart (o comprovante vai junto): `fetch` direto, como os outros uploads. */
async function enviarFormulario<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & { data?: T };
  if (!res.ok || !json.data) {
    const e = json.error;
    throw new ApiError(res.status, e?.code ?? "upload_failed", e?.details, e?.request_id ?? "", e?.message);
  }
  return json.data;
}

export interface RegistrarSenaInput {
  product_id: string;
  monto_cents: number;
  moneda: MonedaDeLaSena;
  fecha: string;
  notas: string | null;
  comprobante: File | null;
}

export function useRegistrarSena(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegistrarSenaInput) => {
      const form = new FormData();
      form.append("product_id", input.product_id);
      form.append("monto_cents", String(input.monto_cents));
      form.append("moneda", input.moneda);
      form.append("fecha", input.fecha);
      if (input.notas) form.append("notas", input.notas);
      if (input.comprobante) form.append("comprobante", input.comprobante, input.comprobante.name);
      return enviarFormulario<{ sena: SenaGuardada; movimento: string }>(`/api/v1/leads/${leadId}/senas`, form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chave(leadId) });
      void qc.invalidateQueries({ queryKey: ["autoventa", "unidades-senables", leadId] });
      // O card pode ter ido para "Señado": o quadro e o próprio negócio releem.
      void qc.invalidateQueries({ queryKey: ["board"] });
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
  });
}

export function useSubirComprobante(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ senaId, arquivo }: { senaId: string; arquivo: File }) => {
      const form = new FormData();
      form.append("comprobante", arquivo, arquivo.name);
      return enviarFormulario<{ sena: SenaGuardada }>(`/api/v1/leads/${leadId}/senas/${senaId}`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(leadId) }),
  });
}

export function useAnularSena(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ senaId, motivo }: { senaId: string; motivo: string }) =>
      apiClient.patch<{ data: { sena: SenaGuardada } }>(`/api/v1/leads/${leadId}/senas/${senaId}`, {
        accion: "anular",
        motivo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chave(leadId) });
      void qc.invalidateQueries({ queryKey: ["autoventa", "unidades-senables", leadId] });
    },
  });
}

export function useGuardarCierre(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cambios: GuardarCierre) =>
      apiClient.patch<{ data: { cierre: CierreGuardado; entregado_ahora: boolean } }>(
        `/api/v1/leads/${leadId}/cierre`,
        cambios,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(leadId) }),
  });
}
