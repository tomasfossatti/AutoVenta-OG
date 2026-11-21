/**
 * Capacidades do fork AutoVenta — o usado em parte de pagamento (etapa 3).
 *
 * Nenhuma das duas põe valor no usado: a tasação é de uma pessoa da equipe.
 */
import { declararTools } from "./tipos";

export const TOOLS_AUTOVENTA = declararTools([
  {
    name: "autoventa_ver_tasacion",
    category: "read",
    rotulo: "Consultar a tasação do usado",
    explicacao:
      "Mostra se a equipe já tasou o usado que o cliente entrega em parte de pagamento, e o valor só quando a oferta está vigente — para o assistente nunca estimar quanto vale o carro.",
    oQueToca: "Tasação do usado",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "autoventa_pedir_tasacion",
    category: "write",
    rotulo: "Pedir a tasação do usado",
    explicacao:
      "Avisa a equipe que um cliente quer entregar o carro em parte de pagamento, com o resumo do que ele contou. Não põe valor: quem tasa é uma pessoa.",
    oQueToca: "Tasação do usado",
    risco: "atencao",
    pacotes: ["vender"],
  },
]);
