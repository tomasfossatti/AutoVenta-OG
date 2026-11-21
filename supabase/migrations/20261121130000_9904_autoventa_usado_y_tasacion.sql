-- manifest: Fork AutoVenta — o usado em parte de pagamento: o embudo "Ventas" ganha os campos do usado (o que o CLIENTE conta, que o agente preenche pelo `crm_update_lead`) e nasce `autoventa_tasaciones`, a tasação que a AGÊNCIA decide (valor, moeda, quem tasou, vencimento e estado), com histórico por negócio; só gerente para cima põe valor.
--
-- 9904 — usado e tasação (etapa 3, parte 1).
--
-- DUAS FONTES, DOIS DONOS.
--
--   1. O que o cliente diz do usado dele (marca, modelo, ano, km…) é DADO DO
--      NEGÓCIO e mora nos campos do funil (`crm_pipelines.settings.fields`),
--      como qualquer campo que a organização cria pela tela. Vantagem: a ficha,
--      o card e o agente já sabem ler e escrever esses campos, e a conferência
--      de `crm_update_lead` já recusa o valor que o cliente não disse.
--      `fn_autoventa_sumar_campos_del_usado` acrescenta só as chaves que
--      faltam: quem já editou um campo do usado não perde a edição.
--
--   2. A tasação é DECISÃO DA AGÊNCIA e mora em `autoventa_tasaciones`, uma
--      linha por tasação (retasar = linha nova; a anterior vira histórico).
--      O agente de IA nunca põe valor: no máximo PEDE a tasação (`pendiente`,
--      sem valor), e só repete o valor de uma tasação `tasado` vigente.
--
-- Estados e transições (o gatilho é quem decide, não a tela):
--   pendiente → tasado                 (gerente+: valor, moeda e vencimento)
--   tasado    → aceptada | rechazada   (vendedor também: registra o que o cliente respondeu)
--   aceptada, rechazada                (finais)
-- "Vencida" não é estado: é `tasado` com `vence_en` no passado, lido na hora.
-- Valor e moeda de uma tasação feita não mudam: retasar cria outra linha.
--
-- Reverter: `supabase/fork/revertir/9904_autoventa_usado_y_tasacion.sql`.

-- ─── 1. Os campos do usado no embudo Ventas ──────────────────────────────────

create or replace function public.fn_autoventa_campos_del_usado()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select jsonb_build_array(
    jsonb_build_object('key', 'usado_entrega', 'label', '¿Entrega usado en parte de pago?', 'type', 'boolean', 'ia_pode_ler', true),
    jsonb_build_object('key', 'usado_marca', 'label', 'Marca del usado', 'type', 'text', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_modelo', 'label', 'Modelo del usado', 'type', 'text', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_version', 'label', 'Versión del usado', 'type', 'text', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_anio', 'label', 'Año del usado', 'type', 'number', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_kilometros', 'label', 'Kilómetros del usado', 'type', 'number', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_combustible', 'label', 'Combustible del usado', 'type', 'select', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true),
      'options', jsonb_build_array(
        jsonb_build_object('value', 'nafta', 'label', 'Nafta'),
        jsonb_build_object('value', 'diesel', 'label', 'Diésel', 'aliases', jsonb_build_array('gasoil', 'diesel')),
        jsonb_build_object('value', 'gnc', 'label', 'GNC'),
        jsonb_build_object('value', 'hibrido', 'label', 'Híbrido'),
        jsonb_build_object('value', 'electrico', 'label', 'Eléctrico'))),
    jsonb_build_object('key', 'usado_transmision', 'label', 'Transmisión del usado', 'type', 'select', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true),
      'options', jsonb_build_array(
        jsonb_build_object('value', 'manual', 'label', 'Manual'),
        jsonb_build_object('value', 'automatica', 'label', 'Automática', 'aliases', jsonb_build_array('automatico', 'at')))),
    jsonb_build_object('key', 'usado_color', 'label', 'Color del usado', 'type', 'text', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_duenos', 'label', 'Cantidad de dueños', 'type', 'number', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_estado', 'label', 'Estado del usado (choques, service, detalles)', 'type', 'textarea', 'ia_pode_ler', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true)),
    jsonb_build_object('key', 'usado_fotos', 'label', 'Fotos del usado', 'type', 'file', 'multiple', true,
      'mostrar_quando', jsonb_build_object('campo', 'usado_entrega', 'igual', true))
  );
