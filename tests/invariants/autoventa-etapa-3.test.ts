import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * FORK AUTOVENTA, ETAPA 3 — os campos do usado no embudo "Ventas" e a tasação
 * (`autoventa_tasaciones`, migration 9904), no banco de verdade.
 *
 * O que precisa ser verdade para o agente nunca inventar o valor de um usado:
 *   - só gerente para cima põe valor (INSERT feito, ou pendiente → tasado);
 *   - o vendedor pede (pendiente, sem valor) e registra a resposta do cliente;
 *   - valor e moeda de uma tasação feita não mudam: retasar é outra linha;
 *   - uma agência não lê nem escreve a tasação da outra.
 */
const ORG_A = "a0709904-0000-4000-8000-000000000001";
const ORG_B = "a0709904-0000-4000-8000-000000000002";
const MANAGER_A = "a0709904-1111-4000-8000-000000000001";
const MANAGER_B = "a0709904-1111-4000-8000-000000000002";
const AGENT_A = "a0709904-1111-4000-8000-000000000003";
const LEAD_A = "a0709904-2222-4000-8000-000000000001";
const LEAD_B = "a0709904-2222-4000-8000-000000000002";
const TAS_A = "a0709904-3333-4000-8000-000000000001";
const TAS_B = "a0709904-3333-4000-8000-000000000002";

/** Roda um DML como usuário autenticado e devolve o código do erro, ou "ok". */
function erroAs(userId: string, dml: string): string {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${dml};
    `);
    return "ok";
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (stderr.includes("row-level security")) return "rls";
    const m = stderr.match(/ERROR:\s+([a-z_]+)/);
    return m?.[1] ?? stderr;
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${MANAGER_A}','autoventa3-gerente-a@invariant.test'),
      ('${MANAGER_B}','autoventa3-gerente-b@invariant.test'),
      ('${AGENT_A}','autoventa3-vendedor-a@invariant.test');
    insert into organizations(id,slug,legal_name,display_name,timezone) values
      ('${ORG_A}','autoventa-9904-a','Agencia A','Agencia A','America/Argentina/Buenos_Aires'),
      ('${ORG_B}','autoventa-9904-b','Agencia B','Agencia B','America/Argentina/Buenos_Aires');
    insert into user_organizations(user_id,organization_id,role,accepted_at) values
      ('${MANAGER_A}','${ORG_A}','manager',now()),
      ('${MANAGER_B}','${ORG_B}','manager',now()),
      ('${AGENT_A}','${ORG_A}','agent',now());
    insert into crm_leads(id,organization_id,pipeline_id,stage_id,title)
      select '${LEAD_A}', p.organization_id, p.id, s.id, 'Hilux con Cruze en permuta'
        from crm_pipelines p join crm_stages s on s.pipeline_id = p.id and s.slug = 'consulta_nueva'
       where p.organization_id = '${ORG_A}' and p.slug = 'ventas';
    insert into crm_leads(id,organization_id,pipeline_id,stage_id,title)
      select '${LEAD_B}', p.organization_id, p.id, s.id, 'Amarok con Gol en permuta'
        from crm_pipelines p join crm_stages s on s.pipeline_id = p.id and s.slug = 'consulta_nueva'
       where p.organization_id = '${ORG_B}' and p.slug = 'ventas';
    insert into autoventa_tasaciones(id,organization_id,lead_id,estado,valor_cents,moneda,vence_en) values
      ('${TAS_A}','${ORG_A}','${LEAD_A}','tasado',1200000000,'ARS',current_date + 7),
      ('${TAS_B}','${ORG_B}','${LEAD_B}','tasado',900000,'USD',current_date + 7);
  `);
});

