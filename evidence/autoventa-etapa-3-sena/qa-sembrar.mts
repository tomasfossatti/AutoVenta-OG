/**
 * Semeia uma organização de QA isolada para a prova pela tela da seña e do
 * fechamento (etapa 3, parte 2) e a apaga com `--apagar`. Nada toca a
 * organização real da instalação. Duas unidades no estoque: um usado (Hilux,
 * disponível) e um 0 km (Amarok, reservado).
 *
 *   pnpm exec tsx --env-file=.env.local evidence/autoventa-etapa-3-sena/qa-sembrar.mts
 *   pnpm exec tsx --env-file=.env.local evidence/autoventa-etapa-3-sena/qa-sembrar.mts --apagar
 */
import { randomBytes } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const SLUG = "qa-autoventa-etapa-3-sena";
const GERENTE = "qa-sena-gerente@autoventa.invalid";
const VENDEDOR = "qa-sena-vendedor@autoventa.invalid";
const CREDS = "evidence/autoventa-etapa-3-sena/.qa-creds.json";

async function apagar() {
  const { data: org } = await admin.from("organizations").select("id").eq("slug", SLUG).maybeSingle();
  if (org) {
    await admin.from("crm_leads").delete().eq("organization_id", org.id);
    await admin.from("contacts").delete().eq("organization_id", org.id);
    const { error } = await admin.from("organizations").delete().eq("id", org.id);
    if (error) throw new Error(`apagar org: ${error.message}`);
  }
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of lista.users.filter((u) => u.email === GERENTE || u.email === VENDEDOR)) {
    await admin.auth.admin.deleteUser(u.id);
  }
  rmSync(CREDS, { force: true });
  console.log("QA apagada");
}

async function usuario(email: string, senha: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: email.startsWith("qa-sena-gerente") ? "Gerente QA" : "Vendedor QA", locale: "es" },
  });
  if (error || !data.user) throw new Error(`criar ${email}: ${error?.message}`);
  return data.user.id;
}

async function sembrar() {
  await apagar();
  const senha = randomBytes(12).toString("base64url");
  const gerente = await usuario(GERENTE, senha);
  const vendedor = await usuario(VENDEDOR, senha);
  const { data: org, error: eOrg } = await admin
    .from("organizations")
    .insert({
      slug: SLUG,
      display_name: "Agencia QA Señas",
      legal_name: "Agencia QA Señas",
      locale: "es",
      timezone: "America/Argentina/Buenos_Aires",
      currency: "ARS",
      country: "AR",
      created_by: gerente,
    } as never)
    .select("id")
    .single();
  if (eOrg || !org) throw new Error(`org: ${eOrg?.message}`);
  const orgId = (org as { id: string }).id;
  const { error: eOn } = await admin.from("organizations").update({ onboarded_at: new Date().toISOString() } as never).eq("id", orgId);
  if (eOn) throw new Error(`onboarded_at: ${eOn.message}`);
  const { error: eMem } = await admin.from("user_organizations").insert([
    { user_id: gerente, organization_id: orgId, role: "manager", accepted_at: new Date().toISOString() },
    { user_id: vendedor, organization_id: orgId, role: "agent", accepted_at: new Date().toISOString() },
  ] as never);
  if (eMem) throw new Error(`membros: ${eMem.message}`);

  const { data: funil } = await admin.from("crm_pipelines").select("id").eq("organization_id", orgId).eq("slug", "ventas").single();
  const { data: etapa } = await admin
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", (funil as { id: string }).id)
    .eq("slug", "tasacion_y_negociacion")
    .single();
  const { data: contato, error: eCon } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: "Martina Gómez", phone_number: "+5492994001122" } as never)
    .select("id")
    .single();
  if (eCon || !contato) throw new Error(`contato: ${eCon?.message}`);
  const { data: lead, error: eLead } = await admin
    .from("crm_leads")
    .insert({
      organization_id: orgId,
      pipeline_id: (funil as { id: string }).id,
      stage_id: (etapa as { id: string }).id,
      contact_id: (contato as { id: string }).id,
      title: "Martina Gómez · Hilux SRV",
      // A moeda da organização, como o produto grava (`createLeadHandler`,
      // `fn_nascer_lead_da_conversa`). Sem ela o insert direto pegava o default
      // da coluna (BRL) e a tela mostrava "Valor (R$)" numa agência em pesos.
      currency: "ARS",
      custom_fields: {
        usado_entrega: true,
        usado_marca: "Chevrolet",
        usado_modelo: "Cruze",
        usado_version: "LTZ AT",
        usado_anio: 2017,
        usado_kilometros: 85000,
        usado_combustible: "nafta",
        usado_transmision: "automatica",
        usado_color: "Gris",
        usado_duenos: 1,
        usado_estado: "Service al día en concesionario. Un raspón en la puerta trasera derecha.",
      },
    } as never)
    .select("id")
    .single();
  if (eLead || !lead) throw new Error(`lead: ${eLead?.message}`);

  // O estoque: um usado disponível e um 0 km reservado.
  const unidades = [
    { codigo: "HLX-21", nome: "Hilux", marca: "Toyota", preco_cents: 4_500_000_000, moeda: "ARS",
      ficha: { condicion: "usado", modelo: "Hilux", version: "SRV", anio: 2021, kilometros: 62000, estado: "disponible" } },
    { codigo: "AMK-26", nome: "Amarok", marca: "Volkswagen", preco_cents: 5_200_000, moeda: "USD",
      ficha: { condicion: "0km", modelo: "Amarok", version: "V6 Extreme", anio: 2026, kilometros: 0, estado: "reservado" } },
  ];
  const produtos: Record<string, string> = {};
  for (const u of unidades) {
    const { data: p, error: eP } = await admin
      .from("catalog_products")
      .insert({ organization_id: orgId, codigo: u.codigo, nome: u.nome, marca: u.marca, preco_cents: u.preco_cents, moeda: u.moeda } as never)
      .select("id")
      .single();
    if (eP || !p) throw new Error(`produto ${u.codigo}: ${eP?.message}`);
    const id = (p as { id: string }).id;
    const { error: eF } = await admin
      .from("catalog_vehicle_details")
      .insert({ product_id: id, organization_id: orgId, ...u.ficha } as never);
    if (eF) throw new Error(`ficha ${u.codigo}: ${eF.message}`);
    produtos[u.codigo] = id;
  }
  writeFileSync(
    CREDS,
    JSON.stringify(
      {
        senha,
        gerente: GERENTE,
        vendedor: VENDEDOR,
        orgId,
        leadId: (lead as { id: string }).id,
        funilId: (funil as { id: string }).id,
        hiluxId: produtos["HLX-21"],
        amarokId: produtos["AMK-26"],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("QA semeada:", orgId, (lead as { id: string }).id);
}

if (process.argv.includes("--apagar")) await apagar();
else await sembrar();
