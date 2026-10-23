import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NicheManager, type AdminNiche } from "@/components/genix/niche-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administração | Genix Agenda", robots: { index: false, follow: false } };

export default async function GenixAdminPage() {
  const supabase = createClient();

  // Só administradores da plataforma. Para os demais, a página "não existe".
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const [{ data: niches }, { data: templates }, { data: usage }] = await Promise.all([
    supabase.from("niches").select("id, segment, name, description, icon, sort_order, active").order("sort_order"),
    supabase
      .from("niche_service_templates")
      .select("id, niche_id, name, category, description, duration_min, price, sort_order")
      .order("sort_order"),
    supabase.rpc("niche_usage_summary"),
  ]);

  const usageMap = new Map(((usage ?? []) as { niche_id: string; businesses: number }[]).map((u) => [u.niche_id, u.businesses]));

  const list: AdminNiche[] = (niches ?? []).map((n) => ({
    ...n,
    usage: usageMap.get(n.id) ?? 0,
    templates: (templates ?? [])
      .filter((t) => t.niche_id === n.id)
      .map((t) => ({ ...t, price: Number(t.price) })),
  }));

  return (
    <div className="min-h-svh bg-stone-50">
      <header className="border-b bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <p className="flex items-center gap-2 font-heading text-xl">
            <ShieldCheck className="h-5 w-5 text-[#F2C078]" /> Genix · Administração
          </p>
          <Link href="/admin" className="text-sm text-stone-300 underline hover:text-white">
            Voltar ao painel
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div>
          <h1 className="text-3xl md:text-4xl">Nichos de atendimento</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Os nichos aparecem no cadastro, nas Configurações dos espaços e na página inicial. Os serviços sugeridos
                        entram com um clique no “Primeiros passos” de cada conta nova.
          </p>
        </div>
        <NicheManager niches={list} />
      </main>
    </div>
  );
}
