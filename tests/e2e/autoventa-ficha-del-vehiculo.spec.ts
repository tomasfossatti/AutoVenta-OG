/**
 * FORK AUTOVENTA, ETAPA 2 — PROVA PELA TELA (DoD item 12).
 *
 * O que um gerente de concessionária faz de verdade, em espanhol, no `next start`
 * real contra o Postgres do Supabase local:
 *
 *   1. abre o quadro e vê o embudo "Ventas" com as oito etapas da concessionária;
 *   2. cadastra uma Hilux usada, disponível, em pesos, com a ficha completa, e vê
 *      o resumo da ficha e o preço em pesos na lista;
 *   3. importa a planilha modelo, que traz uma Amarok reservada em dólares, e vê
 *      "Reservado" e "US$ 28.500,00" na lista;
 *   4. edita a Hilux para "Señado" e vê o resumo mudar.
 *
 * As capturas ficam em `evidence/autoventa-etapa-2/`, versionadas.
 *
 * Pré-requisito: `.e2e-creds.json` (o helper roda o seed se faltar). Sem WAHA,
 * Resend, Nuvemshop nem Redis.
 */
import { mkdirSync } from "node:fs";

import { test, expect, type Page } from "./helpers/test";

import { trocarIdiomaPelaTela } from "./helpers/idioma";
import { lerCreds } from "./helpers/login-admin";

const creds = lerCreds();
const ESPERA = 30_000;
const PASTA = "evidence/autoventa-etapa-2";
const SUFIXO = Date.now().toString(36).toUpperCase();
const HILUX = `HILUX-${SUFIXO}`;

test.describe.configure({ mode: "serial", timeout: 180_000 });
// Captura que uma pessoa vai ver: escala 2.
test.use({ deviceScaleFactor: 2 });

async function entrarComoGerente(page: Page): Promise<void> {
  const email = creds.users.manager?.email;
  expect(email, "sem `manager` no .e2e-creds.json — rode seed-e2e-credentials.ts").toBeTruthy();
  await page.goto("/login");
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
  await trocarIdiomaPelaTela(page, "es");
}

async function captura(page: Page, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: true });
}

const semNbsp = (s: string) => s.replace(/[  ]/g, " ");

test("el quadro abre con el embudo Ventas de concesionaria", async ({ page }) => {
  await entrarComoGerente(page);
  await page.goto("/app/kanban");
  // A tela lista os embudos; o "Ventas" nasce como o predeterminado.
  await expect(page.getByText("Predeterminado").first()).toBeVisible({ timeout: ESPERA });
  await captura(page, "00-lista-de-embudos");
  await page.getByText("Ventas", { exact: true }).first().click();
  for (const etapa of [
    "Consulta nueva",
    "Respondida",
    "Calificando",
    "Visita o test drive agendado",
    "Tasación y negociación",
    "Señado",
    "Vendido",
    "Perdido",
  ]) {
    // O nome da etapa é um campo editável dentro do cabeçalho da coluna, não texto
    // solto: quem nomeia a coluna é o `heading`. Visível = renderizada; as últimas
    // colunas ficam fora da área sem rolar.
    await expect(page.getByRole("heading", { name: etapa, exact: true })).toBeVisible({ timeout: ESPERA });
  }
  await captura(page, "01-embudo-ventas");
});

test("el gerente carga una unidad con la ficha y la ve resumida en el stock", async ({ page }) => {
  await entrarComoGerente(page);
  await page.goto("/app/products");
  await expect(page.getByTestId("tela-produtos")).toBeVisible({ timeout: ESPERA });

  await page.getByTestId("novo-produto").click();
  const form = page.getByTestId("form-produto");
  await expect(form).toBeVisible();
  await expect(form.getByText("Ficha del vehículo")).toBeVisible();

  await form.getByTestId("produto-codigo").fill(HILUX);
  await form.getByTestId("produto-nome").fill("Toyota Hilux SRV 2021");
  await form.getByTestId("produto-preco").fill("38.500.000");
  await form.getByTestId("ficha-estado").selectOption("disponible");
  await form.getByTestId("ficha-condicion").selectOption("usado");
  await form.getByTestId("ficha-moneda").selectOption("ARS");
  await form.getByTestId("ficha-modelo").fill("Hilux");
  await form.getByTestId("ficha-version").fill("SRV");
  await form.getByTestId("ficha-anio").fill("2021");
  await form.getByTestId("ficha-km").fill("85.000");
  await form.getByTestId("ficha-combustible").selectOption("diesel");
  await form.getByTestId("ficha-transmision").selectOption("automatica");
  await form.getByTestId("ficha-color").fill("Blanco");
  await captura(page, "02-alta-con-ficha");

  await form.getByTestId("salvar-produto").click();
  const linha = page.getByTestId(`produto-${HILUX}`);
  await expect(linha).toBeVisible({ timeout: ESPERA });
  await expect(linha).toContainText("Disponible · Usado · 2021 · 85.000 km");
  expect(semNbsp(await linha.innerText())).toContain("$ 38.500.000,00");
  await captura(page, "03-unidad-en-el-stock");
});

test("la planilla modelo carga una unidad reservada en dólares", async ({ page }) => {
  await entrarComoGerente(page);
  await page.goto("/app/products");
  await expect(page.getByTestId("tela-produtos")).toBeVisible({ timeout: ESPERA });

  // A mesma planilha que o botão "Bajar planilla modelo" entrega, com os códigos
  // trocados para não colidir com outra execução no mesmo banco.
  const modelo = await (await page.request.get("/api/v1/products/import")).text();
  expect(modelo).toContain("codigo,nombre,marca,modelo");
  const planilha = modelo.replace("﻿", "").replace(/^(HILUX-21|AMAROK-20|CRONOS-24),/gm, `$1-${SUFIXO},`);

  await page.getByTestId("arquivo-planilha").setInputFiles({
    name: "stock.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(planilha, "utf8"),
  });
  await expect(page.getByTestId("resumo-importacao")).toBeVisible({ timeout: ESPERA });
  await page.reload();

  const amarok = page.getByTestId(`produto-AMAROK-20-${SUFIXO}`);
  await expect(amarok).toBeVisible({ timeout: ESPERA });
  await expect(amarok).toContainText("Reservado · Usado · 2020 · 60.000 km");
  expect(semNbsp(await amarok.innerText())).toContain("US$ 28.500,00");
  await expect(page.getByTestId(`produto-CRONOS-24-${SUFIXO}`)).toContainText("Disponible · 0 km · 2024");
  await captura(page, "04-planilla-importada");
});

test("editar el estado de la unidad cambia el resumen", async ({ page }) => {
  await entrarComoGerente(page);
  await page.goto(`/app/products?busca=${encodeURIComponent(HILUX)}`);
  const linha = page.getByTestId(`produto-${HILUX}`);
  await expect(linha).toBeVisible({ timeout: ESPERA });

  const botao = page.getByTestId(`editar-${HILUX}`);
  const edicao = page.getByTestId(`edicao-${HILUX}`);
  // O painel é estado do cliente: um clique antes da hidratação não abre nada.
  await expect(async () => {
    if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
    await expect(edicao).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  await expect(edicao.getByTestId("ficha-km")).toHaveValue("85000");
  await edicao.getByTestId("ficha-estado").selectOption("senado");
  await captura(page, "05-edicion-senado");
  await edicao.getByTestId("salvar-edicao").click();

  await expect(linha).toContainText("Señado · Usado · 2021 · 85.000 km", { timeout: ESPERA });
  await captura(page, "06-unidad-senada");
});
