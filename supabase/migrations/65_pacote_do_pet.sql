-- =====================================================================
-- 65 — Pacote do pet (nicho "Banho e tosa")
-- Aditiva e reversível (bloco de reversão no fim).
--
-- A venda continua pelas funções de sempre (sell_package*, sem mudança).
-- Logo depois da venda, a tela chama set_package_pet para dizer de qual pet
-- é o pacote. Ela grava customer_packages.pet_id e liga ao pet as sessões
-- que a venda já marcou na agenda (pacote com datas fixas).
-- Quem pode: matriz e recepção (as mesmas que vendem pacote).
-- O gatilho trg_zz_guard_package_pet (64) confere pet ↔ tutor.
-- =====================================================================

begin;

create function set_package_pet(p_package uuid, p_pet uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid;
begin
  select business_id into v_bid from customer_packages where id = p_package;
  if v_bid is null then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(v_bid), '') not in ('owner', 'reception') then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- o gatilho do 64 recusa pet de outro tutor ou de outro espaço
  update customer_packages set pet_id = p_pet where id = p_package;

  -- sessões já marcadas pela venda (datas fixas) passam a ser deste pet
  update bookings set pet_id = p_pet
   where customer_package_id = p_package
     and business_id = v_bid
     and pet_id is null;
end $$;

revoke execute on function set_package_pet(uuid, uuid) from public, anon;
grant execute on function set_package_pet(uuid, uuid) to authenticated;

commit;

-- =====================================================================
-- REVERSÃO (só com autorização; os pet_id já gravados ficam)
-- =====================================================================
-- begin;
-- drop function if exists set_package_pet(uuid, uuid);
-- commit;
