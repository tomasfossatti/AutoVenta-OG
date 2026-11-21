-- Reverte a migration 9901 (fork AutoVenta): o gatilho volta a semear o funil
-- "Pedidos" do upstream. Os funis "Ventas" já criados ficam como estão (podem
-- ter negócios); arquivá-los é decisão de quem opera, pela tela.
--
-- Aplicar à mão: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fork/revertir/9901_autoventa_embudo_ventas.sql
-- ⚠️ O `update.sh` reaplica o `baseline.sql`, que traz a 9901: para a reversão
-- durar, tire também o apêndice 9901 do baseline do fork.

CREATE OR REPLACE FUNCTION "public"."fn_seed_default_pipeline_for_org"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_pipeline_id uuid;
  v_position numeric := 1000;
  r record;
begin
  insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
  values (new.id, 'Pedidos', 'pedidos', true, 1000)
  returning id into v_pipeline_id;

  for r in
    select * from (values
      ('Carrinho abandonado',  'carrinho_abandonado',  false, false),
      ('Aguardando pagamento', 'aguardando_pagamento', false, false),
      ('Pago',                 'pago',                 true,  false),
      ('Em separação',        'em_separacao',         false, false),
      ('Enviado',              'enviado',              false, false),
      ('Entregue',             'entregue',             false, false),
      ('Pós-venda',           'pos_venda',            false, false),
      ('Cancelado',            'cancelado',            false, true)
    ) as t(stage_name, stage_slug, won, lost)
  loop
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
    values (new.id, v_pipeline_id, r.stage_name, r.stage_slug, v_position, r.won, r.lost);
    v_position := v_position + 1000;
  end loop;

  return new;
end$$;

drop function if exists public.fn_autoventa_sembrar_embudo_ventas(uuid);
