"use client";

// Indique e ganhe (migration 56): link único do espaço, copiar, compartilhar no
// WhatsApp e a lista das indicações (só nome do espaço, data e situação).
import { useEffect, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { toast } from "sonner";
import { Ajuda } from "@/components/ajuda";
import { Button } from "@/components/ui/button";
import { referralLink, referralShareText, referralStatusLabel, type ReferralItem } from "@/lib/referral-public";
import { cn } from "@/lib/utils";

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  );

const months = (n: number) => (n === 1 ? "1 mês grátis" : `${n} meses grátis`);

export function ReferralCard({
  code,
  businessName,
  rewards,
  items,
}: {
  code: string;
  businessName: string;
  rewards: { guardado: number; aplicado: number };
  items: ReferralItem[];
}) {
  // o link usa o domínio aberto agora (no servidor ainda não sabemos)
  const [link, setLink] = useState(referralLink("https://genixagenda.com.br", code));
  const [copied, setCopied] = useState(false);
  useEffect(() => setLink(referralLink(window.location.origin, code)), [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie.");
    }
  }

  const share = `https://wa.me/?text=${encodeURIComponent(referralShareText(businessName, link))}`;

  return (
    <section id="indicacao" className="scroll-mt-20 space-y-4 rounded-2xl border bg-card p-5" data-testid="card-indique-e-ganhe">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F2C078]/40 text-[#7a4520]">
          <Gift className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center text-2xl">
            Indique e ganhe
            <Ajuda id="indicacao" className="-my-2 -ml-1" />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quando um espaço que você indicou pagar a 1ª mensalidade ou anuidade, você ganha 1 mês grátis. Sem limite de
            indicações.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="break-all rounded-lg bg-secondary px-3 py-2 text-sm" data-testid="link-indicacao">
          {link}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-11" onClick={copy} data-testid="btn-copiar-indicacao">
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copiado" : "Copiar link"}
          </Button>
          <Button asChild className="h-11 bg-whatsapp text-white hover:bg-whatsapp-hover" data-testid="btn-whatsapp-indicacao">
            <a href={share} target="_blank" rel="noopener noreferrer">
              Compartilhar no WhatsApp
            </a>
          </Button>
        </div>
      </div>

      {(rewards.guardado > 0 || rewards.aplicado > 0) && (
        <p className="rounded-xl bg-[#F2C078]/25 px-3 py-2 text-sm" data-testid="resumo-premios">
          {rewards.aplicado > 0 && <>Você já ganhou <strong>{months(rewards.aplicado)}</strong>. </>}
          {rewards.guardado > 0 && (
            <>
              <strong>{months(rewards.guardado)}</strong> {rewards.guardado === 1 ? "guardado" : "guardados"}: entra
              {rewards.guardado === 1 ? "" : "m"} logo depois do pagamento da sua assinatura.
            </>
          )}
        </p>
      )}

      <div>
        <p className="text-sm font-semibold">Suas indicações</p>
        {items.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Ninguém se cadastrou pelo seu link ainda.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-xl border" data-testid="lista-indicacoes">
            {items.map((i, idx) => (
              <li key={`${i.name}-${i.created_at}-${idx}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="min-w-0 font-medium">
                  {i.name}
                  <span className="block text-xs font-normal text-muted-foreground">cadastro em {br(i.created_at)}</span>
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    i.reward === "aplicado" || i.reward === "guardado"
                      ? "bg-emerald-100 text-emerald-800"
                      : i.reward === "cancelado"
                        ? "bg-stone-200 text-stone-700"
                        : "bg-secondary text-foreground"
                  )}
                >
                  {referralStatusLabel(i)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
