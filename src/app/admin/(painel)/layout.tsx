import { Suspense } from "react";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { FREE_LOCKED_HREFS } from "@/lib/plan-features";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { DemoBanner } from "@/components/admin/demo-banner";
import { PlanBanner } from "@/components/admin/plan-banner";
import { EmailConfirmedToast, EmailVerifyBanner } from "@/components/admin/email-verify-banner";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  const plan = await getPlanContext(ctx.business.id);
  const isDemo = ctx.role === "viewer";

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
          lockedHrefs={plan.tier === "gratis" ? FREE_LOCKED_HREFS : []}
        />
        <div className="min-w-0 flex-1">
          {!isDemo && !plan.internal && !ctx.emailVerified && <EmailVerifyBanner email={ctx.email} />}
          {!isDemo && <PlanBanner plan={plan} />}
          <Suspense fallback={null}>
            <EmailConfirmedToast />
          </Suspense>
          {children}
        </div>
      </div>
    </>
  );
}
