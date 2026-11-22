-- Reverte a migration 9902 (fork AutoVenta): apaga as fichas de veículo.
-- Os produtos do catálogo ficam, com preço, moeda e marca; somem condição,
-- modelo, versão, ano, km, combustível, câmbio, cor e estado.
--
-- Aplicar à mão: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fork/revertir/9902_autoventa_ficha_del_vehiculo.sql
-- ⚠️ Tire também o apêndice 9902 do baseline do fork, senão o próximo
-- `update.sh` recria a tabela (vazia).

drop table if exists public.catalog_vehicle_details;
drop function if exists public.fn_autoventa_ficha_conferir_organizacao();

notify pgrst, 'reload schema';
