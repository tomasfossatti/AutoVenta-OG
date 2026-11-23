/**
 * Com que idioma, fuso e moeda nasce a empresa que o ADMIN DA PLATAFORMA cria
 * (Admin › Tenants › Nova) — fork AutoVenta.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * `fn_create_tenant_with_owner` insere a organização só com nome, slug e
 * plano: as demais colunas ficam no DEFAULT do upstream — `pt-BR`,
 * `America/Sao_Paulo`, `BRL`. Numa instalação com `APP_LOCALE=es`, o cliente
 * criado pela tela de admin entrava num produto em português, com o relógio de
 * São Paulo e preços em reais (medido: a organização "FM", 2026-11-23).
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * A empresa nasce no idioma da INSTALAÇÃO (`APP_LOCALE`). O fork só atende a
 * Argentina, então `es` traz junto o fuso de Buenos Aires e o peso argentino.
 * Sem `APP_LOCALE`, ou com `pt-BR`, devolve `null` e nada muda.
 *
 * O país (`organizations.country`) NÃO é gravado: só entra país com perfil
 * legal revisado (`paisesOferecidos`), como em `perfil-da-empresa-nova.ts`.
 */
import { parseAcceptLanguage, type Idioma } from "@/lib/i18n/idiomas";

export interface PerfilDaEmpresaDaInstalacao {
  locale: Idioma;
  timezone?: string;
  currency?: string;
}

export function perfilDaEmpresaDaInstalacao(
  appLocale: string | null | undefined,
): PerfilDaEmpresaDaInstalacao | null {
  const bruto = appLocale?.trim();
  if (!bruto) return null;
  const locale = parseAcceptLanguage(bruto);
  if (!locale || locale === "pt-BR") return null;
  if (locale === "es") {
    return { locale, timezone: "America/Argentina/Buenos_Aires", currency: "ARS" };
  }
  return { locale };
}
