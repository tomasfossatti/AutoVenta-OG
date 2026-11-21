-- manifest: Fork AutoVenta — a seña e o fechamento da operação: nasce `autoventa_senas` (monto, moeda, data, comprovante e a unidade do estoque reservada; ao registrar, a unidade passa sozinha a `senado`) e `autoventa_cierres` (domínio, 08, transferência, emplacamento e entrega, 1:1 com o negócio; registrar a entrega aplica a seña e marca a unidade `vendido`). Vendedor registra; só gerente anula.
--
-- 9905 — seña e cierre (etapa 3, parte 2).
--
-- DUAS TABELAS, DOIS MOMENTOS DA OPERAÇÃO.
--
--   1. `autoventa_senas` — o dinheiro que o cliente deixou para reservar uma
--      unidade. Uma linha por seña (a anulada fica como histórico). O
--      comprovante é um anexo do negócio (`crm_lead_attachments`, campo
--      `sena_comprobante`): mesmo bucket privado, mesma rota de mídia assinada,
--      mesma varredura de órfãos e mesma anonimização do resto dos anexos.
--      `unidad_descripcion` é a FOTO do que foi señado ("Toyota Hilux SRV
--      2021"): o produto pode sair do catálogo e a seña continua dizendo o quê.
--
--   2. `autoventa_cierres` — a papelada e a entrega, uma linha por negócio.
--
-- Estados da seña (o gatilho decide, não a tela):
--   vigente → anulada   (só gerente+, com motivo; a unidade volta a `disponible`)
--   vigente → aplicada  (só pelo registro da entrega; a unidade vira `vendido`)
--   anulada, aplicada   (finais)
-- Monto, moeda, data e unidade de uma seña não mudam: errou, anula e registra outra.
--
-- A UNIDADE DO ESTOQUE (`catalog_vehicle_details.estado`, migration 9902):
--   - só se seña unidade `disponible` ou `reservado`, e uma seña vigente por
--     unidade (índice parcial);
--   - quem muda o estado é o gatilho (security definer): o vendedor registra a
--     seña mas não edita a ficha do estoque;
--   - enquanto há seña vigente, a ficha não sai de `senado` por edição à mão:
--     liberar a unidade é anular a seña.
--
-- O agente de IA não escreve em nenhuma das duas: lê pelo `autoventa_ver_cierre`,
-- que não devolve monto nem a data de entrega combinada.
--
-- Reverter: `supabase/fork/revertir/9905_autoventa_sena_y_cierre.sql`.

-- ─── 1. A seña ──────────────────────────────────────────────────────────────

create table if not exists public.autoventa_senas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  -- `set null`: o produto apagado do catálogo não leva a história junto; a
  -- descrição guardada segue dizendo qual era a unidade.
  product_id uuid references public.catalog_products(id) on delete set null,
  unidad_descripcion text not null default '',
  estado text not null default 'vigente',
  monto_cents bigint not null,
  moneda text not null,
  fecha date not null default current_date,
  comprobante_id uuid references public.crm_lead_attachments(id) on delete set null,
  notas text,
  motivo_anulacion text,
  creada_por uuid references auth.users(id) on delete set null,
  anulada_por uuid references auth.users(id) on delete set null,
  anulada_en timestamptz,
  aplicada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autoventa_senas_estado_check check (estado in ('vigente', 'anulada', 'aplicada')),
  constraint autoventa_senas_moneda_check check (moneda in ('ARS', 'USD')),
  constraint autoventa_senas_monto_check check (monto_cents > 0),
  constraint autoventa_senas_notas_check check (notas is null or char_length(notas) <= 1000),
  constraint autoventa_senas_descripcion_check check (char_length(unidad_descripcion) <= 200),
  constraint autoventa_senas_motivo_check check (motivo_anulacion is null or char_length(motivo_anulacion) <= 500),
  -- Anulada tem motivo; as outras não.
  constraint autoventa_senas_anulacion_check check (
    (estado = 'anulada' and motivo_anulacion is not null and char_length(btrim(motivo_anulacion)) > 0)
    or (estado <> 'anulada' and motivo_anulacion is null)
  )
);

create index if not exists autoventa_senas_lead_idx
  on public.autoventa_senas (organization_id, lead_id, created_at desc);

create index if not exists autoventa_senas_product_idx
  on public.autoventa_senas (product_id);

-- Uma seña vigente por unidade, e uma por operação.
create unique index if not exists autoventa_senas_una_vigente_por_unidad_idx
  on public.autoventa_senas (product_id) where estado = 'vigente';