$fn$;

revoke execute on function public.fn_autoventa_campos_del_usado() from public, anon;
grant execute on function public.fn_autoventa_campos_del_usado() to authenticated, service_role;

-- Acrescenta ao `settings` de um funil os campos do usado que ainda não estão
-- lá, pela chave. Não reescreve nem reordena os que já existem.
create or replace function public.fn_autoventa_sumar_campos_del_usado(p_settings jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $fn$
  with atual as (
    select coalesce(p_settings, '{}'::jsonb) as s,
           case when jsonb_typeof(p_settings -> 'fields') = 'array' then p_settings -> 'fields' else '[]'::jsonb end as campos
  ),
  faltam as (
    select coalesce(jsonb_agg(novo order by ord), '[]'::jsonb) as lista
      from atual,
           jsonb_array_elements(public.fn_autoventa_campos_del_usado()) with ordinality as n(novo, ord)
     where not exists (
       select 1 from jsonb_array_elements(atual.campos) as c(campo)
        where c.campo ->> 'key' = novo ->> 'key'
     )
  )
  select atual.s || jsonb_build_object('fields', atual.campos || faltam.lista)
    from atual, faltam;
$fn$;

revoke execute on function public.fn_autoventa_sumar_campos_del_usado(jsonb) from public, anon;
grant execute on function public.fn_autoventa_sumar_campos_del_usado(jsonb) to authenticated, service_role;

-- O semeador do embudo (9901) passa a semear os campos do usado. Mesmo corpo,
-- mais a última atualização: funil que já existe recebe só o que falta.
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

  if v_pipeline_id is null then
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
  end if;

  update public.crm_pipelines
     set settings = public.fn_autoventa_sumar_campos_del_usado(settings)
   where id = v_pipeline_id
     and settings is distinct from public.fn_autoventa_sumar_campos_del_usado(settings);

  return v_pipeline_id;
end
$fn$;

revoke execute on function public.fn_autoventa_sembrar_embudo_ventas(uuid) from public, anon;
grant execute on function public.fn_autoventa_sembrar_embudo_ventas(uuid) to authenticated, service_role;

-- Funis "Ventas" que já existem recebem os campos que faltam.
update public.crm_pipelines
   set settings = public.fn_autoventa_sumar_campos_del_usado(settings)
 where slug = 'ventas'
   and settings is distinct from public.fn_autoventa_sumar_campos_del_usado(settings);

-- ─── 2. A tasação ────────────────────────────────────────────────────────────

create table if not exists public.autoventa_tasaciones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  estado text not null default 'pendiente',
  valor_cents bigint,
  moneda text,
  vence_en date,
  notas text,
  origen text not null default 'persona',
  creada_por uuid references auth.users(id) on delete set null,
  tasada_por uuid references auth.users(id) on delete set null,
  tasada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autoventa_tasaciones_estado_check check (estado in ('pendiente', 'tasado', 'aceptada', 'rechazada')),
  constraint autoventa_tasaciones_moneda_check check (moneda is null or moneda in ('ARS', 'USD')),
  constraint autoventa_tasaciones_valor_check check (valor_cents is null or valor_cents > 0),
  constraint autoventa_tasaciones_notas_check check (notas is null or char_length(notas) <= 1000),
  constraint autoventa_tasaciones_origen_check check (origen in ('persona', 'agente')),
  -- Pendente não tem valor; feita tem valor, moeda e vencimento.
  constraint autoventa_tasaciones_valor_do_estado_check check (
    (estado = 'pendiente' and valor_cents is null and moneda is null and vence_en is null)
    or (estado <> 'pendiente' and valor_cents is not null and moneda is not null and vence_en is not null)
  )
);

create index if not exists autoventa_tasaciones_lead_idx
  on public.autoventa_tasaciones (organization_id, lead_id, created_at desc);

-- Um pedido aberto por negócio: o agente pedir duas vezes não empilha pendências.
create unique index if not exists autoventa_tasaciones_una_pendiente_idx
  on public.autoventa_tasaciones (lead_id) where estado = 'pendiente';

