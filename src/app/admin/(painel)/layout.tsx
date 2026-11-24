import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangle, PauseCircle, WifiOff } from "lucide-react";
import { todayISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext, hasTeamFeatures, allows } from "@/lib/plan";
import { lockedHrefsFor } from "@/lib/plan-features";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { DemoBanner } from "@/components/admin/demo-banner";
import { PlanBanner } from "@/components/admin/plan-banner";
import { PlanFlagsProvider } from "@/components/admin/plan-flags";
import { NicheFlagsProvider } from "@/components/admin/niche-flags";
import { PET_NICHE_ID } from "@/lib/pets";
import { EmailConfirmedToast, EmailVerifyBanner } from "@/components/admin/email-verify-banner";
import { NixChat } from "@/components/admin/nix/nix-chat";
import { agentAccess } from "@/lib/agente/access";

export const dynamic = "force-dynamic";

// painel inteiro fora dos buscadores (o robots.txt também bloqueia /admin)
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  const isDemo = ctx.role === "viewer";
  const isOwner = ctx.role === "owner";
  const isTeam = ctx.role === "staff" || ctx.role === "reception";
  // menu recolhido no computador (cookie por navegador): já renderiza no estado certo, sem flash
  const sidebarCollapsed = cookies().get(SIDEBAR_COOKIE)?.value === "collapsed";

  // Plano e avisos da matriz numa rodada só: os avisos saem junto com o plano e só são
  // usados depois, conforme as mesmas condições de antes (o resultado que não vale é descartado)
  const bid = ctx.business.id;
  const [plan, freeInfo, waStatus, overdue] = await Promise.all([
    getPlanContext(bid),
    // faixa do plano (matriz): oferta do fim do teste pelo tamanho da equipe
    isOwner
      ? createClient()
          .from("professionals")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("active", true)
      : null,
    // WhatsApp automático ligado mas desconectado: aviso só para a matriz
    isOwner ? createClient().rpc("whatsapp_panel_status", { p_business: bid }) : null,
    // Avulsa de profissional extra vencida (29): aviso só para a matriz, com o link de pagamento
    isOwner
      ? createClient()
          .from("subscription_billing_changes")
          .select("invoice_url")
          .eq("business_id", bid)
          .eq("kind", "avulsa")
          .in("payment_status", ["PENDING", "OVERDUE"])
          .lt("payment_due_date", todayISO())
          .order("payment_due_date")
          .limit(1)
          .maybeSingle()
      : null,
  ]);

  let activePros = 1;
  if (isOwner && !plan.internal && plan.status !== "active" && freeInfo) {
    activePros = freeInfo.count ?? 1;
  }

  let waDisconnected = false;
  if (isOwner && allows(plan, "profissional") && waStatus) {
    const w = waStatus.data as { genix_enabled: boolean; auto_enabled: boolean; status: string } | null;
    waDisconnected = !!w?.genix_enabled && w.auto_enabled && w.status === "disconnected";
  }

  // Nix (assistente, 60): Equipe pago ou 3 últimos dias do teste; cadeado nos outros planos
  const nix = agentAccess(ctx, plan);

  const overdueExtra: { invoice_url: string | null } | null =
    isOwner && !plan.internal && overdue ? overdue.data : null;

  // Sem o plano Equipe (Grátis, Básico ou Profissional) só a matriz usa o painel: os acessos da
  // equipe ficam pausados (nunca apagados) e voltam quando o espaço assina o Equipe
  if (isTeam && !hasTeamFeatures(plan)) {
    return (
      <main className="grid min-h-svh place-items-center bg-secondary/50 p-4">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center" data-testid="acesso-pausado">
          <PauseCircle className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 text-3xl">Acesso da equipe pausado</h1>
          <p className="mt-2 text-muted-foreground">
            O plano de {ctx.business.name} não inclui acessos individuais no momento. Fale com o responsável pelo espaço.
          </p>
          <form action={signOut} className="mt-6">
            <Button type="submit" variant="outline" className="h-11">Sair</Button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <>
      {isDemo && (
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
      )}
      <div className="flex min-h-svh flex-col bg-stone-50 md:flex-row">
        <AdminSidebar
          businessName={ctx.business.name}
          slug={ctx.business.slug}
          email={isDemo ? "Conta de demonstração" : ctx.email}
          lockedHrefs={lockedHrefsFor(plan.kind)}
          role={ctx.role}
          petMode={ctx.business.subcategory === PET_NICHE_ID}
          initialCollapsed={sidebarCollapsed}
          belowDemoBanner={isDemo}
        />
        <div className="min-w-0 flex-1">
          {!isDemo && !plan.internal && !ctx.emailVerified && <EmailVerifyBanner email={ctx.email} />}
          {isOwner && <PlanBanner plan={plan} activePros={activePros} />}
          {overdueExtra && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:px-8" data-testid="aviso-extra-em-aberto">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="font-medium">Há uma cobrança de profissional extra em aberto.</span>
              {overdueExtra.invoice_url ? (
                <a href={overdueExtra.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold underline" data-testid="link-pagar-extra">
                  Pagar agora
                </a>
              ) : (
                <Link href="/admin/assinatura" className="inline-flex min-h-11 items-center font-semibold underline" data-testid="link-pagar-extra">
                  Ver na Assinatura
                </Link>
              )}
            </div>
          )}
          {waDisconnected && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 md:px-8" data-testid="aviso-whatsapp-desconectado">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span className="font-medium">WhatsApp desconectado — lembretes automáticos pausados.</span>
              <Link href="/admin/configuracoes#whatsapp" className="inline-flex min-h-11 items-center font-semibold underline" data-testid="link-whatsapp-reconectar">
                Reconectar
              </Link>
            </div>
          )}
          <Suspense fallback={null}>
            <EmailConfirmedToast />
          </Suspense>
          <PlanFlagsProvider value={{ readOnly: plan.freeOver, reviewRequest: allows(plan, "profissional") }}>
            {/* espaço no fim da página para o botão da Nix não cobrir o último item */}
            <NicheFlagsProvider value={{ petMode: ctx.business.subcategory === PET_NICHE_ID }}>
              {nix.kind === "oculto" ? children : <div className="pb-20">{children}</div>}
            </NicheFlagsProvider>
          </PlanFlagsProvider>
        </div>
      </div>
      {nix.kind !== "oculto" && (
        <NixChat mode={nix.kind} trialEndsAt={nix.kind === "teste" ? nix.trialEndsAt : null} />
      )}
    </>
  );
}
