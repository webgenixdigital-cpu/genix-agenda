"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { isValidCpfCnpj, onlyDigits } from "@/lib/cpf-cnpj";
import { todayISO } from "@/lib/dates";
import { REGIMES, type TaxRegime } from "@/lib/faturamento";

type Result = { ok: true } | { ok: false; error: string };

const RESERVED = ["admin", "api", "v", "login", "auth", "static", "assets", "public", "docs",
  "app", "painel", "segmento", "genix", "www", "suporte"];
const SEGMENTS = ["beleza", "estetica", "psicologia_terapias", "outros"];

function refreshAll(slugs: string[]) {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  slugs.forEach((s) => revalidatePath(`/v/${s}`));
}

const NOT_OWNER = "Somente o dono do espaço pode alterar as configurações.";

// ---------------------------------------------------------------------
// PARTE 1 — Perfil e WhatsApp
// ---------------------------------------------------------------------
export async function updateProfile(input: {
  name: string;
  segment: string;
  subcategory: string;
  tagline: string;
  description: string;
  address: string;
  city: string;
  state: string;
  instagram: string;
  hero_image: string;
  whatsapp: string;          // como digitado: (35) 99999-0001
  whatsapp_message: string;
}): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: NOT_OWNER };
  const supabase = createClient();

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Informe o nome do espaço." };
  if (!SEGMENTS.includes(input.segment)) return { ok: false, error: "Escolha o segmento." };

  const digits = input.whatsapp.replace(/\D/g, "");
  if (digits && (digits.length < 10 || digits.length > 11)) {
    return { ok: false, error: "WhatsApp precisa ter DDD + número (10 ou 11 dígitos)." };
  }
  const hero = input.hero_image.trim();
  if (hero && !/^https:\/\//.test(hero)) return { ok: false, error: "O link da foto de capa precisa começar com https://" };

  const ig = input.instagram.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");

  const { error } = await supabase
    .from("businesses")
    .update({
      name,
      segment: input.segment,
      subcategory: input.subcategory.trim() || null,
      tagline: input.tagline.trim() || null,
      description: input.description.trim() || null,
      address: input.address.trim() || null,
      city: input.city.trim() || null,
      state: input.state.trim().toUpperCase().slice(0, 2) || null,
      instagram: ig ? `@${ig}` : null,
      hero_image: hero || null,
      phone: digits ? `(${digits.slice(0, 2)}) ${digits.slice(2, -4)}-${digits.slice(-4)}` : null,
      whatsapp: digits ? `55${digits}` : null,
      whatsapp_message: input.whatsapp_message.trim() || null,
    })
    .eq("id", business.id);

  if (error) return { ok: false, error: "Não foi possível salvar o perfil." };
  refreshAll([business.slug]);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Link da vitrine, domínio e publicação
// ---------------------------------------------------------------------
export async function updateLink(input: { slug: string; customDomain: string; isPublished: boolean }): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: NOT_OWNER };
  const supabase = createClient();

  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40) {
    return { ok: false, error: "Use de 3 a 40 letras minúsculas, números e hífen (sem espaço nem acento)." };
  }
  if (RESERVED.includes(slug)) return { ok: false, error: `“${slug}” é um endereço reservado do sistema.` };

  const domain = input.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
    return { ok: false, error: "Domínio inválido. Exemplo: agenda.seusalao.com.br" };
  }

  const { error } = await supabase
    .from("businesses")
    .update({ slug, custom_domain: domain || null, is_published: input.isPublished })
    .eq("id", business.id);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: error.message.includes("custom_domain")
          ? "Esse domínio já está em uso por outro espaço."
          : "Esse endereço já está em uso. Tente outro.",
      };
    }
    return { ok: false, error: "Não foi possível salvar o link." };
  }

  refreshAll([business.slug, slug]);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Horários e regras de agendamento
// ---------------------------------------------------------------------
export async function updateHours(input: {
  hours: { weekday: number; closed: boolean; open_time: string; close_time: string }[];
  slotStep: number;
  noticeMin: number;
}): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: NOT_OWNER };
  const supabase = createClient();

  for (const h of input.hours) {
    if (!h.closed && (!h.open_time || !h.close_time || h.close_time <= h.open_time)) {
      const days = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
      return { ok: false, error: `Confira o horário de ${days[h.weekday]}: o fechamento precisa ser depois da abertura.` };
    }
  }
  if (![10, 15, 20, 30, 60].includes(input.slotStep)) return { ok: false, error: "Intervalo inválido." };
  if (input.noticeMin < 0 || input.noticeMin > 10080) return { ok: false, error: "Antecedência inválida." };

  const { error: hErr } = await supabase.from("business_hours").upsert(
    input.hours.map((h) => ({
      business_id: business.id,
      weekday: h.weekday,
      closed: h.closed,
      open_time: h.closed ? null : h.open_time,
      close_time: h.closed ? null : h.close_time,
    })),
    { onConflict: "business_id,weekday" }
  );
  if (hErr) return { ok: false, error: "Não foi possível salvar os horários." };

  const { error } = await supabase
    .from("businesses")
    .update({ slot_step_min: input.slotStep, booking_notice_min: input.noticeMin })
    .eq("id", business.id);
  if (error) return { ok: false, error: "Não foi possível salvar as regras de agendamento." };

  refreshAll([business.slug]);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 4 — Enquadramento (faturamento e relatório para o contador)
// ---------------------------------------------------------------------
export async function updateFiscal(input: {
  regime: string;
  activityStart: string; // YYYY-MM-DD ou vazio
  cnpj: string;
  partnerSalon: boolean;
}): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: NOT_OWNER };
  const supabase = createClient();

  if (!REGIMES.includes(input.regime as TaxRegime)) return { ok: false, error: "Escolha o enquadramento." };
  const start = input.activityStart.trim();
  if (start && (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > todayISO())) {
    return { ok: false, error: "Confira a data de início das atividades." };
  }
  const cnpj = onlyDigits(input.cnpj);
  if (cnpj && (cnpj.length !== 14 || !isValidCpfCnpj(cnpj))) return { ok: false, error: "Confira os números do CNPJ." };

  const { error } = await supabase.from("business_fiscal").upsert(
    {
      business_id: business.id,
      regime: input.regime,
      activity_start: start || null,
      cnpj: cnpj || null,
      partner_salon: input.partnerSalon,
    },
    { onConflict: "business_id" }
  );
  if (error) return { ok: false, error: "Não foi possível salvar o enquadramento." };

  revalidatePath("/admin/configuracoes");
  revalidatePath("/admin/financeiro", "layout");
  revalidatePath("/admin/profissionais");
  return { ok: true };
}