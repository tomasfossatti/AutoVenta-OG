/**
 * Os textos do usado e da tasação — fork AutoVenta, etapa 3.
 *
 * A chave é o português, como no resto do dicionário; o espanhol já é o
 * rioplatense, com voseo, porque estas frases só existem no fork.
 */
export const TEXTOS_AUTOVENTA_TASACION = {
  "Usado e tasação": { es: "Usado y tasación" },
  "Vigente": { es: "Vigente" },
  "Aceita pelo cliente": { es: "Aceptada por el cliente" },
  "Recusada pelo cliente": { es: "Rechazada por el cliente" },
  "Não foi possível carregar a tasação.": { es: "No se pudo cargar la tasación." },
  "Não foi possível salvar a tasação. Tente de novo.": { es: "No se pudo guardar la tasación. Probá de nuevo." },
  "Ninguém tasou o usado ainda. O atendente de IA nunca diz um valor ao cliente sem uma tasação vigente.": {
    es: "Todavía nadie tasó el usado. El asistente de IA nunca le dice un valor al cliente sin una tasación vigente.",
  },
  "Fazer tasação": { es: "Cargar tasación" },
  "Retasar": { es: "Retasar" },
  "Pedir tasação": { es: "Pedir tasación" },
  "Pedir nova tasação": { es: "Pedir nueva tasación" },
  "Cliente aceitou": { es: "El cliente aceptó" },
  "Cliente recusou": { es: "El cliente rechazó" },
  "Tasações anteriores": { es: "Tasaciones anteriores" },
  "Vale até": { es: "Vale hasta" },
  "Pedida em": { es: "Pedida el" },
  "Tasada em": { es: "Tasada el" },
  "Pedida pelo atendente de IA": { es: "Pedida por el asistente de IA" },
  "Valor oferecido": { es: "Valor ofrecido" },
  "Informe o valor da tasação.": { es: "Poné el valor de la tasación." },
  "O vencimento não pode ser no passado.": { es: "El vencimiento no puede ser una fecha pasada." },
  "O atendente de IA pode informar este valor ao cliente até o vencimento, sempre sujeito a ver o carro.": {
    es: "El asistente de IA puede informarle este valor al cliente hasta el vencimiento, siempre sujeto a ver el auto.",
  },
  "Salvar tasação": { es: "Guardar tasación" },
  "Este negócio já tem uma tasação vigente.": { es: "Esta operación ya tiene una tasación vigente." },
  "Tasação não encontrada.": { es: "No se encontró la tasación." },
  "Só gerente ou administrador pode tasar ou mudar a tasação.": {
    es: "Solo un gerente o administrador puede tasar o cambiar la tasación.",
  },
  "O valor de uma tasação feita não muda. Para outro valor, faça uma tasação nova.": {
    es: "El valor de una tasación hecha no cambia. Para otro valor, cargá una tasación nueva.",
  },
  "Essa tasação já foi respondida e não pode mudar de estado.": {
    es: "Esa tasación ya tiene respuesta y no puede cambiar de estado.",
  },
  // As ferramentas do agente (lib/mcp/tools/catalogo/autoventa.ts), na tela de IA › Agentes.
  "Consultar a tasação do usado": { es: "Consultar la tasación del usado" },
  "Pedir a tasação do usado": { es: "Pedir la tasación del usado" },
  "Tasação do usado": { es: "Tasación del usado" },
  "Mostra se a equipe já tasou o usado que o cliente entrega em parte de pagamento, e o valor só quando a oferta está vigente — para o assistente nunca estimar quanto vale o carro.": {
    es: "Muestra si el equipo ya tasó el usado que el cliente entrega en parte de pago, y el valor solo cuando la oferta está vigente, para que el asistente nunca estime cuánto vale el auto.",
  },
  "Avisa a equipe que um cliente quer entregar o carro em parte de pagamento, com o resumo do que ele contou. Não põe valor: quem tasa é uma pessoa.": {
    es: "Le avisa al equipo que un cliente quiere entregar su auto en parte de pago, con el resumen de lo que contó. No pone valor: la tasación la hace una persona.",
  },
} as const;
