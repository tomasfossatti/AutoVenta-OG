import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * FORK AUTOVENTA, ETAPA 3, PARTE 2 — a seña e o fechamento da operação
 * (`autoventa_senas` e `autoventa_cierres`, migration 9905), no banco de verdade.
 *
 * O que precisa ser verdade:
 *   - registrar a seña põe a unidade em `senado`, sozinha, e só se ela está
 *     disponível ou reservada; uma seña vigente por unidade;
 *   - o vendedor registra, mas não anula; o gerente anula com motivo e a
 *     unidade volta a `disponible`;
 *   - monto, moeda e unidade de uma seña não mudam; `aplicada` só pela entrega;
 *   - registrar a entrega aplica a seña e marca a unidade `vendido`; a entrega
 *     registrada não muda; sem seña vigente não há entrega;
 *   - com seña vigente, a ficha do estoque não sai de `senado` à mão;
 *   - uma agência não lê nem escreve a seña nem a papelada da outra.
 */
const ORG_A = "a0709905-0000-4000-8000-000000000001";
const ORG_B = "a0709905-0000-4000-8000-000000000002";
const MANAGER_A = "a0709905-1111-4000-8000-000000000001";
const MANAGER_B = "a0709905-1111-4000-8000-000000000002";
const AGENT_A = "a0709905-1111-4000-8000-000000000003";
const VIEWER_A = "a0709905-1111-4000-8000-000000000004";
const LEAD_A = "a0709905-2222-4000-8000-000000000001";
const LEAD_A2 = "a0709905-2222-4000-8000-000000000003";
const LEAD_B = "a0709905-2222-4000-8000-000000000002";
const HILUX_A = "a0709905-4444-4000-8000-000000000001";
const GOL_A = "a0709905-4444-4000-8000-000000000002";
const VENDIDO_A = "a0709905-4444-4000-8000-000000000003";
const AMAROK_B = "a0709905-4444-4000-8000-000000000004";
const SENA_B = "a0709905-3333-4000-8000-000000000002";

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
    if (stderr.includes("permission denied")) return "permission";
    const m = stderr.match(/ERROR:\s+([a-z_]+)/);
    return m?.[1] ?? stderr;
  }
}

const estadoDe = (productId: string) =>
  sql(`select estado from catalog_vehicle_details where product_id='${productId}';`);

