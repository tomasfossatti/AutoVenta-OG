/**
 * O RÓTULO DE UM HORÁRIO, NO IDIOMA DE QUEM O VAI LER.
 *
 * `rotuloLocal` alimenta o campo `quando` das ferramentas de agenda — o texto que
 * o modelo repete ao cliente. Em português ele dizia "terça-feira 01/12 às 09:00"
 * até para uma organização argentina, e o cliente via "terça-feira" no WhatsApp.
 *
 * O que estes casos seguram: o padrão NÃO mudou (quem não passa idioma recebe o
 * mesmo texto de sempre) e `es` fala espanhol, com o artigo certo.
 */
import { describe, expect, it } from "vitest";

import { rotuloLocal } from "./agora";

const FUSO = "America/Argentina/Buenos_Aires"; // UTC-3, sem horário de verão
const terca0900 = new Date("2026-12-01T12:00:00.000Z"); // terça, 09:00 locais

describe("rotuloLocal — idioma", () => {
  it("sem idioma, o texto é o de sempre (português)", () => {
    expect(rotuloLocal(terca0900, FUSO)).toBe("terça-feira 01/12 às 09:00");
  });

  it("pt-BR explícito é igual ao padrão", () => {
    expect(rotuloLocal(terca0900, FUSO, "pt-BR")).toBe(rotuloLocal(terca0900, FUSO));
  });

  it("es fala espanhol: dia da semana e conector", () => {
    expect(rotuloLocal(terca0900, FUSO, "es")).toBe("martes 01/12 a las 09:00");
  });

  it("es cobre a semana inteira com os nomes argentinos", () => {
    const semana = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    const nomes = semana.map((_, i) => {
      // 2026-11-30 é segunda; 12:00Z = 09:00 locais.
      const d = new Date(Date.UTC(2026, 10, 30 + i, 12, 0));
      return rotuloLocal(d, FUSO, "es").split(" ")[0];
    });
    expect(nomes).toEqual(semana);
  });

  it("só a 01:00 é singular: 'a la 01:00'; 13:00 e as demais são 'a las'", () => {
    const umaDaManha = new Date("2026-12-01T04:00:00.000Z"); // 01:00 locais
    const umaDaTarde = new Date("2026-12-01T16:00:00.000Z"); // 13:00 locais
    expect(rotuloLocal(umaDaManha, FUSO, "es")).toBe("martes 01/12 a la 01:00");
    expect(rotuloLocal(umaDaTarde, FUSO, "es")).toBe("martes 01/12 a las 13:00");
  });

  it("a hora local vem do fuso, não do relógio do processo", () => {
    // Mesmo instante, fuso diferente: 12:00Z são 21:00 em Tóquio (terça).
    expect(rotuloLocal(terca0900, "Asia/Tokyo", "es")).toBe("martes 01/12 a las 21:00");
  });

  it("um idioma que ainda não foi traduzido segue em português, sem lançar", () => {
    expect(rotuloLocal(terca0900, FUSO, "en")).toBe("terça-feira 01/12 às 09:00");
  });

  it("fuso inválido cai no padrão e não lança (o turno do agente não pode morrer por isso)", () => {
    expect(() => rotuloLocal(terca0900, "Nao/Existe", "es")).not.toThrow();
  });
});
