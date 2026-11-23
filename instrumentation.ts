import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Fork AutoVenta: mensajes de validación en español (`lib/i18n/zod-en-espanol.ts`).
  const { zodEnEspanol } = await import("./lib/i18n/zod-en-espanol");
  zodEnEspanol();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
