import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarHeart, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "@/components/vitrine/review-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avalie seu atendimento", robots: { index: false } };

type Props = { params: { slug: string; id: string } };

type Ctx = {
  business_name: string;
  slug: string;
  hero_image: string | null;
  service_name: string;
  professional_name: string;
  first_name: string;
  status: string;
  already_reviewed: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AvaliarPage({ params }: Props) {
  if (!UUID.test(params.id)) notFound();

  const supabase = createClient();
  const { data } = await supabase.rpc("get_review_context", { p_booking: params.id });
  const ctx = data as Ctx | null;
  if (!ctx || ctx.slug !== params.slug) notFound();

  return (
    <div className="min-h-svh bg-background">
      <header className="relative isolate overflow-hidden">
        {ctx.hero_image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ctx.hero_image} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(28,25,23,0.78)_0%,rgba(28,25,23,0.9)_100%)]" />
        <div className="mx-auto max-w-lg px-5 pb-16 pt-10 text-center text-white">
          <CalendarHeart className="mx-auto h-8 w-8 text-[#F2C078]" />
          <p className="mt-4 text-sm text-stone-300">{ctx.business_name}</p>
          <h1 className="mt-1 text-3xl leading-tight md:text-4xl">Como foi seu atendimento, {ctx.first_name}?</h1>
          <p className="mt-3 text-stone-300">
            {ctx.service_name} com {ctx.professional_name}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-8 max-w-lg px-4 pb-12">
        <div className="rounded-2xl border bg-card p-6 shadow-sm md:p-8">
          {ctx.already_reviewed ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <h2 className="mt-4 text-2xl">Você já avaliou este atendimento</h2>
              <p className="mt-2 text-muted-foreground">Obrigado pelo carinho!</p>
              <Button asChild variant="outline" className="mt-6 h-11">
                <Link href={`/v/${ctx.slug}`}>Ver a vitrine</Link>
              </Button>
            </div>
          ) : ctx.status !== "completed" ? (
            <div className="text-center">
              <h2 className="text-2xl">Avaliação ainda não liberada</h2>
              <p className="mt-2 text-muted-foreground">Você poderá avaliar depois do atendimento.</p>
            </div>
          ) : (
            <ReviewForm bookingId={params.id} slug={ctx.slug} businessName={ctx.business_name} firstName={ctx.first_name} />
          )}
        </div>
      </main>
    </div>
  );
}