import Link from "next/link";
import { MapPin, MessageCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brl, whatsappLink } from "@/lib/format";
import type { DirectoryItem } from "@/lib/types";

export function BusinessCard({ b }: { b: DirectoryItem }) {
  const wa = whatsappLink(b.whatsapp, b.whatsapp_message ?? undefined);

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-md"
      data-testid={`card-business-${b.slug}`}
    >
      <Link href={`/v/${b.slug}`} className="relative block aspect-[16/10] overflow-hidden bg-muted">
        {b.hero_image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.hero_image} alt={b.name} className="h-full w-full object-cover" loading="lazy" />
        )}
        {b.rating_count > 0 && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold">
            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
            {Number(b.rating_avg).toFixed(1)}
            <span className="font-normal text-muted-foreground">({b.rating_count})</span>
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-sm font-medium text-primary">{b.niche_name ?? ""}</p>
        <h3 className="mt-1 text-2xl leading-tight">
          <Link href={`/v/${b.slug}`} className="hover:underline">{b.name}</Link>
        </h3>
        {b.tagline && <p className="mt-2 text-sm text-muted-foreground">{b.tagline}</p>}

        <div className="mt-4 flex items-center justify-between text-sm">
          {b.city && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-4 w-4" /> {b.city}{b.state ? `, ${b.state}` : ""}
            </span>
          )}
          {b.min_price != null && (
            <span>
              a partir de <strong>{brl(b.min_price)}</strong>
            </span>
          )}
        </div>

        <div className="mt-5 flex gap-2 pt-1">
          <Button asChild className="h-11 flex-1 active:scale-95" data-testid={`btn-agendar-${b.slug}`}>
            <Link href={`/v/${b.slug}`}>Ver serviços e agendar</Link>
          </Button>
          {wa && (
            <Button
              asChild
              size="icon"
              className="h-11 w-11 bg-whatsapp text-white hover:bg-whatsapp-hover active:scale-95"
              data-testid={`btn-whatsapp-${b.slug}`}
            >
              <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${b.name}`}>
                <MessageCircle className="h-5 w-5" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
