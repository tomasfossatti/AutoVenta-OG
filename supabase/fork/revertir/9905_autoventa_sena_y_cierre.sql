-- Reverte a migration 9905 (fork AutoVenta): apaga as señas e a papelada das
-- operações. As unidades do estoque ficam no estado em que estão (`senado`,
-- `vendido`): devolver cada uma a `disponible` é decisão de quem opera, pela
-- tela do catálogo. Os comprovantes seguem em `crm_lead_attachments`
-- (campo `sena_comprobante`).
--
-- Aplicar à mão: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fork/revertir/9905_autoventa_sena_y_cierre.sql
-- ⚠️ Tire também o apêndice 9905 do baseline do fork, senão o próximo
-- `update.sh` recria as tabelas (vazias).

drop trigger if exists trg_autoventa_ficha_respeitar_sena on public.catalog_vehicle_details;
drop table if exists public.autoventa_cierres;
drop table if exists public.autoventa_senas;
drop function if exists public.fn_autoventa_cierre_aplicar_sena();
drop function if exists public.fn_autoventa_cierre_conferir();
drop function if exists public.fn_autoventa_ficha_respeitar_sena();
drop function if exists public.fn_autoventa_sena_mover_unidad();
drop function if exists public.fn_autoventa_sena_conferir();

notify pgrst, 'reload schema';
