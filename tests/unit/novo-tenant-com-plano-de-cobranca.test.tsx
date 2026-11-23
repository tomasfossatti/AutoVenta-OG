/**
 * /admin/tenants/new en AutoVenta: el alta de un cliente pide SOLO el nombre de
 * la agencia y el correo del responsable. Slug (sale del nombre), razón social,
 * CNPJ, plan e interfaz no se muestran. Sin selector, con cobranza desligada va
 * el rótulo "standard"; ligada, la empresa nace isenta (sin plano_id) y el
 * rótulo antiguo no va. La interfaz del dueño es siempre la completa.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ criar: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCreateTenant", () => ({ useCreateTenant: () => ({ mutateAsync: h.criar }) }));

import { NewTenantForm } from "@/app/admin/(protected)/tenants/new/_form";

const PLANO = { id: "cccccccc-0000-4000-8000-000000000001", nome: "Básico", preco_cents: 4990, moeda: "BRL", intervalo: "mes", trial_dias: 14 };

beforeEach(() => {
  vi.clearAllMocks();
  h.criar.mockResolvedValue({ data: { id: "o1", slug: "loja-teste", display_name: "Loja Teste", owner_invitation: null } });
});

async function preencherEEnviar(): Promise<Record<string, unknown>> {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText(/Nome da agência/), "Loja Teste");
  await u.type(screen.getByLabelText(/E-mail do responsável/), "dono@loja.test");
  await u.click(screen.getByRole("button", { name: "Criar organização" }));
  await waitFor(() => expect(h.criar).toHaveBeenCalledTimes(1));
  return h.criar.mock.calls[0]![0] as Record<string, unknown>;
}

describe("/admin/tenants/new — solo nombre y correo", () => {
  it("no muestra slug, razón social, CNPJ, plan ni interfaz", () => {
    render(<NewTenantForm cobranca={{ ligada: true, planos: [PLANO] }} />);
    expect(screen.getAllByRole("textbox").map((e) => e.id).sort()).toEqual(["display_name", "owner_email"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Interface|Interfaz/)).toBeNull();
  });

  it("cobrança desligada: vai o rótulo standard e o slug sai do nome", async () => {
    render(<NewTenantForm cobranca={{ ligada: false, planos: [] }} />);
    const enviado = await preencherEEnviar();
    expect(enviado.plan).toBe("standard");
    expect(enviado.slug).toBe("loja-teste");
    expect(enviado).not.toHaveProperty("plano_id");
    expect(enviado).not.toHaveProperty("legal_name");
    expect(enviado).not.toHaveProperty("cnpj");
    expect(enviado.owner_interface_settings).toEqual({ preset: "completa" });
  });

  it("cobrança ligada: a empresa nasce isenta e o rótulo antigo não vai", async () => {
    render(<NewTenantForm cobranca={{ ligada: true, planos: [PLANO] }} />);
    const enviado = await preencherEEnviar();
    expect(enviado).not.toHaveProperty("plan");
    expect(enviado.plano_id).toBeUndefined();
  });
});
