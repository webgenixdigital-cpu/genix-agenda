// Client do Supabase ANÔNIMO e SEM COOKIES (não lê a sessão de ninguém).
// USE SOMENTE PARA DADOS PÚBLICOS (plans, niches): é o que permite cache/ISR
// nas páginas públicas, porque não chama cookies().
// Nunca use para dados de um espaço, cliente ou usuário logado: para isso,
// use lib/supabase/server.ts (respeita a sessão e a RLS de quem está logado).
import { createClient } from "@supabase/supabase-js";

export function createPublicClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
