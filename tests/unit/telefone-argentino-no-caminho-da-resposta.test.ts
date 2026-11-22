import { describe, expect, it, vi } from "vitest";

import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
import { telefoneDoChatDaMensagem } from "@/lib/channels/telefone-da-mensagem";
import type { WahaClient } from "@/lib/waha/client";
import { resolveCanonicalCusChatId } from "@/lib/waha/resolve-contact-whatsapp-id";

/**
 * FORK AUTOVENTA: O CELULAR ARGENTINO VOLTA PELO MESMO NÚMERO QUE ESCREVEU.
 *
 * Na Argentina o celular no WhatsApp leva o 9 depois do 54 (`549` + código de
 * área + número; em Neuquén, `5492994123456`). As regras de telefone do produto
 * são do Brasil (nono dígito, `+55`), e a pergunta da etapa 2 do fork era se
 * alguma delas muda esse número no caminho mensagem recebida → resposta do agente.
 *
 * Medido no código: não muda. A ficha guarda o número como chegou (WAHA e Meta
 * passam por `canonicalPhoneBR`, que só mexe em `+55`), e o envio pelo WAHA só
 * pergunta ao `check-exists` quando há duas grafias, o que só acontece no Brasil.
 * Este teste fixa isso para que uma regra nova de telefone não quebre o fork sem
 * ninguém perceber.
 *
 * Fora do caminho da resposta, `normalizePhoneBR` (formulários e importações de
 * contato) ainda supõe o Brasil; isso fica para a etapa que tratar cadastro de
 * contatos.
 */
const CELULAR_NEUQUEN = "+5492994123456";

describe("celular argentino no caminho da resposta", () => {
  it("as regras de telefone não inventam nem tiram dígito", () => {
    expect(phoneLookupVariants(CELULAR_NEUQUEN)).toEqual([CELULAR_NEUQUEN]);
    expect(canonicalPhoneBR(CELULAR_NEUQUEN)).toBe(CELULAR_NEUQUEN);
  });

  it("o telefone lido da mensagem recebida pelo WAHA é o mesmo do chat", () => {
    expect(telefoneDoChatDaMensagem("false_5492994123456@c.us_3EB0ABC")).toBe(CELULAR_NEUQUEN);
  });

  it("o envio pelo WAHA volta ao mesmo chat, sem consultar outra grafia", async () => {
    const checkContactExists = vi.fn();
    const client = { checkContactExists } as unknown as WahaClient;
    await expect(resolveCanonicalCusChatId(client, "sessao", "5492994123456@c.us")).resolves.toBe(
      "5492994123456@c.us",
    );
    expect(checkContactExists).not.toHaveBeenCalled();
  });
});
