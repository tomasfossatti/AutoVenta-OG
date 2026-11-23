import Link from "next/link";
import { redirect } from "next/navigation";

import { marcaDaSaida } from "@/lib/branding/saida";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

/**
 * A página inicial pública.
 *
 * Quem tem sessão segue direto para o painel, como sempre foi. Quem não tem vê
 * uma página que diz o que o produto é e leva à política de privacidade e aos
 * termos — sem pedir login.
 *
 * Fork AutoVenta: o texto fala com o dono da concessionária (estoque, usado na
 * troca, avaliação, sinal), e não do CRM genérico. O parágrafo do Google fica:
 * é o que o revisor da verificação procura. A verificação de um app que pede dados de conta
 * Google exige exatamente isso: o revisor abre o endereço principal sem entrar e
 * precisa ver o nome do produto, o que ele faz e o link da política.
 *
 * `/` já é caminho público no `proxy` (`lib/auth/public-paths.ts`), então nada
 * lá muda. O nome vem da marca resolvida (`marcaDaSaida`: banco acima do
 * `.env`), nunca de texto fixo: uma imagem serve todas as marcas.
 *
 * `getUser()` e nunca `getSession()`: o redirecionamento só vale para sessão que
 * o servidor de autenticação confirmou.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  const marca = await marcaDaSaida(null);
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <p className="text-sm font-semibold tracking-tight">{marca.nome}</p>
          <Link
            href="/login"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            {t("Entrar")}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{marca.nome}</h1>
          <p className="text-lg text-muted-foreground">
            {t("O agente de IA que atende o WhatsApp da sua concessionária.")}
          </p>
        </div>

        <p className="leading-relaxed">
          {t(
            "Responde na hora com o seu estoque real de 0 km e usados: preço, fotos, quilometragem e disponibilidade. Quando a consulta está pronta para fechar, passa a conversa para o vendedor, com tudo registrado.",
          )}
        </p>

        <ul className="space-y-4">
          <li className="rounded-lg border bg-background p-4">
            <p className="font-medium">{t("Estoque em dia")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(
                "Você cadastra ou importa as unidades por planilha, e o agente só oferece o que está disponível. Unidade com sinal deixa de ser oferecida.",
              )}
            </p>
          </li>
          <li className="rounded-lg border bg-background p-4">
            <p className="font-medium">{t("Usado na troca e avaliação")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(
                "O agente junta os dados do usado que o cliente quer entregar e pede a avaliação à equipe. O valor é sempre dado por uma pessoa, nunca inventado pela IA.",
              )}
            </p>
          </li>
          <li className="rounded-lg border bg-background p-4">
            <p className="font-medium">{t("Cada operação no funil")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(
                "Da primeira consulta ao sinal e à entrega: cada vendedor vê em que ponto está cada cliente.",
              )}
            </p>
          </li>
        </ul>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(
            "Se a concessionária conecta o Google Agenda, o sistema mostra a agenda e cria, altera e cancela os horários que o cliente pede. Se conecta o Google Ads, devolve ao anúncio as vendas que ele trouxe. O uso dos dados do Google está descrito na",
          )}{" "}
          <Link href="/legal/privacy#dados-do-google" className="underline underline-offset-2">
            {t("Política de Privacidade")}
          </Link>
          .
        </p>
      </main>

      <footer className="border-t bg-background">
        <nav className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-4 text-sm">
          <Link href="/legal/privacy" className="underline underline-offset-2">
            {t("Política de Privacidade")}
          </Link>
          <Link href="/legal/terms" className="underline underline-offset-2">
            {t("Termos de Uso")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
