"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function VitrineLinkCard({ slug }: { slug: string }) {
  const [url, setUrl] = useState(`/v/${slug}`);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/v/${slug}`);
  }, [slug]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="font-sans text-base font-semibold">Link da sua vitrine</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coloque na bio do Instagram e no status do WhatsApp.</p>

      <div className="mt-4 flex justify-center rounded-xl bg-white p-4">
        <QRCodeSVG value={url} size={148} fgColor="#1C1917" />
      </div>

      <p className="mt-4 truncate rounded-lg bg-secondary px-3 py-2 text-sm">{url}</p>
      <Button variant="outline" className="mt-2 h-11 w-full" onClick={copy} data-testid="btn-copiar-link">
        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
        {copied ? "Copiado" : "Copiar link"}
      </Button>
    </div>
  );
}