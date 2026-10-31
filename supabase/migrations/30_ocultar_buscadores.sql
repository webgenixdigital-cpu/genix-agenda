-- =====================================================================
-- GENIX AGENDA — Ocultar espaços dos buscadores (Google)
-- Rodar ANTES do merge. Pode rodar de novo sem erro. Só acrescenta.
--
-- O que faz:
--   • businesses.search_hidden: a Genix tira um espaço do sitemap e marca a
--     vitrine com noindex (contas de teste, internas). Contas novas nascem
--     visíveis (false). Não muda nada na vitrine nem no agendamento.
--   • Gatilho: só o admin da plataforma muda a coluna (o dono, pela API,
--     não consegue destravar). SQL Editor/serviço (sem usuário) passa.
--   • genix_search_overview / genix_set_search_hidden: aba "Buscadores" do /genix.
--   • Marca como ocultos os espaços de teste que existem hoje.
-- O anônimo já lê a coluna pela política "public le vitrines publicadas"
-- (sem restrição por coluna): o sitemap usa o cliente público.
-- Reversão comentada no final.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Coluna
-- =====================================================================
alter table businesses
  add column if not exists search_hidden boolean not null default false;


-- =====================================================================
-- PARTE 2 — Gatilho: só o admin da plataforma muda search_hidden
-- =====================================================================
create or replace function guard_business_search_hidden()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.search_hidden is distinct from old.search_hidden
     and auth.uid() is not null
     and not is_platform_admin() then
    new.search_hidden := old.search_hidden;  -- ignora em silêncio (o resto do update segue)
  end if;
  return new;
end;
$$;

drop trigger if exists trg_businesses_search_hidden on businesses;
create trigger trg_businesses_search_hidden
  before update on businesses
  for each row execute function guard_business_search_hidden();


-- =====================================================================
-- PARTE 3 — Funções da aba "Buscadores" (/genix)
-- =====================================================================
create or replace function genix_search_overview()
returns table (
  business_id uuid, name text, slug text,
  is_published boolean, is_demo boolean, search_hidden boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, b.is_published, coalesce(b.is_demo, false), b.search_hidden
    from businesses b
   order by b.search_hidden, b.name;
end;
$$;

create or replace function genix_set_search_hidden(p_business_id uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  update businesses set search_hidden = p_hidden where id = p_business_id;
  if not found then raise exception 'ESPACO_NAO_ENCONTRADO'; end if;
end;
$$;

revoke all on function guard_business_search_hidden()             from public, anon, authenticated;
revoke all on function genix_search_overview()                    from public, anon;
revoke all on function genix_set_search_hidden(uuid, boolean)     from public, anon;
grant execute on function genix_search_overview()                 to authenticated;
grant execute on function genix_set_search_hidden(uuid, boolean)  to authenticated;


-- =====================================================================
-- PARTE 4 — Espaços de teste existentes ficam fora do Google
-- =====================================================================
update businesses set search_hidden = true
 where slug in ('luminabelle', 'barbearia-imperial', 'clinica-harmonize',
                'barbearia-do-leo', 'clinica-relax', 'marilash', 'jucelina-studio');


-- =====================================================================
-- PARTE 5 — Conferência (os 7 espaços acima com search_hidden = true)
-- =====================================================================
select slug, is_published, is_demo, search_hidden
  from businesses
 order by search_hidden desc, slug;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; antes, volte o código do PR)
-- drop function if exists genix_set_search_hidden(uuid, boolean);
-- drop function if exists genix_search_overview();
-- drop trigger if exists trg_businesses_search_hidden on businesses;
-- drop function if exists guard_business_search_hidden();
-- alter table businesses drop column if exists search_hidden;
-- =====================================================================
