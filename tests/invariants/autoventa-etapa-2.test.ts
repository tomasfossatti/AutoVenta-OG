import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * FORK AUTOVENTA, ETAPA 2 — o embudo "Ventas" (migration 9901), a ficha do
 * veículo (9902) e a moeda da organização argentina (9903), no banco de verdade.
 */
const ORG_A = "a0709901-0000-4000-8000-000000000001";
const ORG_B = "a0709901-0000-4000-8000-000000000002";
const ORG_ANTIGA = "a0709901-0000-4000-8000-000000000003";
const MANAGER_A = "a0709901-1111-4000-8000-000000000001";
const MANAGER_B = "a0709901-1111-4000-8000-000000000002";
const AGENT_A = "a0709901-1111-4000-8000-000000000003";
const PROD_A = "a0709901-2222-4000-8000-000000000001";
const PROD_B = "a0709901-2222-4000-8000-000000000002";

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${MANAGER_A}','autoventa-gerente-a@invariant.test'),
      ('${MANAGER_B}','autoventa-gerente-b@invariant.test'),
      ('${AGENT_A}','autoventa-vendedor-a@invariant.test');
    insert into organizations(id,slug,legal_name,display_name,timezone) values
      ('${ORG_A}','autoventa-9901-a','Agencia A','Agencia A','America/Argentina/Buenos_Aires'),
      ('${ORG_B}','autoventa-9901-b','Agencia B','Agencia B','America/Argentina/Buenos_Aires');
    insert into user_organizations(user_id,organization_id,role,accepted_at) values
      ('${MANAGER_A}','${ORG_A}','manager',now()),
      ('${MANAGER_B}','${ORG_B}','manager',now()),
      ('${AGENT_A}','${ORG_A}','agent',now());
    insert into catalog_products(id,organization_id,codigo,nome,preco_cents,moeda) values
      ('${PROD_A}','${ORG_A}','HILUX-21','Toyota Hilux SRV 2021',3850000000,'ARS'),
      ('${PROD_B}','${ORG_B}','AMAROK-20','VW Amarok Highline 2020',2850000,'USD');
    insert into catalog_vehicle_details(product_id,organization_id,condicion,modelo,anio,kilometros,estado) values
      ('${PROD_A}','${ORG_A}','usado','Hilux',2021,85000,'disponible'),
      ('${PROD_B}','${ORG_B}','usado','Amarok',2020,60000,'reservado');
  `);
});

describe("9901: a organização nova nasce com o embudo Ventas", () => {
  it("um funil só, padrão, com as 8 etapas em ordem e o vocabulário da concessionária", () => {
    const out = sql(`
      select p.name || '|' || p.is_default || '|' || (p.vocabulary->>'lead') || '|' || (p.vocabulary->>'deal')
        from crm_pipelines p where p.organization_id='${ORG_A}';
      select string_agg(s.name || ':' || coalesce(s.agent_stage_hint,'-'), ',' order by s.position)
        from crm_stages s join crm_pipelines p on p.id=s.pipeline_id where p.organization_id='${ORG_A}';
    `).split("\n");
    expect(out[0]).toBe("Ventas|true|Interesado|Operación");
    expect(out[1]).toBe(
      "Consulta nueva:new,Respondida:contacted,Calificando:qualifying,Visita o test drive agendado:qualified," +
        "Tasación y negociación:negotiating,Señado:-,Vendido:won,Perdido:lost",
    );
  });

  it("Vendido é a etapa de ganho e Perdido a de perda, coerentes com o passo do agente", () => {
    const out = sql(`
      select string_agg(s.slug, ',' order by s.position) filter (where s.is_won)
          || '|' || string_agg(s.slug, ',' order by s.position) filter (where s.is_lost)
        from crm_stages s join crm_pipelines p on p.id=s.pipeline_id where p.organization_id='${ORG_A}';
    `);
    expect(out.trim()).toBe("vendido|perdido");
  });

  it("semear de novo não duplica, e numa organização que já tem padrão o Ventas entra sem roubar o lugar", () => {
    const out = sql(`
      insert into organizations(id,slug,legal_name,display_name) values ('${ORG_ANTIGA}','autoventa-9901-antiga','Antiga','Antiga');
      update crm_pipelines set slug='pedidos', name='Pedidos' where organization_id='${ORG_ANTIGA}';
      select public.fn_autoventa_sembrar_embudo_ventas('${ORG_ANTIGA}') is not null;
      select public.fn_autoventa_sembrar_embudo_ventas('${ORG_ANTIGA}') is not null;
      select string_agg(slug || ':' || is_default, ',' order by slug) from crm_pipelines where organization_id='${ORG_ANTIGA}';
    `).split("\n");
    expect(out.at(-1)).toBe("pedidos:true,ventas:false");
  });
});

describe("9902: a ficha do veículo", () => {
  it.each([[MANAGER_A, ORG_A, ORG_B], [MANAGER_B, ORG_B, ORG_A], [AGENT_A, ORG_A, ORG_B]])(
    "membro %s lê a ficha da própria agência e nenhuma da outra",
    (user, propria, outra) => {
      expect(countAs(user, `select count(*) from catalog_vehicle_details where organization_id='${propria}'`)).toBe(1);
      expect(countAs(user, `select count(*) from catalog_vehicle_details where organization_id='${outra}'`)).toBe(0);
    },
  );

  it("vendedor lê, mas só o gerente da agência muda o estado", () => {
    const reservar = `update catalog_vehicle_details set estado='reservado' where product_id='${PROD_A}'`;
    expect(writeCountAs(AGENT_A, reservar)).toBe(0);
    expect(writeCountAs(MANAGER_B, reservar)).toBe(0);
    expect(writeCountAs(MANAGER_A, reservar)).toBe(1);
  });

  it("a ficha não aponta para produto de outra organização, nem como postgres", () => {
    const out = sql(`do $teste$
      begin
        update catalog_vehicle_details set organization_id='${ORG_B}' where product_id='${PROD_A}';
        raise exception 'ficha de outra organização foi aceita';
      exception when check_violation then null;
      end $teste$;
      select 'recusada';`);
    expect(out.split("\n").at(-1)).toBe("recusada");
  });

  it("estado e combustível fora da lista são recusados pelo CHECK", () => {
    const out = sql(`do $teste$
      begin
        update catalog_vehicle_details set estado='en_camino' where product_id='${PROD_A}';
        raise exception 'estado inválido foi aceito';
      exception when check_violation then null;
      end $teste$;
      do $teste$
      begin
        update catalog_vehicle_details set combustible='kerosene' where product_id='${PROD_A}';
        raise exception 'combustível inválido foi aceito';
      exception when check_violation then null;
      end $teste$;
      select 'recusados';`);
    expect(out.split("\n").at(-1)).toBe("recusados");
  });

  it("apagar o produto apaga a ficha", () => {
    const out = sql(`
      delete from catalog_products where id='${PROD_B}';
      select count(*) from catalog_vehicle_details where product_id='${PROD_B}';
    `);
    expect(out.split("\n").at(-1)).toBe("0");
  });
});

describe("9903: a moeda da organização argentina", () => {
  it("a régua só pega fuso da Argentina com moeda ainda BRL", () => {
    const out = sql(`
      update organizations set currency='BRL' where id in ('${ORG_A}','${ORG_B}');
      update organizations set timezone='America/Sao_Paulo' where id='${ORG_B}';
      update public.organizations set currency = 'ARS'
       where currency = 'BRL' and timezone like 'America/Argentina/%';
      select string_agg(slug || ':' || currency, ',' order by slug) from organizations where id in ('${ORG_A}','${ORG_B}');
    `);
    expect(out.split("\n").at(-1)).toBe("autoventa-9901-a:ARS,autoventa-9901-b:BRL");
  });
});
