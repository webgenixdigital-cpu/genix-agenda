import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const STYLE: Record<BookingStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-600/30",
  confirmed: "bg-blue-50 text-blue-800 ring-blue-600/30",
  completed: "bg-green-50 text-green-800 ring-green-600/30",
  cancelled: "bg-red-50 text-red-800 ring-red-600/30",
};

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        STYLE[status],
        className
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}