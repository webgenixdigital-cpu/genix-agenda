import { Ajuda } from "@/components/ajuda";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  BadgeCheck,
  Cake,
  CalendarCheck,
  CalendarOff,
  HandCoins,
  ListChecks,
  MessageCircle,
  RotateCcw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext, PLAN_NAMES, type PlanContext } from "@/lib/plan";
import { loadHome, type HomeData } from "@/lib/dashboard-data";
import { OnboardingCard } from "@/components/admin/onboarding-card";
import { ONBOARDING_COOKIE, readOnboardingPref } from "@/lib/ui-prefs";
import { addDaysISO } from "@/lib/dates";
import { brl, longDate } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { VitrineLinkCard } from "@/components/admin/vitrine-link-card";
import { ConfirmIntroCard } from "@/components/admin/confirm-intro-card";
import { HomeTile, type HomeTileTone } from "@/components/admin/inicio/home-tile";
import { Button } from "@/components/ui/button";
import type { AdminContext } from "@/lib/admin";
import type { BookingStatus } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------
// PARTE 1 — Quadros (cada um só para quem tem permissão)
// ---------------------------------------------------------------------
type Tile = {
  id: string;
  href: string;
  icon: LucideIcon;
  title: string;
  value: string;
  hint: string;
  tone?: HomeTileTone;
  textValue?: boolean;
};

/** "sex., 20/11" */
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(
    new Date(`${iso}T12:00:00Z`)
  );
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Ana, Bia e +2" */
const shortList = (names: string[], max = 2) =>
  names.length <= max
    ? names.join(names.length === 2 ? " e " : "")
    : `${names.slice(0, max).join(", ")} e +${names.length - max}`;

