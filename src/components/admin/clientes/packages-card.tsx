"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, CalendarDays, Check, Loader2, Lock, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  cancelPackage,
  previewPackageVisits,
  sellPackage,
  sellPackageVisits,
  type VisitCheck,
} from "@/app/admin/(painel)/clientes/actions";
import { addDays, markedCount, suggestVisits, type PlanFrequency, type PlanRule, type PlanVisit } from "@/lib/package-plan";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { METHOD_LABEL, type CashMethod } from "@/lib/cash";
import { brl } from "@/lib/format";
import { FREQUENCY_LABEL, SKIP_REASON } from "@/lib/series";
import { cn } from "@/lib/utils";
import type { SaleProfessional, SaleTemplate } from "@/lib/package-sale";

export type CustomerPackage = {
  id: string;
  name: string;
  service_name: string;
  sessions_total: number;
  used: number;
  remaining: number;
  price: number;
  sold_at: string;
  expires_at: string | null;
  effective_status: "active" | "finished" | "expired" | "cancelled";
  /** 39_pacote_datas_fixas: vendido com as visitas já agendadas */
  fixed: boolean;
  /** 37_plano_fechado: saldo por serviço do pacote */
  items: { id: string; service_name: string; sessions_total: number; used: number; remaining: number }[];
  /** visitas que usaram o pacote; services = serviços do pacote usados nela */
  sessions: { id: string; booking_date: string; start_time: string; professional_name: string; status: string; services: string[] }[];
  /** agendamentos futuros cujo serviço principal é do pacote (cancelar junto) */
  future_count: number;
};

export type { SaleTemplate };

const br = (iso: string) => iso.split("-").reverse().join("/");

const STATUS: Record<CustomerPackage["effective_status"], { label: string; cls: string }> = {
  active: { label: "Ativo", cls: "bg-green-100 text-green-800" },
  finished: { label: "Concluído", cls: "bg-stone-100 text-stone-700" },
  expired: { label: "Vencido", cls: "bg-amber-100 text-amber-800" },
  cancelled: { label: "Cancelado", cls: "bg-red-50 text-destructive" },
};

const SESSION_STATUS: Record<string, string> = {
  pending: "agendada",
  confirmed: "agendada",
  completed: "realizada",
  cancelled: "cancelada (devolvida)",
};

