"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LANDING_HERO, LANDING_NAV, SIGNUP_PREFILL_KEY } from "@/content/landing";
import { lpBtnSolid } from "./styles";

/**
 * Campo do hero: guarda o e-mail/WhatsApp no sessionStorage (nunca na URL) e leva ao /cadastro,
 * que pré-preenche o campo certo. Sem JS, o form só abre o /cadastro (o input não tem `name`).
 */
export function HeroSignupForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim().slice(0, 120);
    try {
      if (v) sessionStorage.setItem(SIGNUP_PREFILL_KEY, v);
    } catch {
      // modo privado / armazenamento bloqueado: segue sem pré-preencher
    }
    router.push(LANDING_NAV.signup.href);
  }

  return (
    <form
      action={LANDING_NAV.signup.href}
      onSubmit={submit}
      className="mx-auto flex max-w-[500px] flex-col gap-2 rounded-[20px] bg-white p-2 shadow-[0_0_0_1px_hsl(var(--border)),0_10px_30px_-12px_rgba(153,88,42,0.25)] focus-within:ring-2 focus-within:ring-ring min-[521px]:flex-row min-[521px]:rounded-full min-[521px]:p-1.5 min-[900px]:mx-0"
    >
      <input
        type="text"
        autoComplete="email"
        maxLength={120}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={LANDING_HERO.inputPlaceholder}
        aria-label={LANDING_HERO.inputPlaceholder}
        className="h-12 min-w-0 shrink-0 bg-transparent min-[521px]:flex-1 px-4 text-base outline-none placeholder:text-muted-foreground"
        data-testid="input-hero-contato"
      />
      <button type="submit" className={lpBtnSolid} data-testid="btn-hero-teste">
        {LANDING_HERO.cta}
      </button>
    </form>
  );
}
