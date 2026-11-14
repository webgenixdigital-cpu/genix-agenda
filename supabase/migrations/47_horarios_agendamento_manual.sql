-- =====================================================================
-- GENIX AGENDA — 47: horários livres no agendamento manual (painel)
-- O diálogo "Novo agendamento" passa a mostrar só os horários em que
-- PELO MENOS UM profissional que faz o serviço está livre, e depois só
-- os profissionais livres no horário escolhido.
--
-- SÓ LEITURA: uma função nova, nenhuma tabela, gatilho ou regra de
-- gravação muda (createManualBooking, recorrência, remarcar e pacote com
-- datas fixas continuam iguais).
--
-- Mesmas peças da vitrine (get_available_slots, 32): expediente do dia
-- (business_hours), passo slot_step_min, professional_does_service (combo:
-- todos os serviços), slot_conflicts_block (bloqueios pontuais E
-- recorrentes — almoço e folga semanal de um profissional são bloqueios
-- recorrentes) e agendamento pending/confirmed sobreposto.
-- Diferenças de propósito (regras que são só da vitrine): sem slug
-- publicado, sem bookable_online, sem antecedência mínima, sem limite
-- diário do Grátis, sem extra com cobrança bloqueada.
--
-- p_time null  → percorre o expediente; pula horários já passados.
-- p_time HH:MM → ENCAIXE: confere só esse horário, sem expediente e sem a
--                regra de "passado" (como o agendamento manual sempre
--                funcionou); mantém meia-noite, serviço, bloqueio e ocupado.
--
-- Quem vê o quê: matriz, recepção e demonstração (viewer) veem todos os
-- profissionais ativos; profissional (staff) vê só a própria agenda.
-- Erros: SEM_PERMISSAO | DADOS_INVALIDOS
--
-- Rode inteira de uma vez, ANTES do merge (só acrescenta). Reversão no final.
-- =====================================================================

begin;

create or replace function manual_booking_slots(
  p_business uuid, p_service uuid, p_date date, p_time text default null
)
returns table (slot_time text, professional_ids uuid[])
language plpgsql stable security definer set search_path = public
as $$
declare
  b      businesses;
  s      services;
  h      business_hours;
  v_now  timestamp;
  v_mine uuid;
  v_all  boolean;
  t      time;
  v_endm int;
  v_end  time;
  ids    uuid[];
begin
  if member_role_of(p_business) is null then raise exception 'SEM_PERMISSAO'; end if;
  if p_date is null or (p_time is not null and p_time !~ '^\d{2}:\d{2}$') then raise exception 'DADOS_INVALIDOS'; end if;

  select * into b from businesses where id = p_business;
  select * into s from services where id = p_service and business_id = p_business;
  if not found or s.duration_min is null then return; end if;

  v_all  := sees_whole_agenda(p_business);
  v_mine := my_professional_id(p_business);
  v_now  := now() at time zone b.timezone;

  if p_time is not null then
    -- encaixe: um horário só
    t := p_time::time;
    h := null;
  else
    select * into h from business_hours where business_id = p_business and weekday = extract(dow from p_date)::int;
    if not found or h.closed then return; end if;
    t := h.open_time;
  end if;

  loop
    v_endm := extract(hour from t)::int * 60 + extract(minute from t)::int + s.duration_min;
    exit when v_endm > 24 * 60;                                  -- passaria da meia-noite
    exit when p_time is null
          and v_endm > extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;
    v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

    if p_time is not null or (p_date + t) > v_now then
      select array_agg(p.id order by p.sort_order, p.name) into ids
        from professionals p
       where p.business_id = p_business
         and p.active
         and (v_all or p.id = v_mine)
         and professional_does_service(p.id, s.id)
         and not slot_conflicts_block(p_business, p.id, p_date, t, v_end)
         and not exists (
           select 1 from bookings bk
            where bk.professional_id = p.id
              and bk.status in ('pending', 'confirmed')
              and bk.period && tsrange(p_date + t, p_date + t + make_interval(mins => s.duration_min), '[)')
         );

      if ids is not null then
        slot_time        := to_char(t, 'HH24:MI');
        professional_ids := ids;
        return next;
      end if;
    end if;

    exit when p_time is not null;
    exit when t + make_interval(mins => b.slot_step_min) <= t;   -- virou o dia
    t := t + make_interval(mins => b.slot_step_min);
    exit when t >= h.close_time;
  end loop;
end;
$$;

revoke all on function manual_booking_slots(uuid, uuid, date, text) from public, anon;
grant execute on function manual_booking_slots(uuid, uuid, date, text) to authenticated;

commit;

-- Conferência
select proname from pg_proc where proname = 'manual_booking_slots';


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; o código anterior não usa a função)
-- =====================================================================
-- drop function if exists manual_booking_slots(uuid, uuid, date, text);