create unique index if not exists autoventa_senas_una_vigente_por_negocio_idx
  on public.autoventa_senas (lead_id) where estado = 'vigente';

create or replace function public.fn_autoventa_sena_conferir()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_gerente boolean;
  v_estado_unidad text;
  v_descricao text;
begin
  if not exists (
    select 1 from public.crm_leads l
     where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'sena_de_outra_organizacao' using errcode = '23514';
  end if;

  if new.comprobante_id is not null and not exists (
    select 1 from public.crm_lead_attachments a
     where a.id = new.comprobante_id and a.lead_id = new.lead_id and a.organization_id = new.organization_id
  ) then
    raise exception 'comprobante_de_outro_negocio' using errcode = '23514';
  end if;

  -- Sem usuário no JWT é o servidor (rota com service role), que já decidiu o
  -- papel antes de escrever.
  v_gerente := v_uid is null
    or public.fn_is_platform_admin_full()
    or public.fn_role_at_least(new.organization_id, 'manager');

  if tg_op = 'INSERT' then
    if new.estado <> 'vigente' then
      raise exception 'sena_nasce_vigente' using errcode = '23514';
    end if;
    if new.product_id is null then
      raise exception 'sena_sem_unidade' using errcode = '23514';
    end if;
    -- `for update`: duas señas da mesma unidade ao mesmo tempo esperam uma
    -- pela outra aqui; a segunda encontra `senado` (ou bate no índice parcial).
    select d.estado,
           btrim(concat_ws(' ', nullif(btrim(coalesce(p.marca, '')), ''), coalesce(nullif(btrim(coalesce(d.modelo, '')), ''), p.nome),
                 nullif(btrim(coalesce(d.version, '')), ''), d.anio::text))
      into v_estado_unidad, v_descricao
      from public.catalog_vehicle_details d
      join public.catalog_products p on p.id = d.product_id
     where d.product_id = new.product_id and d.organization_id = new.organization_id
       for update of d;
    if not found then
      raise exception 'sena_sem_ficha_do_veiculo' using errcode = '23514';
    end if;
    if v_estado_unidad not in ('disponible', 'reservado') then
      raise exception 'unidad_no_disponible: %', v_estado_unidad using errcode = '23514';
    end if;
    new.unidad_descripcion := left(coalesce(v_descricao, ''), 200);
    new.creada_por := coalesce(new.creada_por, v_uid);
    new.anulada_por := null;
    new.anulada_en := null;
    new.aplicada_en := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.lead_id is distinct from old.lead_id
     or (new.product_id is distinct from old.product_id and new.product_id is not null)
     or new.unidad_descripcion is distinct from old.unidad_descripcion
     or new.monto_cents is distinct from old.monto_cents
     or new.moneda is distinct from old.moneda
     or new.fecha is distinct from old.fecha
     or new.creada_por is distinct from old.creada_por
     or new.created_at is distinct from old.created_at then
    raise exception 'sena_campo_imutavel' using errcode = '23514';
  end if;

  if not (
    new.estado = old.estado
    or (old.estado = 'vigente' and new.estado in ('anulada', 'aplicada'))
  ) then
    raise exception 'sena_transicao_invalida: % -> %', old.estado, new.estado using errcode = '23514';
  end if;

  if old.estado = 'vigente' and new.estado = 'anulada' then
    if not v_gerente then
      raise exception 'anular_exige_gerente' using errcode = '42501';
    end if;
    new.anulada_por := coalesce(v_uid, new.anulada_por);
    new.anulada_en := now();
  elsif old.estado = 'vigente' and new.estado = 'aplicada' then
    -- Aplicar é efeito da entrega, nunca um clique solto.
    if coalesce(current_setting('autoventa.aplicando_sena', true), '') <> 'on' then
      raise exception 'aplicar_so_pela_entrega' using errcode = '42501';
    end if;
    new.aplicada_en := now();
  else
    new.anulada_por := old.anulada_por;
    new.anulada_en := old.anulada_en;
    new.aplicada_en := old.aplicada_en;
    new.motivo_anulacion := old.motivo_anulacion;
  end if;

  -- Seña encerrada só muda nas notas.
  if old.estado <> 'vigente' and new.comprobante_id is distinct from old.comprobante_id
     and new.comprobante_id is not null then
    raise exception 'sena_encerrada' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_sena_conferir() from public, anon, authenticated;

drop trigger if exists trg_autoventa_sena_conferir on public.autoventa_senas;
create trigger trg_autoventa_sena_conferir
  before insert or update on public.autoventa_senas
  for each row execute function public.fn_autoventa_sena_conferir();

-- O efeito no estoque, DEPOIS da linha gravada. O sinal de sessão
-- `autoventa.sena_mueve_unidad` deixa a guarda da ficha (abaixo) reconhecer
-- que é a seña mudando a unidade, não uma edição à mão.
create or replace function public.fn_autoventa_sena_mover_unidad()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
  v_destino text;
  v_origem text[];
begin
  if tg_op = 'INSERT' then
    v_destino := 'senado';
    v_origem := array['disponible', 'reservado'];
  elsif tg_op = 'DELETE' then
    if old.estado <> 'vigente' then return old; end if;
    v_destino := 'disponible';
    v_origem := array['senado'];
  elsif old.estado = 'vigente' and new.estado = 'anulada' then
    v_destino := 'disponible';
    v_origem := array['senado'];
  elsif old.estado = 'vigente' and new.estado = 'aplicada' then
    v_destino := 'vendido';
    v_origem := array['senado', 'reservado', 'disponible'];
  else
    return new;
  end if;

  if v_product is not null then
    perform set_config('autoventa.sena_mueve_unidad', 'on', true);
    update public.catalog_vehicle_details
       set estado = v_destino
     where product_id = v_product
       and estado = any (v_origem);
    perform set_config('autoventa.sena_mueve_unidad', 'off', true);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_sena_mover_unidad() from public, anon, authenticated;

drop trigger if exists trg_autoventa_sena_mover_unidad on public.autoventa_senas;
create trigger trg_autoventa_sena_mover_unidad
  after insert or update or delete on public.autoventa_senas
  for each row execute function public.fn_autoventa_sena_mover_unidad();

-- A guarda da ficha: com seña vigente, a unidade não sai de `senado` pela
-- tela do catálogo. Liberar é anular a seña (que registra quem e por quê).
create or replace function public.fn_autoventa_ficha_respeitar_sena()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if old.estado = 'senado'
     and new.estado is distinct from old.estado
     and coalesce(current_setting('autoventa.sena_mueve_unidad', true), '') <> 'on'
     and exists (
       select 1 from public.autoventa_senas s
        where s.product_id = old.product_id and s.estado = 'vigente'
     ) then
    raise exception 'unidad_con_sena_vigente' using errcode = '23514';
  end if;
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_ficha_respeitar_sena() from public, anon, authenticated;

drop trigger if exists trg_autoventa_ficha_respeitar_sena on public.catalog_vehicle_details;
create trigger trg_autoventa_ficha_respeitar_sena
  before update on public.catalog_vehicle_details
  for each row execute function public.fn_autoventa_ficha_respeitar_sena();

alter table public.autoventa_senas enable row level security;

drop policy if exists autoventa_senas_select on public.autoventa_senas;
create policy autoventa_senas_select on public.autoventa_senas
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

-- Vendedor para cima registra a seña.
drop policy if exists autoventa_senas_insert on public.autoventa_senas;
create policy autoventa_senas_insert on public.autoventa_senas
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and estado = 'vigente')
  );

