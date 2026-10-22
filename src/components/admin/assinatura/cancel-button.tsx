"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelSubscription } from "@/app/admin/(painel)/assinatura/actions";
import { Button } from "@/components/ui/button";

export function CancelSubscriptionButton({ label, confirmText }: { label: string; confirmText: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="h-11 text-destructive hover:bg-red-50 hover:text-destructive"
      disabled={pending}
      data-testid="btn-cancelar-assinatura"
      onClick={() => {
        if (!confirm(confirmText)) return;
        start(async () => {
          const r = await cancelSubscription();
          if (!r) return; // demonstração
          if (r.ok) toast.success("Feito.");
          else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}
