// Aviso da cobrança do profissional extra antes de ativar, cadastrar, desativar ou excluir.
// Devolve o valor que a matriz confirmou (ack): a action confere que ainda é o mesmo.
import { toast } from "sonner";
import { previewProfessionalBilling } from "@/app/admin/(painel)/profissionais/actions";

export async function confirmTeamBilling(delta: 1 | -1): Promise<{ proceed: boolean; ack: number | null } | null> {
  const pre = await previewProfessionalBilling(delta);
  if (!pre) return null; // demonstração: o servidor redirecionou
  if (!pre.ok) {
    toast.error(pre.error);
    return { proceed: false, ack: null };
  }
  if (pre.message && !window.confirm(`${pre.message}\n\nConfirmar?`)) return { proceed: false, ack: null };
  return { proceed: true, ack: pre.expected };
}
