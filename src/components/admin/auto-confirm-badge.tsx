import { Sparkles } from "lucide-react";
import { AUTO_CONFIRM_LABEL, type AutoConfirmReason } from "@/lib/confirm-mode";

/** Selo do motivo da confirmação automática (só enquanto o agendamento está confirmado) */
export function AutoConfirmBadge({
  status,
  reason,
  testId,
}: {
  status: string;
  reason: string | null | undefined;
  testId?: string;
}) {
  if (status !== "confirmed" || !reason || !(reason in AUTO_CONFIRM_LABEL)) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800"
      data-testid={testId}
    >
      <Sparkles className="h-3 w-3" /> {AUTO_CONFIRM_LABEL[reason as AutoConfirmReason]}
    </span>
  );
}
