/**
 * FORK AUTOVENTA, ETAPA 3, PARTE 2 — PROVA PELA TELA (DoD item 12) da seña e
 * do fechamento, contra o stack local real (`pnpm local:up`: `next start` em
 * contêiner + Supabase local), numa organização de QA isolada
 * (`qa-sembrar.mts`).
 *
 *   1. o VENDEDOR abre a operação, registra a seña da Hilux em pesos com o
 *      comprovante em PDF; a seña fica vigente e ele NÃO vê "Anular seña";
 *   2. a operação foi para a etapa "Señado" e a Hilux aparece "Señado" no
 *      estoque, sem ninguém editar a ficha;
 *   3. o VENDEDOR carrega a papelada: patente, 08 firmado, transferência em
 *      trâmite e a entrega combinada; patente inválida é recusada na tela;
 *   4. o GERENTE vê "Anular seña"; anula uma seña registrada numa segunda
 *      operação (Amarok 0 km, que estava reservada) e a unidade volta a
 *      "Disponible" no estoque;
 *   5. o VENDEDOR registra a entrega da Hilux: a seña fica aplicada e a Hilux
 *      aparece "Vendido" no estoque; a papelada trava;
 *   6. a mesma tela no celular (390 px), sem rolagem lateral.
 *
 *   pnpm exec tsx --env-file=.env.local evidence/autoventa-etapa-3-sena/qa-recorrido.mts http://192.168.68.106:3000
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASTA = "evidence/autoventa-etapa-3-sena";
const creds = JSON.parse(readFileSync(`${PASTA}/.qa-creds.json`, "utf8")) as {
  senha: string; gerente: string; vendedor: string; orgId: string; leadId: string; funilId: string;
  hiluxId: string; amarokId: string;
};
const ESPERA = 30_000;
// Só para LER o que a tela não mostra numa frase (a etapa do card) e para
// semear a segunda operação; toda AÇÃO do recorrido é pela tela.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// Um PDF mínimo válido, como o comprovante de uma transferência.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function entrar(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.senha);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
}

async function abrirOperacao(page: Page, leadId = creds.leadId) {
  await page.goto(`${BASE}/app/leads/${leadId}/pagina`);
  await expect(page.getByTestId("cierre-de-la-operacion")).toBeVisible({ timeout: ESPERA });
}

async function captura(page: Page, nome: string) {
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: true });
  console.log("  📸", nome);
}

async function estadoNoEstoque(page: Page, codigo: string, esperado: RegExp) {
  await page.goto(`${BASE}/app/products`);
  const linha = page.locator(`li, tr, div`).filter({ hasText: codigo }).filter({ hasText: esperado }).last();
  await expect(linha).toBeVisible({ timeout: ESPERA });
}

async function etapaDoNegocio(leadId: string): Promise<string> {
  const { data } = await admin.from("crm_leads").select("crm_stages!inner(name)").eq("id", leadId).single();
  return (data as unknown as { crm_stages: { name: string } }).crm_stages.name;
}

const browser = await chromium.launch();
try {
  // 1. Vendedor registra a seña
  const ctxV = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: "es-AR" });
  const v = await ctxV.newPage();
  await entrar(v, creds.vendedor);
  await abrirOperacao(v);
  await expect(v.getByText("Seña y cierre").first()).toBeVisible();
  await expect(v.getByTestId("sena-vazia")).toContainText("Todavía no hay seña");
  await v.getByTestId("sena-abrir-form").click();
  const opcoes = v.getByTestId("sena-unidad-select").locator("option");
  await expect(opcoes.filter({ hasText: "Toyota Hilux SRV 2021" })).toHaveCount(1, { timeout: ESPERA });
  await expect(opcoes.filter({ hasText: "Volkswagen Amarok V6 Extreme 2026" })).toHaveCount(1);
  await v.getByTestId("sena-unidad-select").selectOption({ label: (await opcoes.filter({ hasText: "Hilux" }).innerText()).trim() });
  await v.getByTestId("sena-monto-input").fill("500.000");
  await v.getByTestId("sena-comprobante-input").setInputFiles({ name: "transferencia-sena.pdf", mimeType: "application/pdf", buffer: PDF });
  await v.getByTestId("sena-notas").fill("Transferencia desde Banco Nación.");
  await captura(v, "01-vendedor-registra-la-sena");
  await v.getByTestId("sena-salvar").click();
  await expect(v.getByTestId("sena-estado")).toHaveText("Seña vigente", { timeout: ESPERA });
  expect((await v.getByTestId("sena-monto").innerText()).replace(/\s/g, " ")).toMatch(/\$ ?500\.000,00/);
  await expect(v.getByTestId("sena-unidad")).toHaveText("Toyota Hilux SRV 2021");
  await expect(v.getByTestId("sena-comprobante")).toHaveText("transferencia-sena.pdf");
  await expect(v.getByTestId("sena-anular"), "vendedor não pode anular").toHaveCount(0);
  await captura(v, "02-sena-vigente-con-comprobante");
  // O comprovante abre pela rota de mídia assinada.
  const href = await v.getByTestId("sena-comprobante").getAttribute("href");
  const midia = await v.request.get(`${BASE}${href}`, { maxRedirects: 5 });
  expect(midia.status(), "comprovante abre").toBe(200);
  console.log("✓ vendedor registró la seña de $ 500.000 con comprobante; no ve Anular");

  // 2. A operação está em "Señado" e a Hilux está señada no estoque
  expect(await etapaDoNegocio(creds.leadId)).toBe("Señado");
  await estadoNoEstoque(v, "HLX-21", /Señado/);
  await captura(v, "03-hilux-senada-en-el-stock");
  console.log("✓ la operación pasó a Señado y la Hilux figura Señado en el stock");

  // 3. Papelada
  await abrirOperacao(v);
  await expect(v.getByTestId("cierre-patentamiento"), "usado não emplaca").toHaveCount(0);
  await v.getByTestId("cierre-dominio").fill("HOLA");
  await v.getByTestId("cierre-salvar").click();
  await expect(v.getByTestId("cierre-erro")).toContainText("Patente inválida");
  await v.getByTestId("cierre-dominio").fill("af 123 cd");
  await v.getByTestId("cierre-08").selectOption("firmado");
  await v.getByTestId("cierre-transferencia").selectOption("en_tramite");
  const daqui5 = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await v.getByTestId("cierre-entrega-programada").fill(daqui5);
  await v.getByTestId("cierre-salvar").click();
  await expect(v.getByTestId("cierre-salvo")).toBeVisible({ timeout: ESPERA });
  await v.reload();
  await expect(v.getByTestId("cierre-dominio")).toHaveValue("AF123CD", { timeout: ESPERA });
  await expect(v.getByTestId("cierre-08")).toHaveValue("firmado");
  await expect(v.getByTestId("cierre-transferencia")).toHaveValue("en_tramite");
  await captura(v, "04-vendedor-carga-la-papeleria");
  console.log("✓ papelería guardada: AF123CD, 08 firmado, transferencia en trámite");

  // 4. Gerente anula uma seña numa segunda operação (Amarok 0 km, reservada)
  const { data: lead2 } = await admin
    .from("crm_leads")
    .insert({
      organization_id: creds.orgId,
      pipeline_id: creds.funilId,
      stage_id: (await admin.from("crm_stages").select("id").eq("pipeline_id", creds.funilId).eq("slug", "calificando").single()).data!.id,
      title: "Julián Pérez · Amarok 0km",
      currency: "USD",
      custom_fields: { usado_entrega: false },
    } as never)
    .select("id")
    .single();
  const lead2Id = (lead2 as { id: string }).id;
  await abrirOperacao(v, lead2Id);
  await v.getByTestId("sena-abrir-form").click();
  const opcao = v.getByTestId("sena-unidad-select").locator("option").filter({ hasText: "Amarok" });
  await expect(opcao).toHaveCount(1, { timeout: ESPERA });
  await expect(v.getByTestId("sena-unidad-select").locator("option").filter({ hasText: "Hilux" }), "Hilux já señada some da lista").toHaveCount(0);
  await v.getByTestId("sena-unidad-select").selectOption({ label: (await opcao.innerText()).trim() });
  await expect(v.getByTestId("sena-moneda")).toHaveValue("USD");
  await v.getByTestId("sena-monto-input").fill("2.000");
  await v.getByTestId("sena-salvar").click();
  await expect(v.getByTestId("sena-sin-comprobante")).toBeVisible({ timeout: ESPERA });
  await expect(v.getByTestId("cierre-patentamiento"), "0 km emplaca").toBeVisible();
  await expect(v.getByTestId("cierre-transferencia")).toHaveCount(0);
  await captura(v, "05-amarok-senada-sin-comprobante");

  const ctxG = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2, locale: "es-AR" });
  const g = await ctxG.newPage();
  await entrar(g, creds.gerente);
  await abrirOperacao(g, lead2Id);
  await g.getByTestId("sena-anular").click();
  await g.getByTestId("sena-confirmar-anulacion").click();
  await expect(g.getByTestId("sena-erro")).toContainText("Contá por qué");
  await g.getByTestId("sena-motivo").fill("El cliente eligió otra versión");
  await captura(g, "06-gerente-anula-la-sena");
  await g.getByTestId("sena-confirmar-anulacion").click();
  await expect(g.getByTestId("sena-vazia")).toBeVisible({ timeout: ESPERA });
  await g.getByTestId("sena-historico").locator("summary").click();
  await expect(g.getByTestId("sena-anterior")).toContainText("El cliente eligió otra versión");
  await captura(g, "07-sena-anulada-en-el-historial");
  await estadoNoEstoque(g, "AMK-26", /Disponible/);
  console.log("✓ gerente anuló la seña de la Amarok y la unidad volvió a Disponible");

  // 5. Vendedor registra a entrega da Hilux
  await abrirOperacao(v);
  await v.getByTestId("cierre-registrar-entrega").click();
  await captura(v, "08-vendedor-registra-la-entrega");
  await v.getByTestId("cierre-confirmar-entrega").click();
  await expect(v.getByTestId("cierre-entregado")).toBeVisible({ timeout: ESPERA });
  await expect(v.getByTestId("sena-estado")).toHaveText("Seña aplicada a la venta");
  await expect(v.getByTestId("cierre-dominio")).toBeDisabled();
  await expect(v.getByTestId("cierre-registrar-entrega")).toHaveCount(0);
  await captura(v, "09-entregada-sena-aplicada");
  await estadoNoEstoque(v, "HLX-21", /Vendido/);
  await captura(v, "10-hilux-vendida-en-el-stock");
  console.log("✓ entrega registrada: seña aplicada y la Hilux figura Vendido en el stock");

  // 6. Celular
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-AR", isMobile: true });
  const m = await ctxM.newPage();
  await entrar(m, creds.gerente);
  await abrirOperacao(m);
  await m.getByTestId("cierre-de-la-operacion").scrollIntoViewIfNeeded();
  const lateral = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(lateral, "rolagem lateral no celular").toBeLessThanOrEqual(0);
  await m.getByTestId("cierre-de-la-operacion").screenshot({ path: `${PASTA}/11-celular-sena-y-cierre.png` });
  console.log("✓ celular sin scroll lateral");
} finally {
  await browser.close();
}
