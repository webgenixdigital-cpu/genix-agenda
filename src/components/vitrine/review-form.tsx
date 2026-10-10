"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const LABELS = ["", "Ruim", "Regular", "Bom", "Muito bom", "Excelente"];

const ERRORS: Record<string, string> = {
  JA_AVALIADO: "Este atendimento já foi avaliado. Obrigado!",
  ATENDIMENTO_NAO_CONCLUIDO: "A avaliação fica disponível depois do atendimento.",
  AVALIACAO_INVALIDA: "Link de avaliação inválido.",
  DADOS_INVALIDOS: "Escolha de 1 a 5 estrelas.",
};

export function ReviewForm({
  bookingId,
  slug,
  businessName,
  firstName,
}: {
  bookingId: string;
  slug: string;
  businessName: string;
  firstName: string;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_review", {
      p_booking: bookingId,
      p_rating: rating,
      p_comment: comment || null,
    });
    setSending(false);
    if (error) {
      const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
      setError(code ? ERRORS[code] : "Não foi possível enviar agora. Tente de novo.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="text-center" data-testid="avaliacao-enviada">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700">
          <Check className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-3xl">Obrigado, {firstName}!</h2>
        <p className="mt-2 text-muted-foreground">Sua avaliação ajuda {businessName} e outros clientes.</p>
        <Button asChild variant="outline" className="mt-6 h-11">
          <Link href={`/v/${slug}`}>Ver a vitrine</Link>
        </Button>
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating) submit();
      }}
    >
      <div className="text-center">
        <div className="inline-flex gap-1" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Nota de 1 a 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              className="grid h-14 w-14 place-items-center rounded-full transition-transform active:scale-90"
              data-testid={`estrela-${n}`}
            >
              <Star className={cn("h-10 w-10", n <= shown ? "fill-amber-500 text-amber-500" : "text-stone-300")} />
            </button>
          ))}
        </div>
        <p className="mt-2 h-6 font-semibold text-primary">{LABELS[shown]}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="rv-comment" className="text-sm font-medium">
          Quer contar como foi? (opcional)
        </label>
        <Textarea
          id="rv-comment"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 600))}
          placeholder="O que você mais gostou?"
          data-testid="input-comentario"
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="h-12 w-full text-base" disabled={!rating || sending} data-testid="btn-enviar-avaliacao">
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar avaliação"}
      </Button>
    </form>
  );
}