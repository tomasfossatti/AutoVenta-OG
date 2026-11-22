-- manifest: Fork AutoVenta — o funil que toda organização nova recebe passa a ser o "Ventas" de concessionária (8 etapas em espanhol rioplatense, com `agent_stage_hint`) no lugar do "Pedidos" de e-commerce; `fn_autoventa_sembrar_embudo_ventas(org)` semeia o mesmo funil numa organização que já existe, sem apagar nada.
--
-- 9901 — o embudo de concesionaria.
--
-- `trg_seed_default_pipeline_for_org` semeava em toda organização nova o funil
-- de e-commerce em português ("Carrinho abandonado", "Em separação"…) e sem
-- nenhum `agent_stage_hint`, então o agente não conseguia mover card nenhum.
-- O gatilho continua o mesmo; muda o que ele semeia.
--
-- As etapas, cada uma com o passo do agente (`agent_stage_hint`):
--   Consulta nueva → new · Respondida → contacted · Calificando → qualifying ·
--   Visita o test drive agendado → qualified · Tasación y negociación →
--   negotiating · Señado → NULL (só uma pessoa move: a seña é registro do
--   vendedor) · Vendido → won · Perdido → lost.
-- `is_won`/`is_lost` seguem o passo, como exige `crm_stages_hint_coerente_com_won_lost`.
--
-- ORGANIZAÇÃO QUE JÁ EXISTE: nada muda sozinha. O "Pedidos" pode ter negócios e
-- é o funil que o agente publicado tem no escopo (`ai_agent_versions.pipeline_ids`);
-- trocá-lo por migration deixaria o agente sem funil. Quem quiser o "Ventas"
-- numa organização existente roda `select public.fn_autoventa_sembrar_embudo_ventas('<org>')`
-- e marca o funil novo no agente pela tela (IA › Agentes).
--
-- Reverter: `supabase/fork/revertir/9901_autoventa_embudo_ventas.sql`.

create or replace function public.fn_autoventa_sembrar_embudo_ventas(p_organization_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_pipeline_id uuid;
  v_position numeric := 1000;
  r record;
begin
  select id into v_pipeline_id
    from public.crm_pipelines
   where organization_id = p_organization_id and slug = 'ventas';
  if v_pipeline_id is not null then
    return v_pipeline_id;
  end if;

  -- Um padrão por organização (índice parcial): o "Ventas" só assume o lugar
  -- quando ainda não há nenhum funil padrão.
  insert into public.crm_pipelines (organization_id, name, slug, is_default, position, vocabulary)
  values (
    p_organization_id,
    'Ventas',
    'ventas',
    not exists (
      select 1 from public.crm_pipelines
       where organization_id = p_organization_id and is_default and not is_archived
    ),
    1000,
    jsonb_build_object(
      'lead', 'Interesado', 'lead_plural', 'Interesados',
      'deal', 'Operación', 'deal_plural', 'Operaciones',
      'won', 'Vendido', 'lost', 'Perdido',
      'stage', 'Etapa', 'stage_plural', 'Etapas'
    )
  )
  returning id into v_pipeline_id;

  for r in
    select * from (values
      ('Consulta nueva',               'consulta_nueva',         false, false, 'new'),
      ('Respondida',                   'respondida',             false, false, 'contacted'),
      ('Calificando',                  'calificando',            false, false, 'qualifying'),
      ('Visita o test drive agendado', 'visita_o_test_drive',    false, false, 'qualified'),
      ('Tasación y negociación',       'tasacion_y_negociacion', false, false, 'negotiating'),
      ('Señado',                       'senado',                 false, false, null),
      ('Vendido',                      'vendido',                true,  false, 'won'),
      ('Perdido',                      'perdido',                false, true,  'lost')
    ) as t(stage_name, stage_slug, won, lost, hint)
  loop
    insert into public.crm_stages
      (organization_id, pipeline_id, name, slug, position, is_won, is_lost, agent_stage_hint)
    values
      (p_organization_id, v_pipeline_id, r.stage_name, r.stage_slug, v_position, r.won, r.lost, r.hint);
    v_position := v_position + 1000;
  end loop;

  return v_pipeline_id;
end
$fn$;

-- Sem `security definer`: roda com o papel de quem cria a organização (o gatilho)
-- ou de quem a chama à mão, e a RLS de `crm_pipelines`/`crm_stages` segue valendo.

create or replace function public.fn_seed_default_pipeline_for_org()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  perform public.fn_autoventa_sembrar_embudo_ventas(new.id);
  return new;
end
$fn$;
