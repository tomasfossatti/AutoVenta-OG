import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { traduzir } from "@/lib/i18n/dicionario";
import { ProfileForm } from "./_form";

/**
 * A tela de perfil em espanhol — o que ela MOSTRA e o que ela NÃO pode perder.
 *
 * 1. HIDRATAÇÃO: o form nascia em "pt-BR" sem receber o idioma salvo —
 *    salvar qualquer campo gravava pt-BR por cima. Sabotagem: remover
 *    `initialLocale` das props reprova o caso 1.
 * 2. VOZ: no fork AutoVenta, o espanhol das telas do caminho mínimo é
 *    rioplatense com voseo ("Escribí", "Elegí"), vindo de
 *    `lib/i18n/rioplatense.ts`. Voltar ao tuteio ("Escribe") reprova o caso 3.
 */

vi.mock("@/app/actions/settings/updateProfile", () => ({
  updateProfile: vi.fn(async () => ({ ok: true })),
}));

function renderForm(locale: "pt-BR" | "es", initialLocale: "pt-BR" | "es") {
  return render(
    <IdiomaProvider locale={locale}>
      <ProfileForm
        email="dona@empresa.com"
        initialFullName="Dona da Empresa"
        initialAvatarUrl={null}
        initialLocale={initialLocale}
        initialTimezone="America/Sao_Paulo"
      />
    </IdiomaProvider>,
  );
}

describe("ProfileForm em espanhol", () => {
  it("AutoVenta: no ofrece elegir idioma", () => {
    renderForm("es", "es");
    expect(screen.queryByRole("combobox", { name: "Idioma" })).toBeNull();
  });

  it("com locale es, os rótulos vêm do dicionário", () => {
    renderForm("es", "es");
    expect(screen.getByText("Nombre completo")).toBeTruthy();
    expect(screen.getByText("Zona horaria")).toBeTruthy();
    expect(screen.queryByText("Nome completo")).toBeNull();
  });

  it("fork AutoVenta: a voz do espanhol é voseo rioplatense — tuteio reprova", () => {
    expect(traduzir("Escreva uma mensagem…", "es")).toBe("Escribí un mensaje…");
    expect(traduzir("Escolha um modelo aprovado…", "es")).toBe("Elegí una plantilla aprobada…");
  });
});
