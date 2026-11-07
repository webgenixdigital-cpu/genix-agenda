"use client";

import { useEffect } from "react";

/**
 * Revela ao rolar os elementos com a classe `lp-reveal` (IntersectionObserver).
 * Só liga o efeito (classe `lp-reveal-on` no <html>) quando o JS roda: sem JS, nada fica escondido.
 * Com prefers-reduced-motion o CSS mostra tudo direto (globals.css).
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp-reveal"));
    if (!("IntersectionObserver" in window) || els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    els.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 80}ms`;
      io.observe(el);
    });
    root.classList.add("lp-reveal-on");

    return () => {
      io.disconnect();
      root.classList.remove("lp-reveal-on");
    };
  }, []);

  return null;
}
