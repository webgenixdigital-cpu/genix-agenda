"use client";

// Indique e ganhe (56) no Início: só a matriz vê (a página decide). Mesmo visual do ConfirmIntroCard.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REFERRAL_TEXT } from "@/content/planos";
import { referralLink } from "@/lib/referral-public";

export function ReferralHomeCard({ code }: { code: string }) {
  // o link usa o domínio aberto agora (no servidor ainda não sabemos)
  const [link, setLink] = useState(referralLink("https://genixagenda.com.br", code));
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setLink(referralLink(window.location.origin, code)), [code]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (failed) field.current?.select();
  }, [failed]);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(link);
      setFailed(false);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5" data-testid="aviso-indicacao">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-3">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">{REFERRAL_TEXT.homeTitle}</p>
            <p className="text-sm text-muted-foreground">{REFERRAL_TEXT.homeBody}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/admin/assinatura#indicacao"
            className="tap-target text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            data-testid="link-como-funciona-indicacao"
          >
            {REFERRAL_TEXT.howItWorks}
          </Link>
          <Button className="h-11" onClick={copy} aria-live="polite" data-testid="btn-copiar-indicacao-inicio">
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? REFERRAL_TEXT.copied : REFERRAL_TEXT.copy}
          </Button>
        </div>
      </div>

      {failed && (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{REFERRAL_TEXT.copyFailed}</span>
          <input
            ref={field}
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm"
            data-testid="campo-link-indicacao-inicio"
          />
        </label>
      )}
    </section>
  );
}
