-- Reverte a migration 9903 (fork AutoVenta): a organização argentina volta a BRL.
-- Não dá para saber quem estava em BRL antes da 9903 e quem escolheu ARS depois
-- pela tela, então a reversão usa a mesma régua estreita (fuso da Argentina) e
-- deve ser conferida organização por organização.
--
-- Aplicar à mão: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fork/revertir/9903_autoventa_moneda_argentina.sql

update public.organizations
   set currency = 'BRL'
 where currency = 'ARS'
   and timezone like 'America/Argentina/%';
