-- manifest: Fork AutoVenta — `catalog_vehicle_details`, a ficha do veículo (condição, modelo, versão, ano, km, combustível, câmbio, cor e estado) em tabela 1:1 com `catalog_products`, que não muda; preço, moeda e marca seguem em `catalog_products`.
--
-- 9902 — a ficha do veículo.
--
-- Mesmo desenho do catálogo de serviços (migration 9432): o que é do ramo mora
-- numa tabela própria, uma linha por item, e `catalog_products` segue intacta.
-- É o que deixa as atualizações do upstream entrarem sem conflito no núcleo.
--
--   - preço (`preco_cents`), moeda (`moeda`) e marca (`marca`) continuam em
--     `catalog_products`, que é a fonte que a busca do agente já lê;
--   - `estado` é o que decide se a unidade está à venda: só `disponible` é
--     oferecida como disponível; `reservado`, `senado` e `vendido` não;
--   - sem ficha, o item segue no catálogo como produto comum.
--
-- Escrita com o mesmo papel de `catalog_products` (gerente para cima), pela
-- mesma rota da tela; leitura para a organização.
--
-- Reverter: `supabase/fork/revertir/9902_autoventa_ficha_del_vehiculo.sql`.

create table if not exists public.catalog_vehicle_details (
  product_id uuid primary key references public.catalog_products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  condicion text not null default 'usado',
  modelo text,
  version text,
  anio smallint,
  kilometros integer,
  combustible text,
  transmision text,
  color text,
  estado text not null default 'disponible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_vehicle_details_condicion_check check (condicion in ('0km', 'usado')),
  constraint catalog_vehicle_details_modelo_check check (modelo is null or char_length(modelo) <= 80),
  constraint catalog_vehicle_details_version_check check (version is null or char_length(version) <= 80),
  constraint catalog_vehicle_details_anio_check check (anio is null or anio between 1950 and 2100),
  constraint catalog_vehicle_details_kilometros_check check (kilometros is null or kilometros between 0 and 2000000),
  constraint catalog_vehicle_details_combustible_check check (
    combustible is null or combustible in ('nafta', 'diesel', 'gnc', 'hibrido', 'electrico')
  ),
  constraint catalog_vehicle_details_transmision_check check (
    transmision is null or transmision in ('manual', 'automatica')
  ),
  constraint catalog_vehicle_details_color_check check (color is null or char_length(color) <= 40),
  constraint catalog_vehicle_details_estado_check check (
    estado in ('disponible', 'reservado', 'senado', 'vendido')
  )
);

create index if not exists catalog_vehicle_details_org_idx
  on public.catalog_vehicle_details (organization_id, estado);

-- A ficha nunca aponta para produto de outra organização.
create or replace function public.fn_autoventa_ficha_conferir_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not exists (
    select 1 from public.catalog_products p
     where p.id = new.product_id and p.organization_id = new.organization_id
  ) then
    raise exception 'ficha_de_outra_organizacao' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end
$fn$;

revoke all on function public.fn_autoventa_ficha_conferir_organizacao() from public, anon, authenticated;

drop trigger if exists trg_autoventa_ficha_conferir_organizacao on public.catalog_vehicle_details;
create trigger trg_autoventa_ficha_conferir_organizacao
  before insert or update on public.catalog_vehicle_details
  for each row execute function public.fn_autoventa_ficha_conferir_organizacao();

alter table public.catalog_vehicle_details enable row level security;

drop policy if exists catalog_vehicle_details_select on public.catalog_vehicle_details;
create policy catalog_vehicle_details_select on public.catalog_vehicle_details
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

drop policy if exists catalog_vehicle_details_insert on public.catalog_vehicle_details;
create policy catalog_vehicle_details_insert on public.catalog_vehicle_details
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_vehicle_details_write on public.catalog_vehicle_details;
create policy catalog_vehicle_details_write on public.catalog_vehicle_details
  for update using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_vehicle_details_delete on public.catalog_vehicle_details;
create policy catalog_vehicle_details_delete on public.catalog_vehicle_details
  for delete using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.catalog_vehicle_details from anon;
grant select, insert, update, delete on public.catalog_vehicle_details to authenticated;
grant all on public.catalog_vehicle_details to service_role;

comment on table public.catalog_vehicle_details is
  'Fork AutoVenta: a ficha do veículo, 1:1 com catalog_products. Preço, moeda e marca ficam em catalog_products. `estado` decide se a unidade é oferecida: só `disponible` conta como disponível (migration 9902).';

notify pgrst, 'reload schema';
