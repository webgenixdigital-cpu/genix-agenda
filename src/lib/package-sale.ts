// Dados para vender um pacote: modelos ativos e profissionais (regras de datas fixas).
// Usado na ficha do cliente e no "Vender pacote" do agendamento manual da Agenda.
import type { createClient } from "@/lib/supabase/server";

export type SaleTemplate = {
  id: string;
  name: string;
  sessions: number;
  price: number;
  validity_days: number | null;
  /** "4× Manicure + 2× Pedicure" */
  contents: string;
  /** serviços do modelo, na ordem (regras de datas fixas) */
  services: { id: string; name: string; sessions: number }[];
};

export type SaleProfessional = { id: string; name: string; serviceIds: string[] };

type Client = ReturnType<typeof createClient>;
type TemplateItem = { service_id: string; sessions: number; position: number; services: { name: string } | null };

export async function loadSaleOptions(
  supabase: Client,
  businessId: string
): Promise<{ templates: SaleTemplate[]; professionals: SaleProfessional[] }> {
  const [{ data: templates }, { data: pros }] = await Promise.all([
    supabase
      .from("package_templates")
      .select("id, name, sessions, price, validity_days, package_template_items(service_id, sessions, position, services(name))")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("professionals")
      .select("id, name, professional_services(service_id)")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order"),
  ]);

  return {
    templates: (templates ?? []).map(({ package_template_items: its, ...t }) => {
      const items = [...((its ?? []) as unknown as TemplateItem[])].sort((a, b) => a.position - b.position);
      return {
        ...t,
        price: Number(t.price),
        services: items.map((i) => ({ id: i.service_id, name: i.services?.name ?? "serviço", sessions: i.sessions })),
        contents: items.map((i) => `${i.sessions}× ${i.services?.name ?? "serviço"}`).join(" + "),
      };
    }),
    professionals: ((pros ?? []) as unknown as { id: string; name: string; professional_services: { service_id: string }[] | null }[]).map(
      (p) => ({ id: p.id, name: p.name, serviceIds: (p.professional_services ?? []).map((l) => l.service_id) })
    ),
  };
}
