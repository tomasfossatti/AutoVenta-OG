// hooks/autoventa/useTasaciones.ts — fork AutoVenta, etapa 3.
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type {
  EstadoDeLaTasacion,
  MonedaDeLaTasacion,
  OrigenDeLaTasacion,
  SituacionDeLaTasacion,
} from "@/lib/autoventa/tasacion";

export interface TasacionDelNegocio {
  id: string;
  lead_id: string;
  estado: EstadoDeLaTasacion;
  situacion: SituacionDeLaTasacion;
  valor_cents: number | null;
  moneda: MonedaDeLaTasacion | null;
  vence_en: string | null;
  notas: string | null;
  origen: OrigenDeLaTasacion;
  tasada_por: string | null;
  tasada_en: string | null;
  created_at: string;
}

const chave = (leadId: string) => ["autoventa", "tasaciones", leadId] as const;

/** As tasações do negócio, a mais recente primeiro (é ela que vale). */
export function useTasaciones(leadId: string | null) {
  return useQuery({
    queryKey: chave(leadId ?? ""),
    queryFn: () =>
      apiClient.get<{ data: { tasaciones: TasacionDelNegocio[]; hoy: string } }>(
        `/api/v1/leads/${leadId}/tasaciones`,
      ),
    enabled: Boolean(leadId),
    select: (res) => res.data,
  });
}

export type CrearTasacionInput =
  | { accion: "pedir"; notas?: string | null }
  | { accion: "tasar"; valor_cents: number; moneda: MonedaDeLaTasacion; vence_en?: string; notas?: string | null };

export function useCrearTasacion(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CrearTasacionInput) =>
      apiClient.post<{ data: { tasacion: TasacionDelNegocio } }>(`/api/v1/leads/${leadId}/tasaciones`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(leadId) }),
  });
}

export function useActualizarTasacion(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tasacionId,
      ...cambios
    }: {
      tasacionId: string;
      estado?: "aceptada" | "rechazada";
      vence_en?: string;
      notas?: string | null;
    }) =>
      apiClient.patch<{ data: { tasacion: TasacionDelNegocio } }>(
        `/api/v1/leads/${leadId}/tasaciones/${tasacionId}`,
        cambios,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(leadId) }),
  });
}
