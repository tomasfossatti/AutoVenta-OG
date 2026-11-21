-- Reverte a migration 9904 (fork AutoVenta): apaga as tasações e tira do
-- embudo "Ventas" os campos do usado que a 9904 semeou. Os VALORES já
-- preenchidos nos negócios (`crm_leads.custom_fields.usado_*`) ficam no jsonb,
-- sem definição que os desenhe; as fotos anexadas ficam em `crm_lead_attachments`.
--
-- Aplicar à mão: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fork/revertir/9904_autoventa_usado_y_tasacion.sql
-- ⚠️ Tire também o apêndice 9904 do baseline do fork, senão o próximo
-- `update.sh` recria a tabela (vazia) e os campos.
-- ⚠️ Depois, reaplique a 9901 para o semeador voltar ao corpo sem campos.

drop table if exists public.autoventa_tasaciones;
drop function if exists public.fn_autoventa_tasacion_conferir();

update public.crm_pipelines p
   set settings = p.settings || jsonb_build_object('fields', coalesce((
         select jsonb_agg(c order by ord)
           from jsonb_array_elements(p.settings -> 'fields') with ordinality as x(c, ord)
          where not (c ->> 'key' like 'usado\_%')
       ), '[]'::jsonb))
 where p.slug = 'ventas' and jsonb_typeof(p.settings -> 'fields') = 'array';

drop function if exists public.fn_autoventa_sumar_campos_del_usado(jsonb);
drop function if exists public.fn_autoventa_campos_del_usado();

notify pgrst, 'reload schema';
