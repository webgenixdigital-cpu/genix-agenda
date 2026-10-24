-- =====================================================================
-- GENIX AGENDA — E2.1: PAPÉIS (MATRIZ, RECEPÇÃO, PROFISSIONAL) E VISIBILIDADE
-- ATENÇÃO: rode a PARTE 1 SOZINHA primeiro. Depois rode da PARTE 2 ao fim.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Novo papel "reception" (Recepção) — RODE SOZINHA
-- =====================================================================
alter type member_role add value if not exists 'reception';


-- =====================================================================
-- PARTE 2 — Conferência antes de travar "1 login = 1 espaço"
-- (deve voltar VAZIO; se voltar alguma linha, pare e me avise)
-- =====================================================================
select user_id, count(*) as espacos
from business_members
group by user_id
having count(*) > 1;


-- =====================================================================
-- PARTE 3 — Funções de apoio
-- =====================================================================

-- 3.1 Papel do usuário logado neste espaço ('owner' | 'reception' | 'staff' | 'viewer' | null)
create or replace function member_role_of(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role::text from business_members
  where business_id = bid and user_id = auth.uid()
  limit 1;
$$;

-- 3.2 Profissional ligado ao usuário logado neste espaço
create or replace function my_professional_id(bid uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from professionals
  where business_id = bid and user_id = auth.uid()
  order by active desc, created_at
  limit 1;
$$;

-- 3.3 Vê a agenda de todos? (matriz, recepção e demonstração)
create or replace function sees_whole_agenda(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(member_role_of(bid) in ('owner', 'reception', 'viewer'), false);
$$;

-- 3.4 Pode alterar este agendamento? (matriz/recepção: todos; profissional: só os dele)
create or replace function can_manage_booking(bid uuid, pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    member_role_of(bid) in ('owner', 'reception')
    or (member_role_of(bid) = 'staff' and pid = my_professional_id(bid)),
    false
  );
$$;

grant execute on function member_role_of(uuid) to authenticated;
grant execute on function my_professional_id(uuid) to authenticated;


-- =====================================================================
-- PARTE 4 — Agendamentos
-- =====================================================================
drop policy if exists "membro le" on bookings;
drop policy if exists "editor insere" on bookings;
drop policy if exists "editor altera" on bookings;
drop policy if exists "editor exclui" on bookings;

create policy "ve agendamentos" on bookings
  for select to authenticated
  using (sees_whole_agenda(business_id) or can_manage_booking(business_id, professional_id));

create policy "cria agendamentos" on bookings
  for insert to authenticated
  with check (can_manage_booking(business_id, professional_id));

create policy "altera agendamentos" on bookings
  for update to authenticated
  using (can_manage_booking(business_id, professional_id))
  with check (can_manage_booking(business_id, professional_id));

create policy "exclui agendamentos" on bookings
  for delete to authenticated
  using (member_role_of(business_id) in ('owner', 'reception'));


-- =====================================================================
-- PARTE 5 — Bloqueios (recurso do Completo)
-- =====================================================================
drop policy if exists "membro le" on schedule_blocks;
drop policy if exists "completo insere" on schedule_blocks;
drop policy if exists "completo altera" on schedule_blocks;
drop policy if exists "completo exclui" on schedule_blocks;

create policy "ve bloqueios" on schedule_blocks
  for select to authenticated
  using (
    sees_whole_agenda(business_id)
    or (member_role_of(business_id) = 'staff'
        and (professional_id is null or professional_id = my_professional_id(business_id)))
  );

create policy "cria bloqueios" on schedule_blocks
  for insert to authenticated
  with check (
    access_tier(business_id) = 'completo'
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );

create policy "altera bloqueios" on schedule_blocks
  for update to authenticated
  using (
    access_tier(business_id) = 'completo'
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );

create policy "exclui bloqueios" on schedule_blocks
  for delete to authenticated
  using (
    access_tier(business_id) = 'completo'
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );


-- =====================================================================
-- PARTE 6 — Caixa: só a matriz (e a demonstração, só leitura)
-- =====================================================================
drop policy if exists "membro le" on cash_entries;
drop policy if exists "completo insere" on cash_entries;
drop policy if exists "completo altera" on cash_entries;
drop policy if exists "completo exclui" on cash_entries;

create policy "matriz ve caixa" on cash_entries
  for select to authenticated
  using (member_role_of(business_id) in ('owner', 'viewer'));

create policy "matriz lanca caixa" on cash_entries
  for insert to authenticated
  with check (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');

create policy "matriz altera caixa" on cash_entries
  for update to authenticated
  using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');

create policy "matriz exclui caixa" on cash_entries
  for delete to authenticated
  using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');


-- =====================================================================
-- PARTE 7 — Serviços, equipe e horários: todos veem, só a matriz altera
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array['services', 'professionals', 'business_hours'] loop
    execute format('drop policy if exists "editor insere" on %I', t);
    execute format('drop policy if exists "editor altera" on %I', t);
    execute format('drop policy if exists "editor exclui" on %I', t);
    execute format('create policy "matriz insere" on %I for insert to authenticated with check (is_business_owner(business_id))', t);
    execute format('create policy "matriz altera" on %I for update to authenticated using (is_business_owner(business_id)) with check (is_business_owner(business_id))', t);
    execute format('create policy "matriz exclui" on %I for delete to authenticated using (is_business_owner(business_id))', t);
  end loop;
end $$;

drop policy if exists "editor gerencia vinculos" on professional_services;
create policy "matriz gerencia vinculos" on professional_services
  for all to authenticated
  using (exists (select 1 from professionals p where p.id = professional_id and is_business_owner(p.business_id)))
  with check (exists (select 1 from professionals p where p.id = professional_id and is_business_owner(p.business_id)));

-- Avaliações: moderação só pela matriz, no Completo
drop policy if exists "completo modera avaliacoes" on reviews;
drop policy if exists "completo exclui avaliacoes" on reviews;
create policy "matriz modera avaliacoes" on reviews
  for update to authenticated
  using (is_business_owner(business_id) and access_tier(business_id) = 'completo')
  with check (is_business_owner(business_id) and access_tier(business_id) = 'completo');
create policy "matriz exclui avaliacoes" on reviews
  for delete to authenticated
  using (is_business_owner(business_id) and access_tier(business_id) = 'completo');


-- =====================================================================
-- PARTE 8 — Concluir atendimento (status + caixa juntos, com permissão)
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | FORMA_INVALIDA
-- =====================================================================
create or replace function complete_booking(p_booking uuid, p_method text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk bookings;
  v_cash boolean := false;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
    raise exception 'FORMA_INVALIDA';
  end if;

  update bookings set status = 'completed' where id = p_booking;

  -- lança no caixa só no Completo, com forma de pagamento e valor > 0 (1 vez por atendimento)
  if p_method is not null and bk.price > 0 and access_tier(bk.business_id) = 'completo' then
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
            bk.service_name || ' — ' || bk.customer_name, bk.price, bk.booking_date, auth.uid())
    on conflict (booking_id) where booking_id is not null do nothing;
    v_cash := found;
  end if;

  return json_build_object('ok', true, 'cash', v_cash);
end;
$$;

revoke all on function complete_booking(uuid, text) from public, anon;
grant execute on function complete_booking(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 9 — 1 login = 1 espaço
-- =====================================================================
create unique index if not exists business_members_one_business on business_members (user_id);


-- =====================================================================
-- PARTE 10 — Conferência
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings', 'schedule_blocks', 'cash_entries', 'services', 'professionals', 'business_hours')
order by tablename, cmd;
