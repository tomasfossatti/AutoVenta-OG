/**
 * Os textos da seña e do fechamento — fork AutoVenta, etapa 3, parte 2.
 *
 * A chave é o português, como no resto do dicionário; o espanhol já é o
 * rioplatense, com voseo, porque estas frases só existem no fork.
 */
export const TEXTOS_AUTOVENTA_SENA = {
  "Seña e fechamento": { es: "Seña y cierre" },
  "Não foi possível carregar a seña e o fechamento.": { es: "No se pudo cargar la seña y el cierre." },
  "Sem seña registrada. Ao registrar, a unidade fica como señada no estoque e o atendente de IA deixa de oferecê-la.": {
    es: "Todavía no hay seña. Al registrarla, la unidad queda como señada en el stock y el asistente de IA deja de ofrecerla.",
  },
  "Registrar seña": { es: "Registrar seña" },
  "Seña vigente": { es: "Seña vigente" },
  "Seña anulada": { es: "Seña anulada" },
  "Seña aplicada à venda": { es: "Seña aplicada a la venta" },
  "Señas anteriores": { es: "Señas anteriores" },
  "Unidade": { es: "Unidad" },
  "Unidade removida do catálogo": { es: "Unidad borrada del catálogo" },
  "Data da seña": { es: "Fecha de la seña" },
  "Comprovante": { es: "Comprobante" },
  "Ver comprovante": { es: "Ver comprobante" },
  "Sem comprovante": { es: "Sin comprobante" },
  "Motivo da anulação": { es: "Motivo de la anulación" },
  "Trocar comprovante": { es: "Cambiar comprobante" },
  "Subir comprovante": { es: "Subir comprobante" },
  "Anular seña": { es: "Anular seña" },
  "Conte por que a seña foi anulada.": { es: "Contá por qué se anuló la seña." },
  "Por que a seña foi anulada?": { es: "¿Por qué se anula la seña?" },
  "A unidade volta a ficar disponível no estoque.": { es: "La unidad vuelve a quedar disponible en el stock." },
  "Confirmar anulação": { es: "Confirmar anulación" },
  "Escolha a unidade do estoque.": { es: "Elegí la unidad del stock." },
  "Informe o valor da seña.": { es: "Poné el monto de la seña." },
  "A data da seña não pode ser no futuro.": { es: "La fecha de la seña no puede ser futura." },
  "Unidade do estoque": { es: "Unidad del stock" },
  "Escolha a unidade": { es: "Elegí la unidad" },
  "Nenhuma unidade disponível ou reservada no estoque.": { es: "No hay unidades disponibles ni reservadas en el stock." },
  "Valor da seña": { es: "Monto de la seña" },
  "Comprovante (PDF ou foto)": { es: "Comprobante (PDF o foto)" },
  "A unidade passa a señada no estoque e a operação vai para a etapa Señado.": {
    es: "La unidad pasa a señada en el stock y la operación va a la etapa Señado.",
  },
  "Papelada e entrega": { es: "Papelería y entrega" },
  "Patente (domínio)": { es: "Patente (dominio)" },
  "Formulário 08": { es: "Formulario 08" },
  "Transferência": { es: "Transferencia" },
  "Emplacamento": { es: "Patentamiento" },
  "Assinado": { es: "Firmado" },
  "Assinatura certificada": { es: "Firma certificada" },
  "Em trâmite": { es: "En trámite" },
  "Inscrita no registro": { es: "Inscripta en el registro" },
  "Emplacado": { es: "Patentado" },
  "Entrega combinada para": { es: "Entrega acordada para" },
  "O atendente de IA não vê esta data e nunca promete entrega.": {
    es: "El asistente de IA no ve esta fecha y nunca promete una entrega.",
  },
  "Salvar papelada": { es: "Guardar papelería" },
  "Salvo.": { es: "Guardado." },
  "Unidade entregue em": { es: "Unidad entregada el" },
  "A seña foi aplicada e a unidade ficou como vendida no estoque. Mova a operação para Vendido quando fechar o negócio.": {
    es: "La seña quedó aplicada y la unidad figura como vendida en el stock. Pasá la operación a Vendido cuando cierres el negocio.",
  },
  "Data da entrega": { es: "Fecha de entrega" },
  "Confirmar entrega": { es: "Confirmar entrega" },
  "A entrega registrada não muda depois: a seña é aplicada e a unidade fica como vendida.": {
    es: "La entrega registrada no se puede cambiar después: la seña se aplica y la unidad queda como vendida.",
  },
  "Registrar entrega": { es: "Registrar entrega" },
  "Entrega ainda não registrada.": { es: "Todavía no se registró la entrega." },
  // Mensagens da rota e do banco (lib/autoventa/sena.ts, lib/autoventa/comprobante.ts).
  "Só gerente ou administrador pode anular uma seña.": { es: "Solo un gerente o administrador puede anular una seña." },
  "Seu papel não permite registrar a seña nem a papelada.": { es: "Tu rol no permite registrar la seña ni la papelería." },
  "Essa unidade não está mais disponível: outra operação já a reservou ou ela foi vendida.": {
    es: "Esa unidad ya no está disponible: otra operación la señó o ya se vendió.",
  },
  "Esta operação já tem uma seña vigente.": { es: "Esta operación ya tiene una seña vigente." },
  "Escolha uma unidade do estoque com a ficha do veículo preenchida.": {
    es: "Elegí una unidad del stock que tenga la ficha del vehículo cargada.",
  },
  "O valor, a moeda, a data e a unidade de uma seña não mudam. Se houve erro, anule e registre outra.": {
    es: "El monto, la moneda, la fecha y la unidad de una seña no cambian. Si hubo un error, anulala y registrá otra.",
  },
  "Essa seña já foi encerrada e não pode mudar.": { es: "Esa seña ya está cerrada y no puede cambiar." },
  "Para registrar a entrega, a operação precisa de uma seña vigente.": {
    es: "Para registrar la entrega, la operación necesita una seña vigente.",
  },
  "A entrega já foi registrada e não pode mudar.": { es: "La entrega ya está registrada y no puede cambiar." },
  "A data da entrega não pode ser no futuro.": { es: "La fecha de entrega no puede ser futura." },
  "Patente inválida. Use o formato AB123CD ou ABC123.": { es: "Patente inválida. Usá el formato AB123CD o ABC123." },
  "Seña não encontrada.": { es: "No se encontró la seña." },
  "Seña não encontrada ou já encerrada.": { es: "No se encontró la seña o ya está cerrada." },
  "Não foi possível salvar a seña. Tente de novo.": { es: "No se pudo guardar. Probá de nuevo." },
  "Não foi possível carregar as unidades do estoque.": { es: "No se pudieron cargar las unidades del stock." },
  "O comprovante excede o limite de 20 MB.": { es: "El comprobante supera el límite de 20 MB." },
  "Falha ao salvar o comprovante.": { es: "No se pudo guardar el comprobante." },
  // A ferramenta do agente (lib/mcp/tools/catalogo/autoventa.ts), na tela de IA › Agentes.
  "Consultar a seña e a papelada": { es: "Consultar la seña y la papelería" },
  "Mostra se a operação tem seña registrada, qual unidade ficou reservada, como estão o 08, a transferência ou o emplacamento e se já foi entregue — sem valores nem data de entrega, para o assistente nunca confirmar um pagamento nem prometer uma data.": {
    es: "Muestra si la operación tiene una seña registrada, qué unidad quedó reservada, cómo vienen el 08, la transferencia o el patentamiento y si ya se entregó, sin montos ni fecha de entrega, para que el asistente nunca confirme un pago ni prometa una fecha.",
  },
} as const;
