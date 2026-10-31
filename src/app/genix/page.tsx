import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NicheManager, type AdminNiche } from "@/components/genix/niche-manager";
import { ProfileFieldsManager, type AdminField } from "@/components/genix/profile-fields-manager";
import { WhatsappManager, type WhatsappOverview } from "@/components/genix/whatsapp-manager";
import { RevenueLimitsManager } from "@/components/genix/revenue-limits-manager";
import { loadLimits } from "@/lib/faturamento-data";
import { todayISO } from "@/lib/dates";
import { BillingManager, type BillingOverview } from "@/components/genix/billing-manager";
import { asaas, type AsaasSubscription } from "@/lib/asaas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administração | Genix Agenda", robots: { index: false, follow: false } };

type Props = { searchParams: { aba?: string } };

/** Assinaturas (29): visão do banco + valor lido agora no Asaas */
async function loadBilling(supabase: ReturnType<typeof createClient>): Promise<BillingOverview[]> {
  const { data } = await supabase.rpc("genix_billing_overview");
  const rows = (data ?? []) as Omit<BillingOverview, "asaas_value">[];
  const num = (v: unknown) => (v == null ? null : Number(v));
  return Promise.all(
    rows.map(async (r) => {
      let asaasValue: number | null = null;
      if (r.asaas_subscription_id) {
        asaasValue = await asaas<AsaasSubscription>(`/subscriptions/${r.asaas_subscription_id}`)
          .then((s) => Number(s.value))
          .catch(() => null);
      }
      return {
        ...r,
        amount: num(r.amount),
        expected: num(r.expected),
        asaas_value: asaasValue,
        open_extras: Number(r.open_extras),
        overdue_extras: Number(r.overdue_extras),
        blocked_professionals: Number(r.blocked_professionals),
      };
    })
  );
}

export default async function GenixAdminPage({ searchParams }: Props) {
  const aba = (["fichas", "whatsapp", "limites", "assinaturas"] as const).find((a) => a === searchParams.aba) ?? "nichos";
  const supabase = createClient();

  // Só administradores da plataforma. Para os demais, a página "não existe".
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) notFound();

  const [{ data: niches }, { data: templates }, { data: usage }, { data: fields }, { data: whatsapp }] = await Promise.all([
    supabase
      .from("niches")
      .select("id, segment, name, description, icon, sort_order, active, featured, featured_order, keywords")
      .order("sort_order"),
    supabase
      .from("niche_service_templates")
      .select("id, niche_id, name, category, description, duration_min, price, sort_order")
      .order("sort_order"),
    supabase.rpc("niche_usage_summary"),
    supabase
      .from("niche_profile_fields")
      .select("id, niche_id, key, label, type, options, help, sort_order, active")
      .order("sort_order"),
    aba === "whatsapp" ? supabase.rpc("genix_whatsapp_overview") : Promise.resolve({ data: [] }),
  ]);
  const limits = aba === "limites" ? await loadLimits() : [];
  const billing = aba === "assinaturas" ? await loadBilling(supabase) : [];

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
          <h1 className="text-3xl md:text-4xl">Catálogo de nichos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Os nichos aparecem no cadastro, nas Configurações dos espaços e na página inicial.
          </p>
        </div>

        {/* Abas */}
        <nav className="inline-flex flex-wrap rounded-xl border bg-white p-1" aria-label="Seções">
          {[
            { key: "nichos", label: "Nichos e serviços", href: "/genix" },
            { key: "fichas", label: "Fichas técnicas", href: "/genix?aba=fichas" },
            { key: "whatsapp", label: "WhatsApp", href: "/genix?aba=whatsapp" },
            { key: "limites", label: "Limites de faturamento", href: "/genix?aba=limites" },
            { key: "assinaturas", label: "Assinaturas", href: "/genix?aba=assinaturas" },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={
                "inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium transition-colors " +
                (aba === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
              }
              data-testid={`aba-${t.key}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {aba === "nichos" ? (
          <NicheManager niches={list} />
        ) : aba === "assinaturas" ? (
          <BillingManager rows={billing} />
        ) : aba === "limites" ? (
          <RevenueLimitsManager limits={limits} today={todayISO()} />
        ) : aba === "whatsapp" ? (
          <WhatsappManager
            rows={((whatsapp ?? []) as WhatsappOverview[]).map((r) => ({
              ...r,
              sent_7d: Number(r.sent_7d),
              failed_7d: Number(r.failed_7d),
            }))}
          />
        ) : (
          <ProfileFieldsManager niches={list} fields={(fields ?? []) as AdminField[]} />
        )}
      </main>
    </div>
  );
}