const senaDoAgente = (lead: string, product: string, monto = 50000000) =>
  `insert into autoventa_senas(organization_id,lead_id,product_id,monto_cents,moneda)
   values ('${ORG_A}','${lead}','${product}',${monto},'ARS')`;

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${MANAGER_A}','autoventa5-gerente-a@invariant.test'),
      ('${MANAGER_B}','autoventa5-gerente-b@invariant.test'),
      ('${AGENT_A}','autoventa5-vendedor-a@invariant.test'),
      ('${VIEWER_A}','autoventa5-lector-a@invariant.test');
    insert into organizations(id,slug,legal_name,display_name,timezone) values
      ('${ORG_A}','autoventa-9905-a','Agencia A','Agencia A','America/Argentina/Buenos_Aires'),
      ('${ORG_B}','autoventa-9905-b','Agencia B','Agencia B','America/Argentina/Buenos_Aires');
    insert into user_organizations(user_id,organization_id,role,accepted_at) values
      ('${MANAGER_A}','${ORG_A}','manager',now()),
      ('${MANAGER_B}','${ORG_B}','manager',now()),
      ('${AGENT_A}','${ORG_A}','agent',now()),
      ('${VIEWER_A}','${ORG_A}','viewer',now());
    insert into crm_leads(id,organization_id,pipeline_id,stage_id,title)
      select x.id::uuid, p.organization_id, p.id, s.id, x.titulo
        from (values ('${LEAD_A}','${ORG_A}','Hilux'),('${LEAD_A2}','${ORG_A}','Gol'),('${LEAD_B}','${ORG_B}','Amarok'))
             as x(id, org, titulo)
        join crm_pipelines p on p.organization_id = x.org::uuid and p.slug = 'ventas'
        join crm_stages s on s.pipeline_id = p.id and s.slug = 'tasacion_y_negociacion';
    insert into catalog_products(id,organization_id,codigo,nome,marca,preco_cents,moeda) values
      ('${HILUX_A}','${ORG_A}','HLX-1','Hilux','Toyota',4500000000,'ARS'),
      ('${GOL_A}','${ORG_A}','GOL-1','Gol','Volkswagen',1200000000,'ARS'),
      ('${VENDIDO_A}','${ORG_A}','ETI-1','Etios','Toyota',1500000000,'ARS'),
      ('${AMAROK_B}','${ORG_B}','AMK-1','Amarok','Volkswagen',3000000,'USD');
    insert into catalog_vehicle_details(product_id,organization_id,condicion,modelo,version,anio,estado) values
      ('${HILUX_A}','${ORG_A}','usado','Hilux','SRV',2021,'disponible'),
      ('${GOL_A}','${ORG_A}','usado','Gol Trend',null,2018,'reservado'),
      ('${VENDIDO_A}','${ORG_A}','usado','Etios',null,2019,'vendido'),
      ('${AMAROK_B}','${ORG_B}','0km','Amarok','V6',2026,'disponible');
    insert into autoventa_senas(id,organization_id,lead_id,product_id,monto_cents,moneda)
      values ('${SENA_B}','${ORG_B}','${LEAD_B}','${AMAROK_B}',200000,'USD');
  `);
});

describe("9905: a seña", () => {
  it("registrar a seña põe a unidade em `senado` e guarda a descrição dela", () => {
    expect(estadoDe(AMAROK_B)).toBe("senado");
    expect(sql(`select unidad_descripcion from autoventa_senas where id='${SENA_B}';`)).toBe(
      "Volkswagen Amarok V6 2026",
    );
  });

  it("o leitor não registra seña; o vendedor registra, e o banco carimba quem", () => {
    expect(erroAs(VIEWER_A, senaDoAgente(LEAD_A, HILUX_A))).toBe("rls");
    expect(writeCountAs(AGENT_A, senaDoAgente(LEAD_A, HILUX_A))).toBe(1);
    expect(estadoDe(HILUX_A)).toBe("senado");
    expect(sql(`select creada_por from autoventa_senas where lead_id='${LEAD_A}';`)).toBe(AGENT_A);
  });

  it.each([
    [MANAGER_A, ORG_A, ORG_B],
    [MANAGER_B, ORG_B, ORG_A],
    [AGENT_A, ORG_A, ORG_B],
    [VIEWER_A, ORG_A, ORG_B],
  ])("membro %s lê a seña da própria agência e nenhuma da outra", (user, propria, outra) => {
    expect(countAs(user, `select count(*) from autoventa_senas where organization_id='${propria}'`)).toBe(1);
    expect(countAs(user, `select count(*) from autoventa_senas where organization_id='${outra}'`)).toBe(0);
  });

  it("unidade já señada, vendida, ou de outra agência não recebe seña", () => {
    expect(erroAs(AGENT_A, senaDoAgente(LEAD_A2, HILUX_A))).toBe("unidad_no_disponible");
    expect(erroAs(AGENT_A, senaDoAgente(LEAD_A2, VENDIDO_A))).toBe("unidad_no_disponible");
    expect(erroAs(AGENT_A, senaDoAgente(LEAD_A2, AMAROK_B))).toBe("sena_sem_ficha_do_veiculo");
    expect(sql(`select count(*) from autoventa_senas where lead_id='${LEAD_A2}';`)).toBe("0");
  });

  it("uma seña vigente por operação", () => {
    expect(writeCountAs(AGENT_A, senaDoAgente(LEAD_A2, GOL_A))).toBe(1);
    expect(estadoDe(GOL_A)).toBe("senado");
    // Outra unidade para a MESMA operação: o índice parcial recusa.
    sql(`insert into catalog_products(id,organization_id,codigo,nome,preco_cents,moeda)
           values ('a0709905-4444-4000-8000-000000000009','${ORG_A}','X-9','Corolla',1,'ARS');
         insert into catalog_vehicle_details(product_id,organization_id) values ('a0709905-4444-4000-8000-000000000009','${ORG_A}');`);
    expect(erroAs(AGENT_A, senaDoAgente(LEAD_A2, "a0709905-4444-4000-8000-000000000009"))).toBe("duplicate");
    expect(estadoDe("a0709905-4444-4000-8000-000000000009")).toBe("disponible");
  });

  it("monto, moeda e unidade não mudam, nem para o gerente", () => {
    expect(
      erroAs(MANAGER_A, `update autoventa_senas set monto_cents=1 where lead_id='${LEAD_A}'`),
    ).toBe("sena_campo_imutavel");
    expect(
      erroAs(MANAGER_A, `update autoventa_senas set moneda='USD' where lead_id='${LEAD_A}'`),
    ).toBe("sena_campo_imutavel");
  });

  it("ninguém aplica a seña com um clique: só a entrega", () => {
    expect(
      erroAs(MANAGER_A, `update autoventa_senas set estado='aplicada' where lead_id='${LEAD_A}'`),
    ).toBe("aplicar_so_pela_entrega");
  });

  it("com seña vigente, a ficha não sai de `senado` à mão, nem pelo gerente", () => {
    expect(
      erroAs(MANAGER_A, `update catalog_vehicle_details set estado='disponible' where product_id='${HILUX_A}'`),
    ).toBe("unidad_con_sena_vigente");
    expect(estadoDe(HILUX_A)).toBe("senado");
  });

  it("vendedor não anula; gerente vizinho sem efeito; gerente anula com motivo e a unidade volta", () => {
    const anular = `update autoventa_senas set estado='anulada', motivo_anulacion='El cliente se arrepintió'
                     where lead_id='${LEAD_A2}' and estado='vigente'`;
    expect(erroAs(AGENT_A, anular)).toBe("anular_exige_gerente");
    expect(writeCountAs(MANAGER_B, anular)).toBe(0);
    expect(
      erroAs(MANAGER_A, `update autoventa_senas set estado='anulada' where lead_id='${LEAD_A2}' and estado='vigente'`),
    ).not.toBe("ok");
    expect(writeCountAs(MANAGER_A, anular)).toBe(1);
    expect(estadoDe(GOL_A)).toBe("disponible");
    expect(
      sql(`select anulada_por || '|' || (anulada_en is not null) from autoventa_senas where lead_id='${LEAD_A2}';`),
    ).toBe(`${MANAGER_A}|true`);
  });

  it("seña anulada não volta a vigente", () => {
    expect(
      erroAs(MANAGER_A, `update autoventa_senas set estado='vigente', motivo_anulacion=null where lead_id='${LEAD_A2}'`),
    ).toBe("sena_transicao_invalida");
  });

  it("ninguém da organização apaga uma seña", () => {
    expect(erroAs(MANAGER_A, `delete from autoventa_senas where lead_id='${LEAD_A}'`)).toBe("permission");
  });
});

describe("9905: a papelada e a entrega", () => {
  it("vendedor carga a papelada; a patente sai normalizada; patente inválida é recusada", () => {
    expect(
      writeCountAs(
        AGENT_A,
        `insert into autoventa_cierres(lead_id,organization_id,dominio,formulario_08,entrega_programada)
         values ('${LEAD_A}','${ORG_A}','ab 123 cd','firmado',current_date + 3)`,
      ),
    ).toBe(1);
    expect(sql(`select dominio || '|' || actualizado_por from autoventa_cierres where lead_id='${LEAD_A}';`)).toBe(
      `AB123CD|${AGENT_A}`,
    );
    expect(
      erroAs(AGENT_A, `update autoventa_cierres set dominio='HOLA' where lead_id='${LEAD_A}'`),
    ).toBe("new");
  });

  it.each([
    [MANAGER_A, ORG_A, ORG_B],
    [MANAGER_B, ORG_B, ORG_A],
  ])("membro %s lê só a papelada da própria agência", (user, propria, outra) => {
    sql(`insert into autoventa_cierres(lead_id,organization_id) values ('${LEAD_B}','${ORG_B}') on conflict do nothing;`);
    expect(countAs(user, `select count(*) from autoventa_cierres where organization_id='${propria}'`)).toBe(1);
    expect(countAs(user, `select count(*) from autoventa_cierres where organization_id='${outra}'`)).toBe(0);
  });

  it("gerente vizinho não escreve a papelada da outra agência", () => {
    expect(
      writeCountAs(MANAGER_B, `update autoventa_cierres set formulario_08='certificado' where lead_id='${LEAD_A}'`),
    ).toBe(0);
  });

  it("sem seña vigente não há entrega", () => {
    expect(
      erroAs(
        MANAGER_A,
        `insert into autoventa_cierres(lead_id,organization_id,entregado_en) values ('${LEAD_A2}','${ORG_A}',current_date)`,
      ),
    ).toBe("entrega_sin_sena");
  });

  it("registrar a entrega aplica a seña e marca a unidade `vendido`", () => {
    expect(
      writeCountAs(AGENT_A, `update autoventa_cierres set entregado_en=current_date where lead_id='${LEAD_A}'`),
    ).toBe(1);
    expect(sql(`select estado || '|' || (aplicada_en is not null) from autoventa_senas where lead_id='${LEAD_A}';`)).toBe(
      "aplicada|true",
    );
    expect(estadoDe(HILUX_A)).toBe("vendido");
    expect(sql(`select entrega_registrada_por from autoventa_cierres where lead_id='${LEAD_A}';`)).toBe(AGENT_A);
  });

  it("a entrega registrada não muda nem some", () => {
    expect(
      erroAs(MANAGER_A, `update autoventa_cierres set entregado_en=null where lead_id='${LEAD_A}'`),
    ).toBe("entrega_ya_registrada");
    expect(
      erroAs(MANAGER_A, `update autoventa_cierres set entregado_en=current_date - 2 where lead_id='${LEAD_A}'`),
    ).toBe("entrega_ya_registrada");
  });

  it("seña aplicada não é anulada", () => {
    expect(
      erroAs(
        MANAGER_A,
        `update autoventa_senas set estado='anulada', motivo_anulacion='x' where lead_id='${LEAD_A}'`,
      ),
    ).toBe("sena_transicao_invalida");
  });

  it("a seña e a papelada não apontam para negócio de outra organização, nem como postgres", () => {
    const out = sql(`do $teste$
      begin
        insert into autoventa_cierres(lead_id,organization_id) values ('${LEAD_B}','${ORG_A}');
        raise exception 'cierre de outra organização foi aceito';
      exception when check_violation or unique_violation then null;
      end $teste$;
      do $teste$
      begin
        insert into autoventa_senas(organization_id,lead_id,product_id,monto_cents,moneda)
          values ('${ORG_A}','${LEAD_B}','${GOL_A}',1,'ARS');
        raise exception 'seña de outra organização foi aceita';
      exception when check_violation then null;
      end $teste$;
      select 'recusadas';`);
    expect(out.split("\n").at(-1)).toBe("recusadas");
  });

  it("apagar o negócio com seña vigente devolve a unidade a `disponible`", () => {
    const out = sql(`
      delete from crm_leads where id='${LEAD_B}';
      select count(*) || '|' || (select estado from catalog_vehicle_details where product_id='${AMAROK_B}')
        from autoventa_senas where lead_id='${LEAD_B}';
    `);
    expect(out.split("\n").at(-1)).toBe("0|disponible");
  });
});
