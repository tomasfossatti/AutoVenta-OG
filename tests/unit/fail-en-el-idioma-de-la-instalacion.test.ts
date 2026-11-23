/**
 * `fail()` HABLA EL IDIOMA DE LA INSTALACIÓN — fork AutoVenta.
 *
 * Unas 1.000 rutas escriben el mensaje de error directo, en portugués o en
 * inglés, y la pantalla lo muestra tal cual. Con `APP_LOCALE=es` el mensaje
 * pasa por el diccionario dentro de `fail()`; sin `APP_LOCALE` sale intacto,
 * como en el upstream. Zod, por su lado, pasa al español con `zodEnEspanol()`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { zodEnEspanol } from "@/lib/i18n/zod-en-espanol";

const ORIGINAL = process.env.APP_LOCALE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_LOCALE;
  else process.env.APP_LOCALE = ORIGINAL;
});

async function mensajeDe(res: Response): Promise<string> {
  return ((await res.json()) as { error: { message: string } }).error.message;
}

describe("fail() traduce con APP_LOCALE", () => {
  it("con APP_LOCALE=es, el portugués sale en español", async () => {
    process.env.APP_LOCALE = "es";
    expect(await mensajeDe(fail("not_found", "Canal não encontrado.", 404))).not.toMatch(/não/);
    expect(await mensajeDe(fail("not_found", "Chamada não encontrada.", 404))).toBe("No se encontró la llamada.");
  });

  it("con APP_LOCALE=es, el inglés también", async () => {
    process.env.APP_LOCALE = "es";
    expect(await mensajeDe(fail("not_found", "Not found.", 404))).toBe("No encontrado.");
  });

  it("sin APP_LOCALE, el mensaje sale intacto (upstream)", async () => {
    delete process.env.APP_LOCALE;
    expect(await mensajeDe(fail("not_found", "Chamada não encontrada.", 404))).toBe("Chamada não encontrada.");
  });

  it("un mensaje que la ruta ya tradujo vuelve igual", async () => {
    process.env.APP_LOCALE = "es";
    expect(await mensajeDe(fail("not_found", "No se encontró la llamada.", 404))).toBe("No se encontró la llamada.");
  });
});

describe("zodEnEspanol()", () => {
  it("los mensajes por defecto de Zod salen en español, y llamarla dos veces no cambia nada", () => {
    zodEnEspanol();
    zodEnEspanol();
    const r = z.object({ nombre: z.string() }).safeParse({ nombre: null });
    expect(r.success).toBe(false);
    const mensaje = r.success ? "" : (r.error.issues[0]?.message ?? "");
    expect(mensaje).not.toMatch(/Invalid input|expected/i);
    expect(mensaje.length).toBeGreaterThan(0);
  });
});
