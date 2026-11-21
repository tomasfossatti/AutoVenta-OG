/**
 * Fork AutoVenta: o funil "Pedidos" que o UPSTREAM semeia em toda organização
 * nova, montado à mão.
 *
 * A migration 9901 do fork troca o que `trg_seed_default_pipeline_for_org`
 * semeia (agora é o "Ventas" de concessionária). Os invariantes do upstream que
 * medem o que acontece com o funil "Pedidos" (o pulo do passo do funil, o quadro
 * do onboarding) continuam valendo para as organizações criadas antes da 9901,
 * que seguem com ele, então eles passam a partir deste funil montado aqui, com
 * as mesmas 8 etapas e os mesmos slugs do gatilho original
 * (`supabase/fork/revertir/9901_autoventa_embudo_ventas.sql`).
 */
export function sqlDoFunilDoUpstream(orgExpr: string): string {
  return `
    delete from public.crm_stages where organization_id = (${orgExpr});
    delete from public.crm_pipelines where organization_id = (${orgExpr});
    with p as (
      insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
      values ((${orgExpr}), 'Pedidos', 'pedidos', true, 1000)
      returning id, organization_id
    )
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
    select p.organization_id, p.id, t.nome, t.slug, t.pos, t.won, t.lost
      from p, (values
        ('Carrinho abandonado',  'carrinho_abandonado',  1000, false, false),
        ('Aguardando pagamento', 'aguardando_pagamento', 2000, false, false),
        ('Pago',                 'pago',                 3000, true,  false),
        ('Em separação',         'em_separacao',         4000, false, false),
        ('Enviado',              'enviado',              5000, false, false),
        ('Entregue',             'entregue',             6000, false, false),
        ('Pós-venda',            'pos_venda',            7000, false, false),
        ('Cancelado',            'cancelado',            8000, false, true)
      ) as t(nome, slug, pos, won, lost);
  `;
}
