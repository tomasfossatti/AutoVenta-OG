/**
 * O `quando` QUE O AGENTE LÊ FALA O IDIOMA DA ORGANIZAÇÃO.
 *
 * Medido numa simulação com a agenda real: a ferramenta devolvia
 * `quando: "terça-feira 01/12 às 09:00"` para uma organização argentina, e o
 * modelo, que copia esse campo ao cliente, ficava um passo de escrever
 * "terça-feira" no WhatsApp. O idioma vem de `organizations.locale`; ausente ou
 * ilegível, cai em português — o texto que o campo sempre teve.
 */
import { describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ marcar: vi.fn() }));

vi.mock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
  marcarAgendamentoHandler: deps.marcar,
  horariosLivresHandler: vi.fn(),
  alterarAgendamentoHandler: vi.fn(),
  cancelarAgendamentoHandler: vi.fn(),
}));

import { crmBookAppointment } from "./agendamento";

function ctxComLocale(locale: unknown) {
  return {
    supabase: {
      from: (tabela: string) =>
        tabela === "organizations"
          ? {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { locale }, error: null }) }),
              }),
            }
          : {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "tipo-1" }, error: null }),
                  }),
                }),
              }),
            },
    },
    organizationId: "11111111-1111-4111-8111-111111111111",
    actor: { type: "ai_agent", id: "a" },
    requestId: "r",
  } as never;
}

const ENTRADA = {
  event_type_slug: "lavado-simple",
  starts_at: "2026-12-01T12:00:00.000Z",
  contact_id: "22222222-2222-4222-8222-222222222222",
} as never;

function marcado() {
  deps.marcar.mockResolvedValue({
    id: "c1",
    starts_at: "2026-12-01T12:00:00.000Z",
    ends_at: "2026-12-01T12:40:00.000Z",
    time_zone: "America/Argentina/Buenos_Aires",
    status: "confirmed",
    revision: 1,
    meeting_state: "not_requested",
  });
}

async function quando(locale: unknown) {
  marcado();
  const r = (await crmBookAppointment.handler(ENTRADA, ctxComLocale(locale))) as {
    compromisso: { quando: string; fim_quando: string };
  };
  return r.compromisso;
}

describe("crm_book_appointment — idioma do rótulo", () => {
  it("organização em espanhol: o agente recebe o horário em espanhol", async () => {
    const c = await quando("es");
    expect(c.quando).toBe("martes 01/12 a las 09:00");
    expect(c.fim_quando).toBe("martes 01/12 a las 09:40");
  });

  it("organização em português: o texto de sempre", async () => {
    expect((await quando("pt-BR")).quando).toBe("terça-feira 01/12 às 09:00");
  });

  it("idioma ausente ou ilegível não derruba a marcação — cai em português", async () => {
    expect((await quando(null)).quando).toBe("terça-feira 01/12 às 09:00");
    expect((await quando(42)).quando).toBe("terça-feira 01/12 às 09:00");
  });
});
