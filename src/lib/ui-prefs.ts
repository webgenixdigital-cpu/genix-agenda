// Preferências de interface lembradas por navegador em cookie (lido no servidor: sem flash)

/** menu lateral do painel no computador: "collapsed" = só ícones */
export const SIDEBAR_COOKIE = "genix_sidebar";

/** configuração inicial no Início: sem cookie = recolhida; "expanded" = lista aberta; "hidden" = oculta */
export const ONBOARDING_COOKIE = "genix_onboarding";
export type OnboardingPref = "collapsed" | "expanded" | "hidden";

export function readOnboardingPref(value: string | undefined): OnboardingPref {
  return value === "expanded" || value === "hidden" ? value : "collapsed";
}

/** Grava (ou apaga, com null) um cookie de preferência. Só no navegador. */
export function setPrefCookie(name: string, value: string | null) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    value === null
      ? `${name}=; path=/admin; max-age=0; samesite=lax${secure}`
      : `${name}=${value}; path=/admin; max-age=31536000; samesite=lax${secure}`;
}
