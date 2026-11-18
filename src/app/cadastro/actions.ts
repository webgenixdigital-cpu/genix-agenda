"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isReferralCode, REFERRAL_COOKIE } from "@/lib/referral-public";

// ---------------------------------------------------------------------
// Indique e ganhe (56): logo depois de criar o espaço, vincula a quem indicou
// (código guardado no cookie pelo middleware). Só vale no cadastro: o banco
// confere o prazo, a autoindicação e se o espaço já foi indicado.
// Nunca atrapalha o cadastro: qualquer falha é ignorada.
// ---------------------------------------------------------------------
export async function attachReferral(): Promise<{ ok: true; status: string | null }> {
  const jar = cookies();
  const code = jar.get(REFERRAL_COOKIE)?.value;
  if (!isReferralCode(code)) return { ok: true, status: null };
  try {
    const { data } = await createClient().rpc("referral_attach", { p_code: code });
    return { ok: true, status: (data as string | null) ?? null };
  } catch {
    return { ok: true, status: null };
  } finally {
    jar.delete(REFERRAL_COOKIE);
  }
}
