-- =====================================================================
-- GENIX AGENDA — 51: recepção também usa o encaixe sobreposto
-- Rode o arquivo inteiro no SQL Editor, ANTES do merge. Tudo dentro de
-- begin/commit: se qualquer comando falhar, nada fica aplicado.
-- Só AMPLIA permissão: o código atual continua funcionando com ela.
--
-- Regras (antes → depois):
--   • matriz (owner): qualquer agenda → igual
--   • recepção (reception): SEM_PERMISSAO → qualquer agenda (como a matriz)
--   • profissional (staff): só a própria agenda → igual
--   • demonstração (viewer) e quem não é do espaço: SEM_PERMISSAO → igual
--
-- Onde muda: a checagem de papel do encaixe sobreposto mora SÓ em
-- overlay_slot_issue (50, PARTE 4). overlay_booking_check,
-- create_overlay_booking e reschedule_overlay chamam essa função e não
-- olham o papel por conta própria, então ficam como na 50 e passam a
-- aceitar a recepção sozinhas. Corpo abaixo = cópia exata da 50; muda só
-- a linha do papel. Mesmas permissões (interna, sem execução pública).
-- O gatilho guard_booking_overlay não muda (barra overlay = true gravado
-- direto, fora das funções, para qualquer papel).
-- Reversão comentada no final.
-- =====================================================================

begin;

create or replace function overlay_slot_issue(
  p_business uuid, p_service uuid, p_professional uuid, p_date date, p_start time,
  p_duration int, p_ignore uuid default null
)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text := member_role_of(p_business);
  v_endm int;
  v_end  time;
  v_rng  tsrange;
begin
  if v_role in ('owner', 'reception') then   -- 51: recepção em qualquer agenda, como a matriz
    null;
  elsif v_role = 'staff' and p_professional = my_professional_id(p_business) then
    null;
  else
    return 'SEM_PERMISSAO';
  end if;

  if not exists (select 1 from professionals where id = p_professional and business_id = p_business and active) then
    return 'PROFISSIONAL_INDISPONIVEL';
  end if;
  if p_service is not null and not professional_does_service(p_professional, p_service) then
    return 'PROFISSIONAL_NAO_FAZ';
  end if;

  v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + p_duration;
  if p_duration is null or p_duration <= 0 or v_endm > 24 * 60 then return 'MEIA_NOITE'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);
  v_rng := tsrange(p_date + p_start, p_date + p_start + make_interval(mins => p_duration), '[)');

  if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;

  if exists (
    select 1 from bookings o
     where o.professional_id = p_professional and o.overlay
       and o.status in ('pending', 'confirmed')
       and o.id is distinct from p_ignore
       and o.period && v_rng
  ) then
    return 'JA_TEM_ENCAIXE';
  end if;

  if not exists (
    select 1 from bookings o
     where o.professional_id = p_professional and not o.overlay
       and o.status in ('pending', 'confirmed')
       and o.id is distinct from p_ignore
       and o.period && v_rng
  ) then
    return 'LIVRE';
  end if;

  return null;
end;
$$;

-- mesmas permissões da 50 (função interna)
revoke all on function overlay_slot_issue(uuid, uuid, uuid, date, time, int, uuid) from public, anon, authenticated;

commit;


-- =====================================================================
-- Conferência (depois do commit): deve aparecer 'reception' no corpo
-- =====================================================================
-- select position('''reception''' in prosrc) > 0 as recepcao_liberada
--   from pg_proc where proname = 'overlay_slot_issue';


-- =====================================================================
-- REVERSÃO (volta ao corpo da 50: recepção sem encaixe sobreposto)
-- Sobrepostos já criados pela recepção continuam na agenda; só deixa de
-- ser possível criar/remarcar novos pela recepção.
-- Reverta o código ANTES se o PR já estiver no ar (a tela mostraria a
-- opção e o banco responderia SEM_PERMISSAO).
-- =====================================================================
-- begin;
-- create or replace function overlay_slot_issue(
--   p_business uuid, p_service uuid, p_professional uuid, p_date date, p_start time,
--   p_duration int, p_ignore uuid default null
-- )
-- returns text
-- language plpgsql stable security definer set search_path = public
-- as $$
-- declare
--   v_role text := member_role_of(p_business);
--   v_endm int;
--   v_end  time;
--   v_rng  tsrange;
-- begin
--   if v_role = 'owner' then
--     null;
--   elsif v_role = 'staff' and p_professional = my_professional_id(p_business) then
--     null;
--   else
--     return 'SEM_PERMISSAO';
--   end if;
--
--   if not exists (select 1 from professionals where id = p_professional and business_id = p_business and active) then
--     return 'PROFISSIONAL_INDISPONIVEL';
--   end if;
--   if p_service is not null and not professional_does_service(p_professional, p_service) then
--     return 'PROFISSIONAL_NAO_FAZ';
--   end if;
--
--   v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + p_duration;
--   if p_duration is null or p_duration <= 0 or v_endm > 24 * 60 then return 'MEIA_NOITE'; end if;
--   v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);
--   v_rng := tsrange(p_date + p_start, p_date + p_start + make_interval(mins => p_duration), '[)');
--
--   if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;
--
--   if exists (
--     select 1 from bookings o
--      where o.professional_id = p_professional and o.overlay
--        and o.status in ('pending', 'confirmed')
--        and o.id is distinct from p_ignore
--        and o.period && v_rng
--   ) then
--     return 'JA_TEM_ENCAIXE';
--   end if;
--
--   if not exists (
--     select 1 from bookings o
--      where o.professional_id = p_professional and not o.overlay
--        and o.status in ('pending', 'confirmed')
--        and o.id is distinct from p_ignore
--        and o.period && v_rng
--   ) then
--     return 'LIVRE';
--   end if;
--
--   return null;
-- end;
-- $$;
-- revoke all on function overlay_slot_issue(uuid, uuid, uuid, date, time, int, uuid) from public, anon, authenticated;
-- commit;
-- =====================================================================