create or replace function public.fn_autoventa_tasacion_conferir()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_gerente boolean;
begin
  if not exists (
    select 1 from public.crm_leads l
     where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'tasacion_de_outra_organizacao' using errcode = '23514';
  end if;

  -- Sem usuário no JWT é o servidor (rota e agente com service role), que já
  -- decidiu o papel antes de escrever.
  v_gerente := v_uid is null
    or public.fn_is_platform_admin_full()
    or public.fn_role_at_least(new.organization_id, 'manager');

  if tg_op = 'INSERT' then
    new.creada_por := coalesce(new.creada_por, v_uid);
    if new.estado <> 'pendiente' then
      if not v_gerente then
        raise exception 'tasar_exige_gerente' using errcode = '42501';
      end if;
      new.tasada_en := coalesce(new.tasada_en, now());
      new.tasada_por := coalesce(new.tasada_por, v_uid);
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.lead_id is distinct from old.lead_id
     or new.origen is distinct from old.origen
     or new.creada_por is distinct from old.creada_por
     or new.created_at is distinct from old.created_at then
    raise exception 'tasacion_campo_imutavel' using errcode = '23514';
  end if;

  if not (
    new.estado = old.estado
    or (old.estado = 'pendiente' and new.estado = 'tasado')
    or (old.estado = 'tasado' and new.estado in ('aceptada', 'rechazada'))
  ) then
    raise exception 'tasacion_transicao_invalida: % -> %', old.estado, new.estado using errcode = '23514';
  end if;

  if old.estado <> 'pendiente'
     and (new.valor_cents is distinct from old.valor_cents or new.moneda is distinct from old.moneda) then
    raise exception 'retasar_e_uma_tasacion_nova' using errcode = '23514';
  end if;

  if not v_gerente then
    -- O vendedor só registra a resposta do cliente a uma tasação feita.
    if not (
      old.estado = 'tasado' and new.estado in ('aceptada', 'rechazada')
      and new.vence_en is not distinct from old.vence_en
      and new.notas is not distinct from old.notas
      and new.tasada_por is not distinct from old.tasada_por
      and new.tasada_en is not distinct from old.tasada_en
    ) then
      raise exception 'tasar_exige_gerente' using errcode = '42501';
    end if;
  end if;

  if old.estado = 'pendiente' and new.estado = 'tasado' then
    new.tasada_en := now();
    new.tasada_por := coalesce(v_uid, new.tasada_por);
  end if;

  new.updated_at := now();
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_tasacion_conferir() from public, anon, authenticated;

drop trigger if exists trg_autoventa_tasacion_conferir on public.autoventa_tasaciones;
create trigger trg_autoventa_tasacion_conferir
  before insert or update on public.autoventa_tasaciones
  for each row execute function public.fn_autoventa_tasacion_conferir();

alter table public.autoventa_tasaciones enable row level security;

drop policy if exists autoventa_tasaciones_select on public.autoventa_tasaciones;
create policy autoventa_tasaciones_select on public.autoventa_tasaciones
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

-- Vendedor PEDE (pendiente, sem valor); gerente pede ou já cadastra feita.
drop policy if exists autoventa_tasaciones_insert on public.autoventa_tasaciones;
create policy autoventa_tasaciones_insert on public.autoventa_tasaciones
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (public.fn_role_at_least(organization_id, 'manager')
             or (public.fn_role_at_least(organization_id, 'agent')
                 and estado = 'pendiente' and valor_cents is null)))
  );

-- Vendedor alcança a linha; o gatilho limita o que ele muda.
drop policy if exists autoventa_tasaciones_write on public.autoventa_tasaciones;
create policy autoventa_tasaciones_write on public.autoventa_tasaciones
  for update using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists autoventa_tasaciones_delete on public.autoventa_tasaciones;
create policy autoventa_tasaciones_delete on public.autoventa_tasaciones
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.autoventa_tasaciones from anon;
grant select, insert, update, delete on public.autoventa_tasaciones to authenticated;
grant all on public.autoventa_tasaciones to service_role;

-- As travas do modo somente leitura do suporte, depois da tabela (mesmo molde
-- da 9902).
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

comment on table public.autoventa_tasaciones is
  'Fork AutoVenta: a tasação do usado em parte de pagamento, uma linha por tasação (retasar = linha nova). Só gerente+ põe valor; vendedor pede e registra a resposta do cliente; o agente de IA só pede. "Vencida" = tasado com vence_en no passado (migration 9904).';

notify pgrst, 'reload schema';
