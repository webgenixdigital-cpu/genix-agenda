import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { loadDriverStops } from "@/app/motorista/[token]/actions";
import { DriverRoute } from "@/components/motorista/driver-route";

// 4c — App do motorista (link simples). Sempre dinâmico, nunca guarda resposta, sem índice de busca.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  title: "Rota do dia · Leva e traz",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MotoristaPage({ params }: { params: { token: string } }) {
  noStore();
  const token = /^[0-9a-f]{48}$/.test(params.token) ? params.token : "";
  const initial = await loadDriverStops(token);
  return (
    <main className="mx-auto min-h-svh max-w-md space-y-5 bg-[#FAF7F2] p-4">
      <DriverRoute token={token} initial={initial} valid={!!token} />
    </main>
  );
}
