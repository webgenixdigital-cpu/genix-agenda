"use client";

import { ONBOARDING_COOKIE, setPrefCookie } from "@/lib/ui-prefs";

// Reabre a configuração inicial no Início (desfaz o "Ocultar" deste navegador) já com a lista aberta
export function ReviewOnboardingLink() {
  return (
    <button
      type="button"
      onClick={() => {
        setPrefCookie(ONBOARDING_COOKIE, "expanded");
        // navegação completa: o Início é lido de novo com o cookie novo (sem cache do roteador)
        window.location.assign("/admin");
      }}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      data-testid="link-rever-onboarding"
    >
      Rever configuração inicial
    </button>
  );
}