-- Vendedor alcança a linha (pôr o comprovante); o gatilho limita o resto.
drop policy if exists autoventa_senas_write on public.autoventa_senas;
create policy autoventa_senas_write on public.autoventa_senas
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

-- Sem DELETE para a organização: a seña é dinheiro recebido, e o caminho de
-- desfazer é anular (com motivo). Apaga só a cascata do negócio.
drop policy if exists autoventa_senas_delete on public.autoventa_senas;

revoke all on public.autoventa_senas from anon;
revoke delete on public.autoventa_senas from authenticated;
grant select, insert, update on public.autoventa_senas to authenticated;
grant all on public.autoventa_senas to service_role;

comment on table public.autoventa_senas is
  'Fork AutoVenta: a seña de uma operação, uma linha por seña (a anulada fica como histórico). Registrar põe a unidade em `senado`; anular (gerente+, com motivo) a devolve a `disponible`; a entrega a aplica e marca `vendido`. O agente de IA não escreve aqui (migration 9905).';

-- ─── 2. A papelada e a entrega ──────────────────────────────────────────────

create table if not exists public.autoventa_cierres (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dominio text,
  formulario_08 text not null default 'pendiente',
  transferencia text not null default 'pendiente',
  patentamiento text not null default 'pendiente',
  entrega_programada date,
  entregado_en date,
  notas text,
  actualizado_por uuid references auth.users(id) on delete set null,
  entrega_registrada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Patente argentina: Mercosur (AB123CD) ou a anterior (ABC123), sem espaços.
  constraint autoventa_cierres_dominio_check check (
    dominio is null or dominio ~ '^([A-Z]{2}[0-9]{3}[A-Z]{2}|[A-Z]{3}[0-9]{3})$'
  ),
  constraint autoventa_cierres_08_check check (formulario_08 in ('pendiente', 'firmado', 'certificado')),
  constraint autoventa_cierres_transferencia_check check (transferencia in ('pendiente', 'en_tramite', 'inscripta')),
  constraint autoventa_cierres_patentamiento_check check (patentamiento in ('pendiente', 'en_tramite', 'patentado')),
  constraint autoventa_cierres_notas_check check (notas is null or char_length(notas) <= 1000)
);