describe("9904: os campos do usado no embudo Ventas", () => {
  it("a organização nova nasce com os 12 campos, na ordem, e só a pergunta-mestra fica sempre visível", () => {
    const out = sql(`
      select string_agg(f->>'key', ',' order by ord)
        from crm_pipelines p, jsonb_array_elements(p.settings->'fields') with ordinality as x(f, ord)
       where p.organization_id='${ORG_A}' and p.slug='ventas';
      select count(*) from crm_pipelines p, jsonb_array_elements(p.settings->'fields') f
       where p.organization_id='${ORG_A}' and p.slug='ventas' and f ? 'mostrar_quando';
    `).split("\n");
    expect(out[0]).toBe(
      "usado_entrega,usado_marca,usado_modelo,usado_version,usado_anio,usado_kilometros," +
        "usado_combustible,usado_transmision,usado_color,usado_duenos,usado_estado,usado_fotos",
    );
    expect(out[1]).toBe("11");
  });

  it("semear de novo não duplica e não pisa um campo que a agência editou", () => {
    const out = sql(`
      update crm_pipelines
         set settings = jsonb_set(settings, '{fields,1,label}', '"Marca"')
       where organization_id='${ORG_A}' and slug='ventas';
      select public.fn_autoventa_sembrar_embudo_ventas('${ORG_A}') is not null;
      select jsonb_array_length(settings->'fields') || '|' || (settings->'fields'->1->>'label')
        from crm_pipelines where organization_id='${ORG_A}' and slug='ventas';
    `).split("\n");
    expect(out.at(-1)).toBe("12|Marca");
  });

  it("funil que já tinha campos próprios recebe os do usado depois deles", () => {
    const out = sql(`
      select public.fn_autoventa_sumar_campos_del_usado(
        '{"fields":[{"key":"financiacion","label":"Financiación","type":"text"}],"lost_reasons":[]}'::jsonb
      ) -> 'fields' -> 0 ->> 'key';
      select jsonb_array_length(public.fn_autoventa_sumar_campos_del_usado(
        '{"fields":[{"key":"financiacion","label":"Financiación","type":"text"}]}'::jsonb
      ) -> 'fields');
    `).split("\n");
    expect(out).toEqual(["financiacion", "13"]);
  });
});

