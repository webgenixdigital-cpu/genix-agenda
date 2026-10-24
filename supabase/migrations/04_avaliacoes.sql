-- =====================================================================
-- GENIX AGENDA — AVALIAÇÕES PÓS-ATENDIMENTO
-- Rode o arquivo inteiro no SQL Editor do Supabase.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Avaliação ligada ao atendimento (1 avaliação por atendimento)
-- =====================================================================
alter table reviews
  add column if not exists booking_id uuid unique references bookings(id) on delete set null;

-- remove o envio livre de avaliações (agora só pelo link do atendimento)
drop policy if exists "public envia avaliacao" on reviews;


-- =====================================================================
-- PARTE 2 — Dados para a página de avaliação (/v/slug/avaliar/id)
-- =====================================================================
create or replace function get_review_context(p_booking uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'business_name',     b.name,
    'slug',              b.slug,
    'hero_image',        b.hero_image,
    'service_name',      bk.service_name,
    'professional_name', bk.professional_name,
    'booking_date',      bk.booking_date,
    'first_name',        split_part(trim(bk.customer_name), ' ', 1),
    'status',            bk.status,
    'already_reviewed',  exists (select 1 from reviews r where r.booking_id = bk.id)
  )
  from bookings bk
  join businesses b on b.id = bk.business_id
  where bk.id = p_booking;
$$;


-- =====================================================================
-- PARTE 3 — Enviar avaliação
-- Erros: AVALIACAO_INVALIDA | ATENDIMENTO_NAO_CONCLUIDO | DADOS_INVALIDOS | JA_AVALIADO
-- =====================================================================
create or replace function submit_review(p_booking uuid, p_rating int, p_comment text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_parts text[];
  v_name  text;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'AVALIACAO_INVALIDA'; end if;
  if bk.status <> 'completed' then raise exception 'ATENDIMENTO_NAO_CONCLUIDO'; end if;
  if p_rating is null or p_rating not between 1 and 5
     or char_length(coalesce(p_comment, '')) > 600 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- "Mariana Ribeiro Souza" → "Mariana S."
  v_parts := regexp_split_to_array(trim(bk.customer_name), '\s+');
  v_name  := v_parts[1];
  if array_length(v_parts, 1) > 1 then
    v_name := v_name || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;
  if char_length(v_name) < 2 then v_name := 'Cliente'; end if;

  begin
    insert into reviews (business_id, booking_id, author_name, rating, comment)
    values (bk.business_id, bk.id, left(v_name, 60), p_rating, nullif(trim(p_comment), ''));
  exception when unique_violation then
    raise exception 'JA_AVALIADO';
  end;

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 4 — Permissões
-- =====================================================================
grant execute on function get_review_context(uuid) to anon, authenticated;
grant execute on function submit_review(uuid, int, text) to anon, authenticated;


-- =====================================================================
-- PARTE 5 — TESTE: um atendimento concluído do Lumina, para usar no link
-- =====================================================================
select bk.id as booking_id, bk.customer_name, bk.service_name, bk.booking_date
from bookings bk
join businesses b on b.id = bk.business_id
where b.slug = 'luminabelle' and bk.status = 'completed'
order by bk.booking_date desc
limit 1;