function buildTiles(role: AdminContext["role"], plan: PlanContext, d: HomeData): Tile[] {
  const ownerLike = role === "owner" || role === "viewer";
  const tiles: Tile[] = [];

  // Hoje
  const t = d.todayTile;
  tiles.push(
    t.pendingConfirm > 0
      ? {
          id: "hoje",
          href: "/admin/agenda?status=pending",
          icon: CalendarCheck,
          title: "Hoje",
          value: String(t.count),
          hint: `${plural(t.count, "atendimento", "atendimentos")} · ${t.pendingConfirm} a confirmar`,
          tone: "alerta",
        }
      : {
          id: "hoje",
          href: "/admin/agenda",
          icon: CalendarCheck,
          title: "Hoje",
          value: String(t.count),
          hint: t.count === 0 ? "nenhum atendimento hoje" : `${plural(t.count, "atendimento", "atendimentos")} · ${t.done} concluído${t.done === 1 ? "" : "s"}`,
          tone: t.count === 0 ? "calmo" : "normal",
        }
  );

  // Pagamentos pendentes
  if (d.payments) {
    tiles.push(
      d.payments.count > 0
        ? {
            id: "pagamentos",
            href: "/admin/agenda?pagamentos=1",
            icon: Wallet,
            title: "Pagamentos pendentes",
            value: String(d.payments.count),
            hint: `${brl(d.payments.total)} a receber`,
            tone: "alerta",
          }
        : {
            id: "pagamentos",
            href: "/admin/agenda?pagamentos=1",
            icon: Wallet,
            title: "Pagamentos pendentes",
            value: "Tudo em dia",
            hint: "nenhum pagamento a registrar",
            tone: "calmo",
            textValue: true,
          }
    );
  }

  // Caixa do mês (dono)
  if (d.cash) {
    tiles.push({
      id: "caixa",
      href: "/admin/financeiro",
      icon: TrendingUp,
      title: "Caixa do mês",
      value: brl(d.cash.income),
      hint: d.cash.income || d.cash.expense ? `Saldo ${brl(d.cash.income - d.cash.expense)}` : "nenhuma entrada ainda",
      tone: d.cash.income || d.cash.expense ? "normal" : "calmo",
      textValue: true,
    });
  }

  // Meus ganhos (profissional)
  if (d.earnings) {
    const pct = String(d.earnings.commission).replace(".", ",");
    tiles.push({
      id: "ganhos",
      href: "/admin/ganhos",
      icon: HandCoins,
      title: "Meus ganhos",
      value: brl(d.earnings.value),
      hint: d.earnings.commission
        ? `${plural(d.earnings.count, "concluído", "concluídos")} no mês · ${pct}%`
        : "percentual não definido",
      tone: d.earnings.count ? "normal" : "calmo",
      textValue: true,
    });
  }

  // WhatsApp automático (dono)
  if (d.whatsapp) {
    const w = d.whatsapp;
    tiles.push(
      w.status === "disconnected"
        ? {
            id: "whatsapp",
            href: "/admin/configuracoes#whatsapp",
            icon: MessageCircle,
            title: "WhatsApp",
            value: "Desconectado",
            hint: "toque para conectar de novo",
            tone: "alerta",
            textValue: true,
          }
        : w.status === "connected"
          ? {
              id: "whatsapp",
              href: "/admin/configuracoes#whatsapp",
              icon: MessageCircle,
              title: "WhatsApp",
              value: "Conectado",
              hint: w.autoEnabled ? `${plural(w.sentToday, "mensagem enviada", "mensagens enviadas")} hoje` : "envio automático desligado",
              textValue: true,
            }
          : {
              id: "whatsapp",
              href: "/admin/configuracoes#whatsapp",
              icon: MessageCircle,
              title: "WhatsApp",
              value: "Não conectado",
              hint: "conecte pelo QR code",
              textValue: true,
            }
    );
  }

  // Aniversários (dono e recepção)
  if (d.birthdays) {
    const list = d.birthdays;
    const names = list.map((c) => `${firstName(c.name)}${c.inDays === 0 ? " (hoje)" : ""}`);
    tiles.push(
      list.length > 0
        ? {
            id: "aniversarios",
            href: list.length === 1 ? `/admin/clientes/${list[0].id}` : "/admin/clientes",
            icon: Cake,
            title: "Aniversários",
            value: String(list.length),
            hint: shortList(names),
          }
        : {
            id: "aniversarios",
            href: "/admin/clientes",
            icon: Cake,
            title: "Aniversários",
            value: "Nenhum",
            hint: "nos próximos 7 dias",
            tone: "calmo",
            textValue: true,
          }
    );
  }

  // Retornos (dono e recepção, planos pagos)
  if (d.returns) {
    const { due, soon } = d.returns;
    tiles.push(
      due > 0
        ? {
            id: "retornos",
            href: "/admin/lembretes?dia=retornos",
            icon: RotateCcw,
            title: "Retornos",
            value: String(due),
            hint: `na hora de voltar${soon ? ` · +${soon} em 7 dias` : ""}`,
          }
        : {
            id: "retornos",
            href: "/admin/lembretes?dia=retornos",
            icon: RotateCcw,
            title: "Retornos",
            value: "Tudo em dia",
            hint: soon ? `${soon} nos próximos 7 dias` : "ninguém na fila",
            tone: "calmo",
            textValue: true,
          }
    );
  }

  // Próximo bloqueio ou feriado (o que vier antes)
  const blockDay = d.block ? (d.block.date_start > d.today ? d.block.date_start : d.today) : null;
  const useBlock = !!d.block && (!d.holiday || (blockDay as string) <= d.holiday.date);
  const soon = addDaysISO(d.today, 7);
  if (useBlock && d.block && blockDay) {
    const ongoing = d.block.date_start <= d.today;
    tiles.push({
      id: "bloqueio",
      href: "/admin/bloqueios",
      icon: CalendarOff,
      title: "Próximo bloqueio",
      value: ongoing ? (d.block.date_end > d.today ? `Até ${ddmm(d.block.date_end)}` : "Hoje") : dayLabel(blockDay),
      hint: d.block.reason?.trim() || (d.block.time_start ? `a partir das ${d.block.time_start.slice(0, 5)}` : "agenda fechada"),
      tone: blockDay <= soon ? "normal" : "calmo",
      textValue: true,
    });
  } else if (d.holiday) {
    tiles.push({
      id: "bloqueio",
      href: "/admin/bloqueios",
      icon: CalendarOff,
      title: "Próximo feriado",
      value: d.holiday.date === d.today ? "Hoje" : dayLabel(d.holiday.date),
      hint: `${d.holiday.name}${d.holiday.optional ? " · ponto facultativo" : ""}`,
      tone: d.holiday.date <= soon ? "normal" : "calmo",
      textValue: true,
    });
  }

  // Plano (dono)
  if (ownerLike) {
    const name = PLAN_NAMES[plan.kind];
    const tile = (value: string, hint: string, tone: HomeTileTone = "normal"): Tile => ({
      id: "plano",
      href: "/admin/assinatura",
      icon: BadgeCheck,
      title: "Plano",
      value,
      hint,
      tone,
      textValue: true,
    });
    if (plan.grant) {
      tiles.push(tile(PLAN_NAMES[plan.grant.kind], plan.grant.expiresAt ? `cortesia até ${ddmm(plan.grant.expiresAt.slice(0, 10))}` : "cortesia", "calmo"));
    } else if (plan.trialDaysLeft !== null) {
      tiles.push(tile(plural(plan.trialDaysLeft, "dia", "dias"), "de teste do plano Equipe", plan.trialDaysLeft <= 3 ? "alerta" : "normal"));
    } else if (plan.status === "past_due") {
      tiles.push(tile(name, "pagamento da assinatura em atraso", "alerta"));
    } else if (plan.tier === "gratis") {
      tiles.push(tile("Grátis", "conheça os planos pagos"));
    } else if (plan.status === "active") {
      tiles.push(tile(name, plan.currentPeriodEnd ? `próxima cobrança ${ddmm(plan.currentPeriodEnd.slice(0, 10))}` : "assinatura em dia", "calmo"));
    } else {
      tiles.push(tile(name, "sem cobrança", "calmo"));
    }
  }

  // Falta configurar (dono): some quando está tudo preenchido
  if (d.gaps && d.gaps.length > 0) {
    tiles.push({
      id: "falta-configurar",
      href: d.gaps[0].href,
      icon: ListChecks,
      title: "Falta configurar",
      value: String(d.gaps.length),
      hint: capitalize(shortList(d.gaps.map((g) => g.label))),
      tone: "alerta",
    });
  }

  return tiles;
}

