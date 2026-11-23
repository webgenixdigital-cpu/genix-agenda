-- =====================================================================
-- 62 — Slug compatível com subdomínio (link curto <slug>.genixagenda.com.br)
-- Aditiva e reversível (bloco de reversão no fim).
--
-- O formato já era garantido pela constraint slug_format (01): a-z, 0-9 e hífen,
-- sem hífen na ponta nem duplo, 3–40 letras — todo slug atual já é um rótulo de
-- DNS válido. Falta só barrar os novos nomes reservados de subdomínio:
-- wa, mail, email, blog, ajuda, status, cdn (os outros já estavam na lista).
--
-- ANTES de rodar, confira (só leitura) se algum espaço já usa um deles:
--   select id, slug, name from businesses
--    where slug in ('wa','mail','email','blog','ajuda','status','cdn');
-- Se aparecer algum, decida o novo slug antes. Esta migration NÃO muda slugs
-- existentes: o gatilho só confere quando o slug é criado ou trocado.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PARTE 1 — Lista única de reservados (mesma de src/lib/vitrine-url.ts)
-- ---------------------------------------------------------------------
create or replace function slug_is_reserved(p_slug text)
returns boolean
language sql immutable
set search_path = public
as $$
  select lower(coalesce(p_slug, '')) in (
    -- subdomínios
    'www','wa','app','api','genix','admin','painel','mail','email','blog',
    'ajuda','suporte','status','cdn','docs','static',
    -- rotas antigas
    'v','login','auth','assets','public','segmento'
  );
$$;

-- ---------------------------------------------------------------------
-- PARTE 2 — Gatilho: slug novo ou trocado não pode ser reservado
-- (o formato continua na constraint slug_format)
-- ---------------------------------------------------------------------
create or replace function guard_business_slug()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.slug is distinct from old.slug then
    if slug_is_reserved(new.slug) then
      raise exception 'SLUG_RESERVADO' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_business_slug on businesses;
create trigger guard_business_slug
  before insert or update of slug on businesses
  for each row execute function guard_business_slug();

-- ---------------------------------------------------------------------
-- PARTE 3 — Cadastro: mesmo corpo da 12, com a lista nova de reservados
-- (nome reservado = "espaco-xxxxxx", como já era)
-- ---------------------------------------------------------------------
create or replace function create_business_for_user(
  p_owner_name    text,
  p_business_name text,
  p_segment       business_segment,
  p_whatsapp      text,
  p_slug_base     text,
  p_niche         text default null
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_wa    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_base  text := left(regexp_replace(lower(coalesce(p_slug_base, '')), '[^a-z0-9-]', '', 'g'), 34);
  v_slug  text;
  v_n     int := 1;
  v_biz   uuid;
  v_niche text;
begin
  if v_uid is null then raise exception 'NAO_AUTENTICADO'; end if;
  if exists (select 1 from business_members where user_id = v_uid) then
    raise exception 'JA_POSSUI_ESPACO';
  end if;
  if char_length(trim(coalesce(p_owner_name, ''))) < 2
     or char_length(trim(coalesce(p_business_name, ''))) < 2
     or char_length(v_wa) not between 10 and 11 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- nicho só vale se existir, estiver ativo e for do mesmo segmento
  select id into v_niche from niches where id = p_niche and active and segment = p_segment;

  v_base := trim(both '-' from v_base);
  if char_length(v_base) < 3 or slug_is_reserved(v_base) then   -- 62: lista única
    v_base := 'espaco-' || substr(replace(v_uid::text, '-', ''), 1, 6);
  end if;
  v_slug := v_base;
  while exists (select 1 from businesses where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into businesses (owner_id, owner_name, slug, name, segment, subcategory, phone, whatsapp,
                          whatsapp_message, terms_accepted_at, hero_image)
  values (v_uid, trim(p_owner_name), v_slug, trim(p_business_name), p_segment, v_niche,
          '(' || left(v_wa, 2) || ') ' || substr(v_wa, 3, char_length(v_wa) - 6) || '-' || right(v_wa, 4),
          '55' || v_wa,
          'Olá! Vim pela sua vitrine e gostaria de agendar um horário.',
          now(), null)
  returning id into v_biz;

  update professionals set name = trim(p_owner_name)
   where business_id = v_biz and user_id = v_uid;

  insert into subscriptions (business_id, status, trial_ends_at)
  values (v_biz, 'trialing', now() + interval '15 days');

  return json_build_object('business_id', v_biz, 'slug', v_slug);
end;
$$;

revoke all on function create_business_for_user(text, text, business_segment, text, text, text) from public, anon;
grant execute on function create_business_for_user(text, text, business_segment, text, text, text) to authenticated;

commit;


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- Depois, rode de novo a PARTE 6 da 12_nichos.sql (create_business_for_user).
-- =====================================================================
-- begin;
-- drop trigger if exists guard_business_slug on businesses;
-- drop function if exists guard_business_slug();
-- drop function if exists slug_is_reserved(text);   -- só depois de voltar create_business_for_user
-- commit;
