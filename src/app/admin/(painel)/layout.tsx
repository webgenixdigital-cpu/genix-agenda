import { getAdminContext } from "@/lib/admin";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();

  return (
    <div className="flex min-h-svh flex-col bg-stone-50 md:flex-row">
      <AdminSidebar businessName={ctx.business.name} slug={ctx.business.slug} email={ctx.email} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}