// ---------------------------------------------------------------------
// PARTE 2 — Página
// ---------------------------------------------------------------------
type Props = { searchParams: { "bem-vindo"?: string } };

export default async function Dashboard({ searchParams }: Props) {
  const { business, role, professionalId } = await getAdminContext();
  const isOwner = role === "owner";
  // plano (cache do layout) e consultas do Início na mesma rodada
  const d = await loadHome({ role, professionalId }, business as never, getPlanContext(business.id));
  const plan = d.plan;

  // Configuração inicial: matriz (e a demo, só para ver); "Ocultar" fica no cookie deste navegador
  const onboardingPref = readOnboardingPref(cookies().get(ONBOARDING_COOKIE)?.value);
  const showsOnboarding = (role === "viewer" || (isOwner && !plan.internal)) && onboardingPref !== "hidden";
  const onboarding = showsOnboarding ? d.onboarding : null;
  const welcome = searchParams["bem-vindo"] === "1";

  // Confirmação automática: aviso para contas antigas
  const biz = business as unknown as { online_confirm_mode?: string; online_confirm_reviewed_at?: string | null };
  const showConfirmIntro = isOwner && biz.online_confirm_mode === "manual" && !biz.online_confirm_reviewed_at;

  const tiles = buildTiles(role, plan, d);
  const greeting = role === "staff" && d.meName ? firstName(d.meName) : business.name;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:space-y-10 md:p-8">
      <header className="text-center">
        <p className="text-sm text-muted-foreground first-letter:uppercase">{longDate(d.today)}</p>
        <h1 className="mt-1 text-3xl md:text-4xl">Olá, {greeting} <Ajuda id="inicio" className="-ml-2" /></h1>
      </header>

      {onboarding && onboarding.doneCount < onboarding.total && (
        <OnboardingCard
          items={onboarding.items}
          doneCount={onboarding.doneCount}
          total={onboarding.total}
          initialExpanded={onboardingPref === "expanded"}
          slug={business.slug}
          welcome={welcome}
          ownerName={(business as { owner_name?: string | null }).owner_name}
        />
      )}

      {showConfirmIntro && <ConfirmIntroCard />}

      {d.autoConfirmed > 0 && (
        <Link
          href="/admin/agenda"
          className="flex items-center justify-between gap-4 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900 transition-colors hover:bg-green-100"
          data-testid="linha-confirmados-automaticamente"
        >
          <span>
            <strong>{d.autoConfirmed}</strong>{" "}
            {d.autoConfirmed === 1
              ? "novo agendamento online confirmado automaticamente (24 h)"
              : "novos agendamentos online confirmados automaticamente (24 h)"}
          </span>
          <span className="text-sm font-semibold underline">Ver agenda</span>
        </Link>
      )}

      {/* Quadros */}
      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4" data-testid="quadros-inicio">
        {tiles.map((t) => (
          <HomeTile key={t.id} {...t} />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Agenda de hoje */}
        <section className="rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b p-5">
            <h2 className="font-sans text-base font-semibold">Agenda de hoje</h2>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/agenda">Abrir agenda</Link>
            </Button>
          </div>

          {d.bookings.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              Nenhum atendimento hoje. Compartilhe o link da vitrine para receber agendamentos.
            </p>
          ) : (
            <ul className="divide-y">
              {d.bookings.map((b) => (
                <li key={b.id} className="flex items-center gap-4 p-4 md:px-5" data-testid={`agenda-hoje-${b.id}`}>
                  <div className="w-14 shrink-0 text-center">
                    <p className="font-semibold">{b.start_time.slice(0, 5)}</p>
                    <p className="text-xs text-muted-foreground">{b.end_time.slice(0, 5)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.customer_name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {b.service_name} com {b.professional_name}
                    </p>
                  </div>
                  <StatusBadge status={b.status as BookingStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <VitrineLinkCard slug={business.slug} />
      </div>
    </main>
  );
}
