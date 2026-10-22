// Client do Supabase com a chave de SERVIÇO (ignora RLS).
// USE SOMENTE NO SERVIDOR (server actions e route handlers).
// Nunca importe este arquivo num componente "use client".
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
