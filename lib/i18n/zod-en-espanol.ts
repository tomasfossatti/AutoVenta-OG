/**
 * LOS MENSAJES DE VALIDACIÓN DE ZOD EN ESPAÑOL — fork AutoVenta.
 *
 * Zod nace en inglés: un campo que falla en una ruta respondía "Invalid input:
 * expected string, received null", y unas 22 rutas devuelven ese mensaje tal
 * cual a la pantalla. El producto es solo para Argentina (decisión de Tomás,
 * 2026-11-22) y no muestra texto en otro idioma, así que la configuración
 * global de Zod pasa al español que trae Zod 4 (`z.locales.es`).
 *
 * Es global por proceso, y por eso se llama en cada punto de arranque: el
 * servidor de Next (`instrumentation.ts`), el navegador
 * (`instrumentation-client.ts`) y el worker (`workers/agent-worker/main.ts`).
 * Llamarla dos veces no cambia nada. Los mensajes propios que un schema ya
 * declara (`.min(2, "…")`) no se tocan: esta configuración solo reemplaza los
 * mensajes por defecto.
 */
import { z } from "zod";

let configurado = false;

export function zodEnEspanol(): void {
  if (configurado) return;
  z.config(z.locales.es());
  configurado = true;
}
