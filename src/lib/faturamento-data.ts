// Leituras do faturamento (só no servidor)
import { createClient } from "@/lib/supabase/server";
import {
  EMPTY_FISCAL, addMonthsKey, buildReport, lastDayOf, pickLimit,
  type BillingRow, type FiscalProfile, type RevenueLimit,
} from "@/lib/faturamento";

export async function loadFiscal(businessId: string): Promise<FiscalProfile> {
  const { data } = await createClient()
    .from("business_fiscal")
    .select("regime, activity_start, partner_salon, cnpj")
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as FiscalProfile | null) ?? EMPTY_FISCAL;
}

export async function loadLimits(): Promise<RevenueLimit[]> {
  const { data } = await createClient()
    .from("revenue_limits")
    .select("id, regime, basis, annual_limit, first_year_monthly, sublimit, valid_from")
    .order("regime")
    .order("valid_from", { ascending: false });
  return ((data ?? []) as RevenueLimit[]).map((l) => ({
    ...l,
    annual_limit: Number(l.annual_limit),
    first_year_monthly: l.first_year_monthly == null ? null : Number(l.first_year_monthly),
    sublimit: l.sublimit == null ? null : Number(l.sublimit),
  }));
}

/** Tudo o que o relatório para o contador precisa (from/to: YYYY-MM) */
export async function loadAccountantReport(businessId: string, from: string, to: string, today: string) {
  const [fiscal, limits, rows] = await Promise.all([
    loadFiscal(businessId),
    loadLimits(),
    loadBilling(businessId, `${addMonthsKey(from, -12)}-01`, lastDayOf(to)),
  ]);
  return {
    fiscal,
    limit: pickLimit(limits, fiscal.regime, today),
    report: buildReport(rows, from, to, fiscal.partner_salon),
  };
}

/** fromISO / toISO: YYYY-MM-DD */
export async function loadBilling(businessId: string, fromISO: string, toISO: string): Promise<BillingRow[]> {
  const { data } = await createClient().rpc("billing_monthly", { p_business: businessId, p_from: fromISO, p_to: toISO });
  return ((data ?? []) as BillingRow[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    partner_amount: Number(r.partner_amount),
  }));
}
