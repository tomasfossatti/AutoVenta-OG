import { describe, expect, it, vi } from "vitest";

import { crmSearchProducts } from "@/lib/mcp/tools/comercio";
import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/instalacao/modulos", async (orig) => ({
  ...(await orig<typeof import("@/lib/instalacao/modulos")>()),
  moduloLigadoComMemo: vi.fn(async () => false),
}));

/**
 * FORK AUTOVENTA: O AGENTE SÓ OFERECE A UNIDADE QUE ESTÁ DISPONÍVEL.
 *
 * A ficha do veículo (`catalog_vehicle_details`, migration 9902) tem o estado da
 * unidade, e é ele, não a contagem de estoque, que decide se a busca do agente a
 * devolve como disponível. Reservada, señada ou vendida não é oferecida, e a
 * mensagem manda passar a conversa a um vendedor em vez de "avisar quando
 * chegar", que é o texto de loja.
 */
const HILUX = {
  id: "p-hilux",
  codigo: "HILUX-21",
  nome: "Toyota Hilux SRV 2021",
  descricao: null,
  marca: "Toyota",
  categoria: null,
  capacidade: null,
  preco_cents: 3_850_000_000,
  moeda: "ARS",
  controla_estoque: false,
  quantidade: 0,
  ativo: true,
  fotos: [],
};
const AMAROK = { ...HILUX, id: "p-amarok", codigo: "AMAROK-20", nome: "Volkswagen Amarok Highline 2020", marca: "Volkswagen", preco_cents: 2_850_000, moeda: "USD" };
const CRONOS = { ...HILUX, id: "p-cronos", codigo: "CRONOS-24", nome: "Fiat Cronos Drive 2024", marca: "Fiat", preco_cents: 2_100_000_000 };

const FICHAS = [
  { product_id: "p-hilux", condicion: "usado", modelo: "Hilux", version: "SRV", anio: 2021, kilometros: 85000, combustible: "diesel", transmision: "automatica", color: "Blanco", estado: "disponible" },
  { product_id: "p-amarok", condicion: "usado", modelo: "Amarok", version: "Highline", anio: 2020, kilometros: 60000, combustible: "diesel", transmision: "automatica", color: "Gris", estado: "disponible" },
  { product_id: "p-cronos", condicion: "0km", modelo: "Cronos", version: "Drive", anio: 2024, kilometros: 0, combustible: "nafta", transmision: "manual", color: "Rojo", estado: "reservado" },
];

function ctx(fichas: unknown[] | null, erroDasFichas: { message: string } | null = null): McpContext {
  const produtos = [HILUX, AMAROK, CRONOS];
  const supabase = {
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        range: async () => ({ data: produtos, error: null, count: produtos.length }),
        in: async () =>
          tabela === "catalog_vehicle_details" ? { data: fichas, error: erroDasFichas } : { data: [], error: null },
      };
      return q;
    },
  };
  return {
    organizationId: "22222222-2222-4222-8222-222222222222",
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
    supabase,
  } as unknown as McpContext;
}

type Resultado = {
  produtos: Array<{ codigo: string; preco: string; disponivel: boolean; vehiculo?: Record<string, unknown> }>;
  motivo?: string;
  mensagem?: string;
};
const semNbsp = (s: string) => s.replace(/[  ]/g, " ");

describe("busca do catálogo com ficha de veículo", () => {
  it("unidade disponível sai com a ficha e o preço em pesos", async () => {
    const r = (await crmSearchProducts.handler({ termo: "hilux", limite: 5 } as never, ctx(FICHAS))) as Resultado;
    expect(r.produtos.map((p) => p.codigo)).toEqual(["HILUX-21"]);
    expect(r.produtos[0]!.disponivel).toBe(true);
    expect(semNbsp(r.produtos[0]!.preco)).toBe("$ 38.500.000,00");
    expect(r.produtos[0]!.vehiculo).toMatchObject({ condicion: "usado", anio: 2021, kilometros: 85000, estado: "disponible" });
  });

  it("unidade em dólares sai com US$, para não ser lida como pesos", async () => {
    const r = (await crmSearchProducts.handler({ termo: "amarok", limite: 5 } as never, ctx(FICHAS))) as Resultado;
    expect(semNbsp(r.produtos[0]!.preco)).toBe("US$ 28.500,00");
  });

  it("unidade reservada não é oferecida, e a mensagem manda passar a um vendedor", async () => {
    const r = (await crmSearchProducts.handler({ termo: "cronos", limite: 5, somente_disponiveis: true } as never, ctx(FICHAS))) as Resultado;
    expect(r.produtos).toEqual([]);
    expect(r.motivo).toBe("sem_estoque");
    expect(r.mensagem).toContain("não está disponível (reservado)");
    expect(r.mensagem).toContain("passe a conversa a um vendedor");
    expect(r.mensagem).not.toContain("avisar quando chegar");
  });

  it("pedindo também as indisponíveis, a reservada vem marcada como não disponível", async () => {
    const r = (await crmSearchProducts.handler(
      { termo: "cronos", limite: 5, somente_disponiveis: false } as never,
      ctx(FICHAS),
    )) as Resultado;
    expect(r.produtos[0]).toMatchObject({ codigo: "CRONOS-24", disponivel: false, vehiculo: { estado: "reservado" } });
  });

  it("falha ao ler as fichas derruba a busca em vez de oferecer uma unidade vendida", async () => {
    await expect(
      crmSearchProducts.handler({ termo: "cronos", limite: 5 } as never, ctx(null, { message: "timeout" })),
    ).rejects.toThrow(/ler_fichas_falhou/);
  });
});
