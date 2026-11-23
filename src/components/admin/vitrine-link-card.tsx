"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ajuda } from "@/components/ajuda";
import { vitrineUrl } from "@/lib/vitrine-url";
import { VitrinePlanNote } from "@/components/admin/vitrine-plan-note";

/** cardOnly (59): Grátis e Básico — o link é um cartão de visita */
export function VitrineLinkCard({ slug, cardOnly = false }: { slug: string; cardOnly?: boolean }) {
  const [url, setUrl] = useState(() => vitrineUrl(slug));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(vitrineUrl(slug, window.location.origin));
  }, [slug]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-sans text-base font-semibold">{cardOnly ? "Seu cartão de visita" : "Link da sua vitrine"}</h2>
        {cardOnly && <Ajuda id="vitrine-carrinho" className="-my-2 -mr-2" />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Coloque na bio do Instagram e no status do WhatsApp.</p>

      <div className="mt-4 flex justify-center rounded-xl bg-white p-4">
        <QRCodeSVG value={url} size={148} fgColor="#1C1917" />
      </div>

      <p className="mt-4 truncate rounded-lg bg-secondary px-3 py-2 text-sm">{url}</p>
      <Button variant="outline" className="mt-2 h-11 w-full" onClick={copy} data-testid="btn-copiar-link">
        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
        {copied ? "Copiado" : "Copiar link"}
      </Button>
      {cardOnly && <VitrinePlanNote className="mt-4" compact />}
    </div>
  );
}