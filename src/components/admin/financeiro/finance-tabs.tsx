import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "caixa", label: "Caixa", href: "/admin/financeiro" },
  { key: "faturamento", label: "Faturamento", href: "/admin/financeiro/faturamento" },
  { key: "contador", label: "Contador", href: "/admin/financeiro/contador" },
] as const;

export function FinanceTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="inline-flex rounded-xl border bg-card p-1" aria-label="Seções do financeiro">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium transition-colors",
            active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          aria-current={active === t.key ? "page" : undefined}
          data-testid={`aba-financeiro-${t.key}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
