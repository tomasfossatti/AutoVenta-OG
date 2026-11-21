/**
 * FORK AUTOVENTA, ETAPA 3 — PROVA PELA TELA (DoD item 12), contra o stack
 * local real (`pnpm local:up`: `next start` em contêiner + Supabase local).
 *
 *   1. o VENDEDOR abre a operação, vê o usado que o cliente contou e pede a
 *      tasação; não vê o botão de tasar;
 *   2. o GERENTE abre a mesma operação, vê o pedido pendente e carga a tasação
 *      em pesos, com o vencimento padrão de 7 dias;
 *   3. o VENDEDOR registra que o cliente aceitou;
 *   4. a mesma tela no celular (390 px), sem rolagem lateral;
 *   5. o GERENTE cria uma operação por "Nuevo negocio", como uma pessoa faria, e
 *      o valor dela está em pesos — "Valor ($)", não "Valor (R$)" — no
 *      formulário e na ficha; e o card dela, sem usado, não mostra "Fotos del
 *      usado" (o campo que a ficha esconde pela condição).
 *
 *   pnpm exec tsx evidence/autoventa-etapa-3/qa-recorrido.mts http://192.168.68.106:3000
 */
import { readFileSync } from "node:fs";
import { chromium, expect, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASTA = "evidence/autoventa-etapa-3";
const creds = JSON.parse(readFileSync(`${PASTA}/.qa-creds.json`, "utf8")) as {
  senha: string; gerente: string; vendedor: string; leadId: string; funilId: string;
};
const ESPERA = 30_000;

async function entrar(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.senha);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

async function abrirOperacao(page: Page) {
  await page.goto(`${BASE}/app/leads/${creds.leadId}/pagina`);
  await expect(page.getByTestId("tasacion-del-negocio")).toBeVisible({ timeout: ESPERA });
}

async function captura(page: Page, nome: string) {
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: true });
  console.log("  📸", nome);
}

const browser = await chromium.launch();
try {
  // 1. Vendedor
  const ctxV = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: "es-AR" });
  const v = await ctxV.newPage();
  await entrar(v, creds.vendedor);
  await abrirOperacao(v);
  await expect(v.getByText("Usado y tasación").first()).toBeVisible();
  await expect(v.getByText("¿Entrega usado en parte de pago?").first()).toBeVisible();
  await expect(v.getByText("Kilómetros del usado").first()).toBeVisible();
  await expect(v.getByTestId("tasacion-vazia")).toContainText("Todavía nadie tasó el usado");
  await expect(v.getByTestId("tasacion-abrir-form"), "vendedor não pode ver o botão de tasar").toHaveCount(0);
  await captura(v, "01-vendedor-ve-el-usado-sin-tasacion");
  await v.getByTestId("tasacion-pedir").click();
  await expect(v.getByTestId("tasacion-situacao")).toHaveText("Pendiente", { timeout: ESPERA });
  await expect(v.getByTestId("tasacion-abrir-form")).toHaveCount(0);
  await captura(v, "02-vendedor-pidio-la-tasacion");
  console.log("✓ vendedor pidió la tasación y no puede tasar");

  // 2. Gerente
  const ctxG = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: "es-AR" });
  const g = await ctxG.newPage();
  await entrar(g, creds.gerente);
  await abrirOperacao(g);
  await expect(g.getByTestId("tasacion-situacao")).toHaveText("Pendiente");
  await g.getByTestId("tasacion-abrir-form").click();
  await expect(g.getByTestId("tasacion-abrir-form")).toHaveCount(0);
  await g.getByTestId("tasacion-valor-input").fill("12.000.000");
  const vence = await g.getByTestId("tasacion-vence-input").inputValue();
  await g.getByTestId("tasacion-notas").fill("Sujeto a revisión del raspón en la puerta.");
  await captura(g, "03-gerente-carga-la-tasacion");
  await g.getByTestId("tasacion-salvar").click();
  await expect(g.getByTestId("tasacion-situacao")).toHaveText("Vigente", { timeout: ESPERA });
  const valor = (await g.getByTestId("tasacion-valor").innerText()).replace(/\s/g, " ");
  expect(valor).toMatch(/\$ ?12\.000\.000,00/);
  const [a, m, d] = vence.split("-");
  await expect(g.getByTestId("tasacion-vence")).toHaveText(`${d}/${m}/${a}`);
  await captura(g, "04-gerente-tasacion-vigente");
  console.log(`✓ gerente tasó en ${valor}, vale hasta ${d}/${m}/${a}`);

  // 3. Vendedor registra la respuesta
  await v.reload();
  await expect(v.getByTestId("tasacion-situacao")).toHaveText("Vigente", { timeout: ESPERA });
  await v.getByTestId("tasacion-aceita").click();
  await expect(v.getByTestId("tasacion-situacao")).toHaveText("Aceptada por el cliente", { timeout: ESPERA });
  await expect(v.getByTestId("tasacion-pedir")).toHaveCount(0);
  await captura(v, "05-vendedor-cliente-acepto");
  console.log("✓ vendedor registró que el cliente aceptó");

  // 4. Celular
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-AR", isMobile: true });
  const mPage = await ctxM.newPage();
  await entrar(mPage, creds.gerente);
  await abrirOperacao(mPage);
  await mPage.getByTestId("tasacion-del-negocio").scrollIntoViewIfNeeded();
  const lateral = await mPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(lateral, "rolagem lateral no celular").toBeLessThanOrEqual(0);
  await mPage.getByTestId("tasacion-del-negocio").screenshot({ path: `${PASTA}/06-celular-seccion-tasacion.png` });
  console.log("✓ celular sin scroll lateral");

  // 5. Operación nueva por la pantalla: nace en la moneda de la agencia
  await g.goto(`${BASE}/app/pipelines/${creds.funilId}`);
  await g.getByRole("button", { name: "Nuevo negocio" }).first().click();
  const dialogo = g.getByRole("dialog");
  await expect(dialogo.locator('label[for="valueReais"]')).toHaveText("Valor ($)", { timeout: ESPERA });
  const titulo = `Consulta por Amarok ${Date.now().toString(36)}`;
  await dialogo.locator("#title").fill(titulo);
  await dialogo.locator("#valueReais").fill("28.500.000");
  await captura(g, "07-gerente-nuevo-negocio-en-pesos");
  await dialogo.getByRole("button", { name: "Crear negocio" }).click();
  await expect(dialogo).toHaveCount(0, { timeout: ESPERA });
  // Sin usado, la tarjeta no muestra "Fotos del usado" (la ficha tampoco).
  const tarjeta = g.locator(`[aria-label="Negocio: ${titulo}"]`).first();
  await expect(tarjeta).toBeVisible({ timeout: ESPERA });
  await expect(tarjeta.getByTestId("arquivos-do-campo-usado_fotos")).toHaveCount(0);
  await g.getByText(titulo).first().click();
  const ficha = g.getByRole("dialog");
  await expect(ficha.locator('label[for="valueReais"]')).toHaveText("Valor ($)", { timeout: ESPERA });
  await expect(ficha.getByText("Valor (R$)")).toHaveCount(0);
  await captura(g, "08-ficha-del-negocio-en-pesos");
  console.log("✓ operación nueva en pesos: Valor ($) en el formulario y en la ficha");
} finally {
  await browser.close();
}