describe("9904: a tasação", () => {
  it.each([
    [MANAGER_A, ORG_A, ORG_B],
    [MANAGER_B, ORG_B, ORG_A],
    [AGENT_A, ORG_A, ORG_B],
  ])("membro %s lê a tasação da própria agência e nenhuma da outra", (user, propria, outra) => {
    expect(countAs(user, `select count(*) from autoventa_tasaciones where organization_id='${propria}'`)).toBe(1);
    expect(countAs(user, `select count(*) from autoventa_tasaciones where organization_id='${outra}'`)).toBe(0);
  });

  it("vendedor não cadastra tasação com valor, nem como pendiente com valor", () => {
    // O gatilho BEFORE roda antes do WITH CHECK da RLS: quem recusa primeiro é
    // ele. As duas barras existem; o que importa é que nenhuma linha entra.
    expect(["rls", "tasar_exige_gerente"]).toContain(
      erroAs(
        AGENT_A,
        `insert into autoventa_tasaciones(organization_id,lead_id,estado,valor_cents,moneda,vence_en)
         values ('${ORG_A}','${LEAD_A}','tasado',100,'ARS',current_date)`,
      ),
    );
    expect(
      erroAs(
        AGENT_A,
        `insert into autoventa_tasaciones(organization_id,lead_id,estado,valor_cents)
         values ('${ORG_A}','${LEAD_A}','pendiente',100)`,
      ),
    ).not.toBe("ok");
    expect(sql(`select count(*) from autoventa_tasaciones where lead_id='${LEAD_A}';`)).toBe("1");
  });

  it("vendedor pede (pendiente), e só existe um pedido aberto por negócio", () => {
    expect(
      writeCountAs(
        AGENT_A,
        `insert into autoventa_tasaciones(organization_id,lead_id) values ('${ORG_A}','${LEAD_A}')`,
      ),
    ).toBe(1);
    expect(
      erroAs(AGENT_A, `insert into autoventa_tasaciones(organization_id,lead_id) values ('${ORG_A}','${LEAD_A}')`),
    ).toBe("duplicate");
    const out = sql(
      `select creada_por || '|' || origen from autoventa_tasaciones where lead_id='${LEAD_A}' and estado='pendiente';`,
    );
    expect(out).toBe(`${AGENT_A}|persona`);
  });

  it("vendedor não tasa o pedido; o gerente tasa, e o banco carimba quem e quando", () => {
    const tasar = `update autoventa_tasaciones set estado='tasado', valor_cents=1500000000, moneda='ARS', vence_en=current_date+7
                    where lead_id='${LEAD_A}' and estado='pendiente'`;
    expect(erroAs(AGENT_A, tasar)).toBe("tasar_exige_gerente");
    expect(writeCountAs(MANAGER_B, tasar)).toBe(0);
    expect(writeCountAs(MANAGER_A, tasar)).toBe(1);
    const out = sql(`
      select tasada_por || '|' || (tasada_en is not null)
        from autoventa_tasaciones where lead_id='${LEAD_A}' and valor_cents=1500000000;
    `);
    expect(out).toBe(`${MANAGER_A}|true`);
  });

  it("vendedor registra a resposta do cliente, mas não mexe no vencimento nem nas notas", () => {
    expect(
      erroAs(AGENT_A, `update autoventa_tasaciones set estado='aceptada', notas='le pareció bien' where id='${TAS_A}'`),
    ).toBe("tasar_exige_gerente");
    expect(writeCountAs(AGENT_A, `update autoventa_tasaciones set estado='aceptada' where id='${TAS_A}'`)).toBe(1);
  });

  it("valor de tasação feita não muda, nem para o gerente: retasar é outra linha", () => {
    expect(
      erroAs(MANAGER_B, `update autoventa_tasaciones set valor_cents=950000 where id='${TAS_B}'`),
    ).toBe("retasar_e_uma_tasacion_nova");
    expect(
      writeCountAs(MANAGER_B, `update autoventa_tasaciones set vence_en=current_date+15 where id='${TAS_B}'`),
    ).toBe(1);
  });

  it("estado final não volta, e pendiente não pula para aceptada", () => {
    expect(erroAs(MANAGER_A, `update autoventa_tasaciones set estado='tasado' where id='${TAS_A}'`)).toBe(
      "tasacion_transicao_invalida",
    );
    const out = sql(`do $teste$
      begin
        insert into autoventa_tasaciones(organization_id,lead_id) values ('${ORG_B}','${LEAD_B}');
        update autoventa_tasaciones set estado='aceptada', valor_cents=1, moneda='USD', vence_en=current_date
         where lead_id='${LEAD_B}' and estado='pendiente';
        raise exception 'pendiente pulou para aceptada';
      exception when check_violation then null;
      end $teste$;
      select 'recusada';`);
    expect(out.split("\n").at(-1)).toBe("recusada");
  });

  it("pendente com valor e feita sem vencimento são recusadas pelo CHECK, nem como postgres", () => {
    const out = sql(`do $teste$
      begin
        insert into autoventa_tasaciones(organization_id,lead_id,estado,valor_cents) values ('${ORG_B}','${LEAD_B}','pendiente',10);
        raise exception 'pendiente com valor foi aceita';
      exception when check_violation then null;
      end $teste$;
      do $teste$
      begin
        insert into autoventa_tasaciones(organization_id,lead_id,estado,valor_cents,moneda) values ('${ORG_B}','${LEAD_B}','tasado',10,'USD');
        raise exception 'tasado sem vencimento foi aceita';
      exception when check_violation then null;
      end $teste$;
      select 'recusadas';`);
    expect(out.split("\n").at(-1)).toBe("recusadas");
  });

  it("a tasação não aponta para negócio de outra organização, nem como postgres", () => {
    const out = sql(`do $teste$
      begin
        insert into autoventa_tasaciones(organization_id,lead_id) values ('${ORG_A}','${LEAD_B}');
        raise exception 'tasação de outra organização foi aceita';
      exception when check_violation then null;
      end $teste$;
      select 'recusada';`);
    expect(out.split("\n").at(-1)).toBe("recusada");
  });

  it("só o gerente apaga, e apagar o negócio apaga as tasações", () => {
    expect(writeCountAs(AGENT_A, `delete from autoventa_tasaciones where id='${TAS_A}'`)).toBe(0);
    const out = sql(`
      delete from crm_leads where id='${LEAD_B}';
      select count(*) from autoventa_tasaciones where lead_id='${LEAD_B}';
    `);
    expect(out.split("\n").at(-1)).toBe("0");
  });
});