create index if not exists autoventa_cierres_org_idx
  on public.autoventa_cierres (organization_id);

create or replace function public.fn_autoventa_cierre_conferir()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.crm_leads l
     where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'cierre_de_outra_organizacao' using errcode = '23514';
  end if;

  new.dominio := nullif(upper(regexp_replace(coalesce(new.dominio, ''), '[\s\-\.]', '', 'g')), '');

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.lead_id is distinct from old.lead_id
       or new.created_at is distinct from old.created_at then
      raise exception 'cierre_campo_imutavel' using errcode = '23514';
    end if;
    -- A entrega registrada é fato: não muda nem some.
    if old.entregado_en is not null then
      if new.entregado_en is distinct from old.entregado_en then
        raise exception 'entrega_ya_registrada' using errcode = '23514';
      end if;
      new.entrega_registrada_por := old.entrega_registrada_por;
    end if;
  else
    new.created_at := now();
  end if;

  if new.entregado_en is not null and (tg_op = 'INSERT' or old.entregado_en is null) then
    if new.entregado_en > current_date + 1 then
      raise exception 'entrega_no_futuro' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.autoventa_senas s
       where s.lead_id = new.lead_id and s.estado = 'vigente'
    ) then
      raise exception 'entrega_sin_sena' using errcode = '23514';
    end if;
    new.entrega_registrada_por := v_uid;
  end if;

  new.actualizado_por := coalesce(v_uid, new.actualizado_por);
  new.updated_at := now();
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_cierre_conferir() from public, anon, authenticated;

drop trigger if exists trg_autoventa_cierre_conferir on public.autoventa_cierres;
create trigger trg_autoventa_cierre_conferir
  before insert or update on public.autoventa_cierres
  for each row execute function public.fn_autoventa_cierre_conferir();

-- Registrar a entrega aplica a seña vigente (e o gatilho dela marca a
-- unidade `vendido`). O sinal de sessão é o único caminho para `aplicada`.
create or replace function public.fn_autoventa_cierre_aplicar_sena()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.entregado_en is not null and (tg_op = 'INSERT' or old.entregado_en is null) then
    perform set_config('autoventa.aplicando_sena', 'on', true);
    update public.autoventa_senas
       set estado = 'aplicada'
     where lead_id = new.lead_id and organization_id = new.organization_id and estado = 'vigente';
    perform set_config('autoventa.aplicando_sena', 'off', true);
  end if;
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_cierre_aplicar_sena() from public, anon, authenticated;

drop trigger if exists trg_autoventa_cierre_aplicar_sena on public.autoventa_cierres;
create trigger trg_autoventa_cierre_aplicar_sena
  after insert or update on public.autoventa_cierres
  for each row execute function public.fn_autoventa_cierre_aplicar_sena();

alter table public.autoventa_cierres enable row level security;

drop policy if exists autoventa_cierres_select on public.autoventa_cierres;
create policy autoventa_cierres_select on public.autoventa_cierres
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists autoventa_cierres_insert on public.autoventa_cierres;
create policy autoventa_cierres_insert on public.autoventa_cierres
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

drop policy if exists autoventa_cierres_write on public.autoventa_cierres;
create policy autoventa_cierres_write on public.autoventa_cierres
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

drop policy if exists autoventa_cierres_delete on public.autoventa_cierres;
create policy autoventa_cierres_delete on public.autoventa_cierres
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.autoventa_cierres from anon;
grant select, insert, update, delete on public.autoventa_cierres to authenticated;
grant all on public.autoventa_cierres to service_role;

-- As travas do modo somente leitura do suporte, depois das tabelas (mesmo
-- molde da 9902 e da 9904).
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

comment on table public.autoventa_cierres is
  'Fork AutoVenta: a papelada e a entrega de uma operação, 1:1 com o negócio — domínio, formulário 08, transferência (usado), emplacamento (0 km), entrega combinada e entrega real. Registrar a entrega exige seña vigente e a aplica; a entrega registrada não muda (migration 9905).';

notify pgrst, 'reload schema';
