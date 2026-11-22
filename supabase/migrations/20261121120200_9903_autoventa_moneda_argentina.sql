-- manifest: Fork AutoVenta — a organização argentina que nasceu em BRL (o default da coluna, antes de o fork servir ARS) passa a ARS; só toca organização com fuso da Argentina e moeda ainda BRL, e não mexe em produto nem negócio já gravados.
--
-- 9903 — a moeda da organização argentina.
--
-- Até a etapa 2 do fork, `ARS` não estava entre as moedas servidas e a
-- organização criada pelo instalador nascia com o default da coluna, `BRL`.
-- A régua aqui é estreita de propósito: fuso `America/Argentina/*` E moeda
-- ainda `BRL`. Quem escolheu outra moeda pela tela fica como está, e os
-- produtos e negócios já gravados mantêm a moeda com que nasceram.
--
-- Reverter: `supabase/fork/revertir/9903_autoventa_moneda_argentina.sql`.

update public.organizations
   set currency = 'ARS'
 where currency = 'BRL'
   and timezone like 'America/Argentina/%';
