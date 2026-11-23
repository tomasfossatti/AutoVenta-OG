import { headers } from "next/headers";

import { normalizarIdioma, parseAcceptLanguage, type Idioma } from "@/lib/i18n/idiomas";

/**
 * O idioma de quem ainda não tem sessão (ou cujo perfil não tem `locale`
 * salvo) — as telas públicas (login, signup, convite, legal) ficam fora de
 * `app/app/layout.tsx`: sem `IdiomaProvider`, sem membership, sem
 * organização de quem consultar.
 *
 * Cadeia: preferência salva → `APP_LOCALE` da instalação → `Accept-Language`
 * do navegador → padrão pt-BR.
 *
 * Fork AutoVenta: o `APP_LOCALE` entra ANTES do navegador. A instalação que
 * escolheu um idioma (o fork é só para a Argentina, `APP_LOCALE=es`) mostra
 * esse idioma a todo visitante — inclusive a quem chega com o navegador em
 * inglês e aos robôs que montam a prévia do link no WhatsApp e no Google,
 * que não mandam `Accept-Language` e caíam no português. Sem `APP_LOCALE`
 * nada muda: o navegador decide, como antes. O header é só um SINAL de primeira visita, nunca sobrepõe uma
 * preferência já salva — inclusive um valor antigo desconhecido nela (esse
 * caso já degrada pro padrão dentro de `normalizarIdioma`, e é um problema
 * diferente do que este arquivo resolve: visitante que NUNCA teve conta).
 *
 * Server-only de propósito (`next/headers`): `lib/i18n/idiomas.ts` continua
 * puro porque componente cliente (`SeletorDeIdioma.tsx`) o importa.
 */
export async function idiomaDoVisitante(
  localeBruto: string | null | undefined,
): Promise<Idioma> {
  if (localeBruto) return normalizarIdioma(localeBruto);
  const daInstalacao = process.env.APP_LOCALE?.trim();
  if (daInstalacao) {
    const idioma = parseAcceptLanguage(daInstalacao);
    if (idioma) return idioma;
  }
  const hdrs = await headers();
  return normalizarIdioma(parseAcceptLanguage(hdrs.get("accept-language")));
}