export function PackagesCard({
  customerId,
  packages,
  templates,
  canSell,
  professionals,
  locked,
}: {
  customerId: string;
  packages: CustomerPackage[];
  templates: SaleTemplate[];
  canSell: boolean; // matriz ou recepção
  professionals: ProOption[];
  locked: boolean;  // plano Grátis: vender fica travado; sessões já vendidas continuam
}) {
  const [sellOpen, setSellOpen] = useState(false);
  const [toCancel, setToCancel] = useState<CustomerPackage | null>(null);
  const [cancelFuture, setCancelFuture] = useState(true);
  const [pending, start] = useTransition();

  function confirmCancel() {
    if (!toCancel) return;
    const withFuture = cancelFuture && toCancel.future_count > 0;
    start(async () => {
      const r = await cancelPackage(customerId, toCancel.id, withFuture);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success(
          r.cancelled > 0
            ? `Pacote cancelado · ${r.cancelled} ${r.cancelled === 1 ? "agendamento cancelado" : "agendamentos cancelados"}`
            : "Pacote cancelado"
        );
        setToCancel(null);
      } else toast.error(r.error);
    });
  }

  return (
    <section className="space-y-3" data-testid="card-pacotes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Pacotes</h2>
        {canSell && !locked && (
          <Button className="h-11" onClick={() => setSellOpen(true)} disabled={templates.length === 0} data-testid="btn-vender-pacote">
            <Plus className="mr-1.5 h-4 w-4" /> Vender pacote
          </Button>
        )}
        {canSell && locked && (
          <Button asChild variant="outline" className="h-11" data-testid="btn-liberar-pacotes">
            <Link href="/admin/assinatura">
              <Lock className="mr-1.5 h-4 w-4" /> Vender pacote · planos pagos
            </Link>
          </Button>
        )}
      </div>

      {canSell && !locked && templates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Cadastre os modelos de pacote em <Link href="/admin/servicos" className="underline">Serviços</Link>.
        </p>
      )}

      {packages.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-muted-foreground">Nenhum pacote.</p>
      ) : (
        <ul className="space-y-3">
          {packages.map((p) => {
            const st = STATUS[p.effective_status];
            return (
              <li key={p.id} className="rounded-2xl border bg-card p-4" data-testid={`pacote-${p.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <Package className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{p.name}</p>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                        {p.fixed && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">Datas fixas</span>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {p.items.length > 1 ? `${p.items.length} serviços` : p.service_name} · {brl(p.price)} · vendido em {br(p.sold_at.slice(0, 10))}
                        {" · "}
                        {p.expires_at ? `vale até ${br(p.expires_at)}` : "sem validade"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-2xl">
                      {p.remaining}
                      <span className="text-base text-muted-foreground">/{p.sessions_total}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.remaining === 1 ? "sessão restante" : "sessões restantes"}</p>
                  </div>
                </div>

                {/* datas fixas: sessão que ficou sem data (conflito, cancelada ou saldo sobrando) */}
                {p.fixed && p.effective_status === "active" && p.remaining > 0 && (
                  <Link
                    href="/admin/agenda"
                    className="mt-3 flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
                    data-testid={`link-agendar-sem-data-${p.id}`}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      <strong>{p.remaining} {p.remaining === 1 ? "sessão sem data" : "sessões sem data"}</strong> — agendar
                      <span className="block text-xs">No novo agendamento, o pacote aparece ao informar o WhatsApp da cliente.</span>
                    </span>
                  </Link>
                )}

                {p.items.length > 1 && (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid={`saldo-servicos-${p.id}`}>
                    {p.items.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">{i.service_name}</span>
                        <span className="shrink-0">
                          <strong>{i.remaining}</strong>
                          <span className="text-muted-foreground">/{i.sessions_total} {i.remaining === 1 ? "restante" : "restantes"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {p.sessions.length > 0 && (
                  <ol className="mt-3 space-y-1 border-l-2 border-secondary pl-3 text-xs text-muted-foreground">
                    {p.sessions.map((s) => (
                      <li key={s.id}>
                        <span className="font-semibold text-foreground">{br(s.booking_date)} às {s.start_time.slice(0, 5)}</span>
                        {p.items.length > 1 && s.services.length > 0 && ` · ${s.services.join(" + ")}`}
                        {" · "}{s.professional_name} · {SESSION_STATUS[s.status] ?? s.status}
                      </li>
                    ))}
                  </ol>
                )}

                {canSell && p.effective_status !== "cancelled" && (
                  <div className="mt-3 flex justify-end border-t pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                      onClick={() => {
                        setCancelFuture(true);
                        setToCancel(p);
                      }}
                      data-testid={`btn-cancelar-pacote-${p.id}`}
                    >
                      Cancelar pacote
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SellPackageDialog open={sellOpen} onOpenChange={setSellOpen} customerId={customerId} templates={templates} professionals={professionals} />

      {/* Cancelar pacote: avisa que não há estorno automático */}
      <Dialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Cancelar pacote?</DialogTitle>
            <DialogDescription>
              {toCancel?.name} · restam {toCancel?.remaining} de {toCancel?.sessions_total} sessões.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            O valor não é estornado automaticamente. Se devolver dinheiro, lance a saída no Financeiro.
          </p>
          {toCancel && toCancel.future_count > 0 ? (
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                checked={cancelFuture}
                onChange={(e) => setCancelFuture(e.target.checked)}
                data-testid="check-cancelar-agendamentos-futuros"
              />
              <span>
                Cancelar também {toCancel.future_count === 1 ? "o agendamento futuro" : `os ${toCancel.future_count} agendamentos futuros`} deste pacote
                <span className="block text-xs text-muted-foreground">
                  Desmarcado, eles continuam na agenda e podem ser concluídos ou cancelados normalmente.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">Não há agendamentos futuros deste pacote.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="destructive" className="h-11" disabled={pending} onClick={confirmCancel} data-testid="btn-confirmar-cancelar-pacote">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancelar pacote"}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setToCancel(null)} data-testid="btn-voltar-cancelar-pacote">
              Voltar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type ProOption = SaleProfessional;

type RuleDraft = {
  key: number;
  professional_id: string;
  service_ids: string[];
  start_date: string;
  time: string;
  frequency: PlanFrequency;
  count: number;
};

/** Uma data da venda na tela: o que vai para o banco + se está aberta para trocar dia/horário */
type VisitDraft = PlanVisit & { key: number; editing: boolean };

const todaySP = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T12:00:00`).getDay()];

const proDoes = (p: ProOption | undefined, serviceId: string) => !p || p.serviceIds.length === 0 || p.serviceIds.includes(serviceId);

export function SellPackageDialog({
  open,
  onOpenChange,
  customerId,
  templates,
  professionals,
  onSold,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  templates: SaleTemplate[];
  professionals: ProOption[];
  /** venda concluída (Agenda: recarrega os pacotes do cliente e marca o novo) */
  onSold?: () => void;
}) {
  const [pending, start] = useTransition();
  const [templateId, setTemplateId] = useState("");
  const [method, setMethod] = useState<CashMethod | "">("");
  const [mode, setMode] = useState<"free" | "fixed">("free");
  const [rules, setRules] = useState<RuleDraft[]>([]);
  // 48_pacote_servicos_por_data: datas geradas pelas regras, com os serviços de cada uma
  const [visits, setVisits] = useState<VisitDraft[] | null>(null);
  // conferência do banco (horário, validade); null = precisa conferir de novo
  const [checks, setChecks] = useState<VisitCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const t = templates.find((x) => x.id === templateId);
  const total = t?.services.reduce((s, i) => s + i.sessions, 0) ?? 0;
  // validade contada a partir de hoje (o banco usa o fuso do espaço e confere de novo)
  const expires = t?.validity_days ? addDays(todaySP(), t.validity_days) : null;

  function reset() {
    setTemplateId("");
    setMethod("");
    setMode("free");
    setRules([]);
    setVisits(null);
    setChecks(null);
    setError(null);
  }

  /** mudou regra: as datas geradas saem (gera de novo) */
  function clearPlan() {
    setVisits(null);
    setChecks(null);
  }

  // até o saldo: o maior saldo entre os serviços da regra, sem passar do total do pacote
  function fillCount(r: RuleDraft, list: RuleDraft[]) {
    if (!t) return 1;
    const most = Math.max(1, ...t.services.filter((s) => r.service_ids.includes(s.id)).map((s) => s.sessions));
    const others = list.filter((x) => x.key !== r.key).reduce((s, x) => s + x.count, 0);
    return Math.max(1, Math.min(52, most, total - others));
  }

  function newRule(list: RuleDraft[]): RuleDraft {
    const pro = professionals[0];
    const svc = (t?.services ?? []).filter((s) => proDoes(pro, s.id)).map((s) => s.id);
    const r: RuleDraft = {
      key: nextKey,
      professional_id: pro?.id ?? "",
      service_ids: svc,
      start_date: todaySP(),
      time: "09:00",
      frequency: "weekly",
      count: 1,
    };
    setNextKey((k) => k + 1);
    return { ...r, count: fillCount(r, [...list, r]) };
  }

  function chooseMode(m: "free" | "fixed") {
    setMode(m);
    clearPlan();
    setError(null);
    if (m === "fixed" && rules.length === 0) setRules([newRule([])]);
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    setRules([]);
    clearPlan();
    setMode("free");
  }

  function update(key: number, patch: Partial<RuleDraft>) {
    clearPlan();
    setRules((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // trocou o profissional: tira os serviços que ele não faz
        if (patch.professional_id) {
          const p = professionals.find((x) => x.id === patch.professional_id);
          next.service_ids = next.service_ids.filter((s) => proDoes(p, s));
        }
        return next;
      })
    );
  }

  const toRules = (): PlanRule[] =>
    rules.map(({ professional_id, service_ids, start_date, time, frequency, count }) => ({
      professional_id,
      // na ordem do pacote: o primeiro marcado é o serviço principal da visita
      service_ids: (t?.services ?? []).map((s) => s.id).filter((id) => service_ids.includes(id)),
      start_date,
      time,
      frequency,
      count,
    }));

  function check(): string | null {
    if (!t) return "Escolha o pacote.";
    if (t.price > 0 && !method) return "Escolha a forma de pagamento.";
    if (mode === "fixed") {
      if (rules.length === 0) return "Adicione ao menos uma regra de datas.";
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const n = rules.length > 1 ? ` (regra ${i + 1})` : "";
        if (!r.professional_id) return `Escolha o profissional${n}.`;
        if (r.service_ids.length === 0) return `Marque ao menos um serviço${n}.`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start_date)) return `Escolha a 1ª data${n}.`;
        if (!/^\d{2}:\d{2}$/.test(r.time)) return `Escolha o horário${n}.`;
        if (!Number.isInteger(r.count) || r.count < 1 || r.count > 52) return `Quantidade de 1 a 52 visitas${n}.`;
      }
      const sum = rules.reduce((s, r) => s + r.count, 0);
      if (sum > Math.min(total, 100)) return `O total de visitas (${sum}) passa das ${total} sessões do pacote.`;
    }
    return null;
  }

  /** só o que vai para o banco (sem a chave e o estado da tela) */
  const toVisits = (list: VisitDraft[]): PlanVisit[] =>
    list.map(({ rule, date, time, professional_id, service_ids }) => ({ rule, date, time, professional_id, service_ids }));

  /** confere horário e validade de cada data no banco (nada é gravado) */
  function runCheck(list: VisitDraft[]) {
    if (!t) return;
    if (!list.some((v) => v.service_ids.length > 0)) {
      setChecks(null);
      return setError("Marque ao menos um serviço em alguma data.");
    }
    setError(null);
    start(async () => {
      const r = await previewPackageVisits(customerId, t.id, toVisits(list));
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) setChecks(r.checks);
      else setError(r.error);
    });
  }

  /** gera as datas das regras com a sugestão de serviços e já confere */
  function generate() {
    const msg = check();
    setError(msg);
    if (msg || !t) return;
    const list = suggestVisits(toRules(), t.services, expires, (pid, sid) =>
      proDoes(professionals.find((p) => p.id === pid), sid)
    ).map((v, i) => ({ ...v, key: i + 1, editing: false }));
    setVisits(list);
    setChecks(null);
    runCheck(list);
  }

  function patchVisit(key: number, patch: Partial<VisitDraft>) {
    setChecks(null);
    setVisits((list) =>
      (list ?? []).map((v) => {
        if (v.key !== key) return v;
        const next = { ...v, ...patch };
        // data depois da validade não leva serviço
        if (expires && next.date > expires) next.service_ids = [];
        return next;
      })
    );
  }

  function toggleVisitService(v: VisitDraft, serviceId: string, on: boolean) {
    const ids = on ? [...v.service_ids, serviceId] : v.service_ids.filter((x) => x !== serviceId);
    const order = (t?.services ?? []).map((s) => s.id);
    patchVisit(v.key, { service_ids: ids.sort((a, b) => order.indexOf(a) - order.indexOf(b)) });
  }

  function submit() {
    const msg = check();
    setError(msg);
    if (msg || !t) return;
    if (mode === "fixed" && (!visits || !checks)) return setError("Confira as datas antes de vender.");
    const m = t.price > 0 ? (method as CashMethod) : null;
    start(async () => {
      if (mode === "fixed" && visits) {
        const r = await sellPackageVisits(customerId, t.id, m, toVisits(visits), toRules());
        if (!r) return; // demonstração: o servidor redirecionou
        if (!r.ok) return setError(r.error);
        const made = `${r.created} ${r.created === 1 ? "visita agendada" : "visitas agendadas"}`;
        toast.success(r.skipped > 0 ? `Pacote vendido · ${made} · ${r.skipped} sem data` : `Pacote vendido · ${made}`);
      } else {
        const r = await sellPackage(customerId, t.id, m);
        if (!r) return; // demonstração: o servidor redirecionou
        if (!r.ok) return setError(r.error);
        toast.success(t.price > 0 ? "Pacote vendido e lançado no caixa" : "Pacote registrado");
      }
      reset();
      onOpenChange(false);
      onSold?.();
    });
  }

  // contador por serviço: marcadas nas datas × saldo do pacote
  const marked = visits ? markedCount(visits) : {};
  const counters = t ? t.services.map((s) => ({ ...s, left: Math.max(s.sessions - (marked[s.id] ?? 0), 0) })) : [];
  const leftovers = counters.filter((s) => s.left > 0);
  const issueOf = (i: number) => checks?.find((c) => c.idx === i)?.issue ?? null;
  const withServices = visits?.filter((v) => v.service_ids.length > 0).length ?? 0;
  const okCount = checks?.filter((c) => !c.issue).length ?? 0;
  const issueCount = checks?.filter((c) => c.issue).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">Vender pacote</DialogTitle>
          <DialogDescription>Pagamento presencial. O valor total entra no caixa uma vez, agora.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label>Pacote</Label>
            <Select value={templateId} onValueChange={chooseTemplate}>
              <SelectTrigger className="h-11" data-testid="select-vender-pacote"><SelectValue placeholder="Escolha o pacote" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {templates.map((x) => (
                  <SelectItem key={x.id} value={x.id}>{x.name} · {brl(x.price)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {t && (
              <p className="text-xs text-muted-foreground">
                {t.contents || `${t.sessions} sessões`} · {t.validity_days ? `validade de ${t.validity_days} dias a partir de hoje` : "sem validade"}
              </p>
            )}
          </div>

          {t && t.price > 0 && (
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(METHOD_LABEL) as CashMethod[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={method === m ? "default" : "outline"}
                    className="h-11"
                    onClick={() => setMethod(m)}
                    data-testid={`btn-pacote-forma-${m}`}
                  >
                    {METHOD_LABEL[m]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {t && (
            <div className="space-y-1.5">
              <Label>Como agendar</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={mode === "free" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => chooseMode("free")}
                  data-testid="btn-pacote-modo-livre"
                >
                  Livre
                </Button>
                <Button
                  type="button"
                  variant={mode === "fixed" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => chooseMode("fixed")}
                  disabled={professionals.length === 0}
                  data-testid="btn-pacote-modo-datas"
                >
                  <CalendarDays className="mr-1.5 h-4 w-4" /> Datas fixas
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "free"
                  ? "A cliente marca cada sessão quando quiser."
                  : "As visitas já ficam na agenda. Você escolhe quais serviços vão em cada data; o que sobrar fica no saldo."}
              </p>
            </div>
          )}

          {t && mode === "fixed" && (
            <div className="space-y-3">
              {rules.map((r, i) => {
                const pro = professionals.find((p) => p.id === r.professional_id);
                return (
                  <div key={r.key} className="min-w-0 space-y-3 rounded-xl border p-3" data-testid={`regra-pacote-${i}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Regra {i + 1}</p>
                      {rules.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="tap-target text-muted-foreground"
                          onClick={() => {
                            clearPlan();
                            setRules((list) => list.filter((x) => x.key !== r.key));
                          }}
                          data-testid={`btn-remover-regra-${i}`}
                        >
                          <Trash2 className="h-4 w-4" /> <span className="sr-only">Remover regra</span>
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Profissional</Label>
                      <Select value={r.professional_id} onValueChange={(v) => update(r.key, { professional_id: v })}>
                        <SelectTrigger className="h-11" data-testid={`select-regra-profissional-${i}`}><SelectValue placeholder="Escolha" /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {professionals.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Serviços na mesma visita</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {t.services.map((s) => {
                          const can = proDoes(pro, s.id);
                          return (
                            <label
                              key={s.id}
                              className={cn(
                                "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm",
                                !can && "cursor-not-allowed opacity-50"
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-5 w-5 shrink-0 accent-primary"
                                disabled={!can}
                                checked={r.service_ids.includes(s.id)}
                                onChange={(e) =>
                                  update(r.key, {
                                    service_ids: e.target.checked ? [...r.service_ids, s.id] : r.service_ids.filter((x) => x !== s.id),
                                  })
                                }
                                data-testid={`check-regra-servico-${i}-${s.id}`}
                              />
                              <span className="min-w-0 truncate">
                                {s.name} <span className="text-muted-foreground">· {s.sessions}×</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label htmlFor={`regra-data-${r.key}`}>1ª data</Label>
                        <Input
                          id={`regra-data-${r.key}`}
                          type="date"
                          className="h-11"
                          min={todaySP()}
                          value={r.start_date}
                          onChange={(e) => update(r.key, { start_date: e.target.value })}
                          data-testid={`input-regra-data-${i}`}
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label htmlFor={`regra-hora-${r.key}`}>Horário</Label>
                        <Input
                          id={`regra-hora-${r.key}`}
                          type="time"
                          step={300}
                          className="h-11"
                          value={r.time}
                          onChange={(e) => update(r.key, { time: e.target.value.slice(0, 5) })}
                          data-testid={`input-regra-hora-${i}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label>Frequência</Label>
                        <Select value={r.frequency} onValueChange={(v) => update(r.key, { frequency: v as RuleDraft["frequency"] })}>
                          <SelectTrigger className="h-11" data-testid={`select-regra-frequencia-${i}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FREQUENCY_LABEL) as RuleDraft["frequency"][]).map((f) => (
                              <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label htmlFor={`regra-qtd-${r.key}`}>Visitas</Label>
                        <Input
                          id={`regra-qtd-${r.key}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={52}
                          className="h-11"
                          value={r.count}
                          onChange={(e) => update(r.key, { count: Math.trunc(Number(e.target.value) || 0) })}
                          data-testid={`input-regra-quantidade-${i}`}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="link"
                      className="h-11 px-0"
                      onClick={() => update(r.key, { count: fillCount(r, rules) })}
                      data-testid={`btn-regra-preencher-${i}`}
                    >
                      Preencher até o saldo
                    </Button>
                  </div>
                );
              })}

              {rules.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => {
                    clearPlan();
                    setRules([...rules, newRule(rules)]);
                  }}
                  data-testid="btn-adicionar-regra"
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Adicionar regra
                </Button>
              )}

              <Button type="button" variant="secondary" className="h-11 w-full" disabled={pending} onClick={generate} data-testid="btn-ver-datas-pacote">
                {pending && !visits ? <Loader2 className="h-4 w-4 animate-spin" /> : visits ? "Gerar as datas de novo" : "Gerar datas"}
              </Button>

              {visits && t && (
                <div className="space-y-3" data-testid="previa-datas-pacote">
                  {/* contador por serviço: não deixa marcar além do saldo */}
                  <ul className="grid gap-2 sm:grid-cols-2" data-testid="contador-servicos-pacote">
                    {counters.map((s) => (
                      <li key={s.id} className="rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                        <span className="block truncate font-medium">{s.name}</span>
                        <span className={cn("text-muted-foreground", s.left === 0 && "text-green-700")}>
                          {s.left} de {s.sessions} restantes
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Sugestão espalhando os serviços entre as datas. Marque ou desmarque à vontade; mais de um serviço na mesma
                    data vira uma visita só.{expires && ` Vale até ${br(expires)}.`}
                  </p>

                  <ol className="space-y-2">
                    {visits.map((v, i) => {
                      const pro = professionals.find((p) => p.id === v.professional_id);
                      const late = !!expires && v.date > expires;
                      const issue = issueOf(i);
                      return (
                        <li
                          key={v.key}
                          className={cn(
                            "min-w-0 space-y-2 rounded-xl border p-3 text-sm",
                            issue && "border-amber-300 bg-amber-50/60",
                            v.service_ids.length === 0 && "bg-secondary/30"
                          )}
                          data-testid={`data-pacote-${i}`}
                        >
                          <div className="flex items-start gap-2">
                            {checks && v.service_ids.length > 0 ? (
                              issue ? (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                              ) : (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                              )
                            ) : (
                              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <p className="min-w-0 flex-1">
                              <span className="font-semibold">
                                {weekday(v.date)} {br(v.date)} às {v.time}
                              </span>
                              {pro && <span className="text-muted-foreground"> · {pro.name}</span>}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="tap-target -my-1 shrink-0 text-muted-foreground"
                              onClick={() =>
                                setVisits((list) => (list ?? []).map((x) => (x.key === v.key ? { ...x, editing: !x.editing } : x)))
                              }
                              aria-label={`Trocar dia ou horário de ${br(v.date)}`}
                              data-testid={`btn-trocar-data-pacote-${i}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>

                          {v.editing && (
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                type="date"
                                className="h-11"
                                min={todaySP()}
                                max={expires ?? undefined}
                                value={v.date}
                                onChange={(e) => e.target.value && patchVisit(v.key, { date: e.target.value })}
                                aria-label="Dia desta data"
                                data-testid={`input-data-pacote-${i}`}
                              />
                              <Input
                                type="time"
                                step={300}
                                className="h-11"
                                value={v.time}
                                onChange={(e) => e.target.value && patchVisit(v.key, { time: e.target.value.slice(0, 5) })}
                                aria-label="Horário desta data"
                                data-testid={`input-hora-pacote-${i}`}
                              />
                            </div>
                          )}

                          {late ? (
                            <p className="text-xs text-amber-800">
                              Depois da validade do pacote ({br(expires!)}): esta data não entra. Troque o dia ou deixe sem serviço.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {t.services.map((s) => {
                                const on = v.service_ids.includes(s.id);
                                const left = counters.find((c) => c.id === s.id)?.left ?? 0;
                                const can = proDoes(pro, s.id);
                                const disabled = !on && (!can || left <= 0);
                                return (
                                  <label
                                    key={s.id}
                                    className={cn(
                                      "flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border bg-white px-3",
                                      on && "border-primary",
                                      disabled && "cursor-not-allowed opacity-50"
                                    )}
                                    title={!can ? `${pro?.name ?? "O profissional"} não faz ${s.name}` : undefined}
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-5 w-5 shrink-0 accent-primary"
                                      checked={on}
                                      disabled={disabled}
                                      onChange={(e) => toggleVisitService(v, s.id, e.target.checked)}
                                      data-testid={`check-data-pacote-${i}-${s.id}`}
                                    />
                                    {s.name}
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          {v.service_ids.length === 0 && !late && (
                            <p className="text-xs text-muted-foreground">Sem serviço marcado: esta data não será criada.</p>
                          )}
                          {issue && v.service_ids.length > 0 && (
                            <p className="text-xs text-amber-800">
                              {SKIP_REASON[issue] ?? issue} — toque no lápis para trocar só esta data. Se ficar assim, ela é pulada.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>

                  {!checks && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      disabled={pending || withServices === 0}
                      onClick={() => runCheck(visits)}
                      data-testid="btn-conferir-datas-pacote"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Conferir horários"}
                    </Button>
                  )}

                  {leftovers.length > 0 && (
                    <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="aviso-sobra-pacote">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {leftovers.map((s) => `${s.left} ${s.name.toLowerCase()}`).join(" e ")} sem data. Fica no saldo para agendar depois.
                      </span>
                    </p>
                  )}
                  {checks && issueCount > 0 && (
                    <p className="text-xs text-amber-800">
                      {issueCount} {issueCount === 1 ? "data com problema será pulada" : "datas com problema serão puladas"} (a sessão fica no saldo).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button
            className="h-12 w-full text-base"
            disabled={pending || (mode === "fixed" && (!visits || !checks || okCount === 0))}
            onClick={submit}
            data-testid="btn-confirmar-venda-pacote"
          >
            {pending && (mode === "free" || checks) ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : mode === "fixed" && t ? (
              !visits
                ? "Gere as datas para vender"
                : !checks
                  ? "Confira os horários para vender"
                  : `Vender e agendar ${okCount} · ${brl(t.price)}`
            ) : t ? (
              `Confirmar venda · ${brl(t.price)}`
            ) : (
              "Confirmar venda"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
