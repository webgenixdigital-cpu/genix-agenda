// Chave de volta da fila de mensagens (42_whatsapp_tipos_mensagem). Só no servidor.
// WHATSAPP_QUEUE_V2=1 → fila nova (confirmação, antes do horário, véspera e aniversário).
// Sem a variável ou "0" → caminho antigo (só véspera), sem precisar mexer no banco.
export const queueV2Enabled = () => process.env.WHATSAPP_QUEUE_V2 === "1";
