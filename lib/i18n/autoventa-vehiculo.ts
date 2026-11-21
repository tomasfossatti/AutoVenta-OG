/**
 * Os textos da ficha do veículo — fork AutoVenta, etapa 2.
 *
 * A chave é o português, como no resto do dicionário; o espanhol já é o
 * rioplatense, com voseo, porque estas frases só existem no fork.
 */
export const TEXTOS_AUTOVENTA_VEHICULO = {
  "0 km": { es: "0 km" },
  "Usado": { es: "Usado" },
  "Gasolina": { es: "Nafta" },
  "Diesel": { es: "Diésel" },
  "GNV": { es: "GNC" },
  "Híbrido": { es: "Híbrido" },
  "Elétrico": { es: "Eléctrico" },
  "Câmbio manual": { es: "Manual" },
  "Câmbio automático": { es: "Automática" },
  "Reservado": { es: "Reservado" },
  "Com sinal": { es: "Señado" },
  "Vendido": { es: "Vendido" },
  "Pesos (ARS)": { es: "Pesos (ARS)" },
  "Dólares (USD)": { es: "Dólares (USD)" },
  "Ficha do veículo": { es: "Ficha del vehículo" },
  "Moeda do preço": { es: "Moneda del precio" },
  "Ano": { es: "Año" },
  "Quilometragem": { es: "Kilometraje" },
  "Combustível": { es: "Combustible" },
  "Câmbio": { es: "Transmisión" },
  "Sem informar": { es: "Sin informar" },
  "Ano inválido.": { es: "El año no es válido." },
  "Quilometragem inválida.": { es: "El kilometraje no es válido." },
  "O atendente de IA só oferece como disponível a unidade em Disponível. Reservada, com sinal ou vendida, ele avisa que não está disponível e passa a conversa a um vendedor.": {
    es: "El asistente de IA solo ofrece como disponible la unidad en Disponible. Si está reservada, señada o vendida, avisa que no está disponible y le pasa la conversación a un vendedor.",
  },
  "O produto foi salvo, mas a ficha do veículo não. Edite o produto para tentar de novo.": {
    es: "La unidad se guardó, pero la ficha del vehículo no. Editala para intentarlo de nuevo.",
  },
  'moeda não reconhecida ("{valor}") — use ARS ou USD': {
    es: 'moneda no reconocida ("{valor}"): usá ARS o USD',
  },
  '{campo} não reconhecido ("{valor}")': { es: '{campo} no reconocido ("{valor}")' },
} as const;
