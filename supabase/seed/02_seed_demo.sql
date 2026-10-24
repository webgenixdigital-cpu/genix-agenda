-- =====================================================================
-- GENIX AGENDA — ETAPA 1B: SEED DE DEMONSTRAÇÃO
-- Idempotente: pode rodar de novo quando quiser "resetar" a demo.
-- Datas são relativas a HOJE (fuso America/Sao_Paulo).
-- Rode PARTE por PARTE, em ordem (ou o arquivo inteiro de uma vez).
-- =====================================================================


-- =====================================================================
-- PARTE A — LIMPEZA DOS DADOS DEMO ANTERIORES
-- =====================================================================
delete from cash_entries where business_id in (select id from businesses where slug in ('luminabelle','barbearia-imperial','clinica-harmonize'));
delete from bookings     where business_id in (select id from businesses where slug in ('luminabelle','barbearia-imperial','clinica-harmonize'));
delete from businesses   where slug in ('luminabelle','barbearia-imperial','clinica-harmonize');


-- =====================================================================
-- PARTE B — SALÃO LUMINA BELLE (beleza / salão)
-- =====================================================================
do $$
declare
  v_owner uuid; v_biz uuid;
  p_renata uuid; p_camila uuid; p_bia uuid;
  s_corte uuid; s_escova uuid; s_mechas uuid; s_hidra uuid; s_mani uuid; s_pedi uuid;
begin
  select id into v_owner from auth.users where email = 'dona@lumina.com';
  if v_owner is null then raise exception 'Usuário dona@lumina.com não encontrado'; end if;

  insert into businesses (owner_id, slug, name, segment, subcategory, tagline, description,
    phone, whatsapp, whatsapp_message, address, city, state, instagram, hero_image)
  values (v_owner, 'luminabelle', 'Salão Lumina Belle', 'beleza', 'salao',
    'Cabelos com brilho, cuidado e personalidade',
    'Salão especializado em cortes, coloração e tratamentos capilares, com atendimento acolhedor e produtos profissionais.',
    '(35) 99999-0001', '5535999990001',
    'Olá, Lumina Belle! Gostaria de agendar um horário.',
    'Rua Assis Figueiredo, 120 - Centro', 'Poços de Caldas', 'MG', '@luminabelle',
    'https://images.unsplash.com/photo-1560869713-7d0a29430803?crop=entropy&cs=srgb&fm=jpg&q=85')
  returning id into v_biz;

  -- remove o profissional automático e define a equipe real
  delete from professionals where business_id = v_biz;

  update business_hours set open_time = '09:00', close_time = '19:00', closed = false
   where business_id = v_biz and weekday between 2 and 6;              -- ter a sáb
  update business_hours set open_time = '09:00', close_time = '17:00'
   where business_id = v_biz and weekday = 6;                          -- sábado
  update business_hours set open_time = null, close_time = null, closed = true
   where business_id = v_biz and weekday in (0, 1);                    -- dom e seg

  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Corte feminino', 'Corte personalizado com lavagem e finalização.', 'Cabelo', 120, 60, 1) returning id into s_corte;
  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Escova modelada', 'Escova com modelagem e proteção térmica.', 'Cabelo', 70, 45, 2) returning id into s_escova;
  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Mechas / Luzes', 'Mechas com técnica de iluminação natural.', 'Coloração', 380, 180, 3) returning id into s_mechas;
  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Hidratação profunda', 'Tratamento de reconstrução e brilho.', 'Tratamento', 90, 60, 4) returning id into s_hidra;
  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Manicure', 'Cutilagem, esmaltação e hidratação das mãos.', 'Unhas', 45, 45, 5) returning id into s_mani;
  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Pedicure', 'Cuidado completo dos pés com esmaltação.', 'Unhas', 50, 50, 6) returning id into s_pedi;

  insert into professionals (business_id, user_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, v_owner, 'Renata Alves', 'Hair stylist', 'Mais de 12 anos de experiência em cortes e finalização.', array['Cortes','Escova'], 0, 1)
    returning id into p_renata;
  insert into professionals (business_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, 'Camila Duarte', 'Colorista', 'Especialista em mechas, loiros e correção de cor.', array['Mechas','Coloração'], 40, 2)
    returning id into p_camila;
  insert into professionals (business_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, 'Bia Santos', 'Manicure', 'Unhas impecáveis com atenção a cada detalhe.', array['Manicure','Pedicure'], 50, 3)
    returning id into p_bia;

  insert into professional_services (professional_id, service_id) values
    (p_renata, s_corte), (p_renata, s_escova), (p_renata, s_hidra),
    (p_camila, s_mechas), (p_camila, s_hidra), (p_camila, s_escova),
    (p_bia, s_mani), (p_bia, s_pedi);
end $$;


-- =====================================================================
-- PARTE C — BARBEARIA IMPERIAL VINTAGE (beleza / barbearia)
-- =====================================================================
do $$
declare
  v_owner uuid; v_biz uuid;
begin
  select id into v_owner from auth.users where email = 'dono@imperial.com';
  if v_owner is null then raise exception 'Usuário dono@imperial.com não encontrado'; end if;

  insert into businesses (owner_id, slug, name, segment, subcategory, tagline, description,
    phone, whatsapp, whatsapp_message, address, city, state, instagram, hero_image)
  values (v_owner, 'barbearia-imperial', 'Barbearia Imperial Vintage', 'beleza', 'barbearia',
    'Tradição, navalha e estilo',
    'Barbearia clássica com cortes modernos, barba na toalha quente e ambiente vintage.',
    '(35) 99999-0002', '5535999990002',
    'Fala, Imperial! Quero agendar um horário.',
    'Av. Francisco Salles, 455 - Centro', 'Poços de Caldas', 'MG', '@imperialvintage',
    'https://images.unsplash.com/photo-1605497788044-5a32c7078486?crop=entropy&cs=srgb&fm=jpg&q=85')
  returning id into v_biz;

  delete from professionals where business_id = v_biz;

  update business_hours set open_time = '09:00', close_time = '20:00', closed = false
   where business_id = v_biz and weekday between 1 and 5;
  update business_hours set open_time = '08:00', close_time = '17:00', closed = false
   where business_id = v_biz and weekday = 6;

  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Corte masculino', 'Corte na tesoura ou máquina com finalização.', 'Cabelo', 50, 30, 1),
    (v_biz, 'Barba completa', 'Barba com toalha quente e navalha.', 'Barba', 40, 30, 2),
    (v_biz, 'Corte + Barba', 'Combo completo com desconto.', 'Combo', 80, 60, 3),
    (v_biz, 'Degradê navalhado', 'Degradê com acabamento na navalha.', 'Cabelo', 55, 40, 4),
    (v_biz, 'Sobrancelha', 'Alinhamento na navalha ou pinça.', 'Acabamento', 20, 15, 5);

  insert into professionals (business_id, user_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, v_owner, 'Rafael Moura', 'Barbeiro master', 'Fundador da Imperial, especialista em barba clássica.', array['Barba','Navalha'], 0, 1),
    (v_biz, null,    'Diego Lima',   'Barbeiro',        'Referência em degradês e cortes modernos.',           array['Degradê','Freestyle'], 45, 2);
  -- sem vínculos em professional_services = os dois atendem todos os serviços
end $$;


-- =====================================================================
-- PARTE D — CLÍNICA HARMONIZE ESTÉTICA (estética)
-- =====================================================================
do $$
declare
  v_owner uuid; v_biz uuid;
  p_juliana uuid; p_paula uuid;
begin
  select id into v_owner from auth.users where email = 'gestor@harmonize.com';
  if v_owner is null then raise exception 'Usuário gestor@harmonize.com não encontrado'; end if;

  insert into businesses (owner_id, slug, name, segment, subcategory, tagline, description,
    phone, whatsapp, whatsapp_message, address, city, state, instagram, hero_image)
  values (v_owner, 'clinica-harmonize', 'Clínica Harmonize Estética', 'estetica', 'clinica-estetica',
    'Sua pele em equilíbrio',
    'Estética facial e corporal com protocolos personalizados e ambiente tranquilo.',
    '(35) 99999-0003', '5535999990003',
    'Olá, Harmonize! Gostaria de agendar uma sessão.',
    'Rua Prefeito Chagas, 210 - Centro', 'Poços de Caldas', 'MG', '@harmonizeestetica',
    'https://images.unsplash.com/photo-1785861485926-93a13556d656?crop=entropy&cs=srgb&fm=jpg&q=85')
  returning id into v_biz;

  delete from professionals where business_id = v_biz;

  update business_hours set open_time = '08:00', close_time = '18:00', closed = false
   where business_id = v_biz and weekday between 1 and 5;
  update business_hours set open_time = '08:00', close_time = '12:00', closed = false
   where business_id = v_biz and weekday = 6;

  insert into services (business_id, name, description, category, price, duration_min, sort_order) values
    (v_biz, 'Limpeza de pele', 'Higienização profunda, extração e máscara calmante.', 'Facial', 180, 90, 1),
    (v_biz, 'Peeling de diamante', 'Renovação celular e uniformização do tom.', 'Facial', 250, 60, 2),
    (v_biz, 'Drenagem linfática', 'Redução de inchaço e sensação de leveza.', 'Corporal', 150, 60, 3),
    (v_biz, 'Massagem modeladora', 'Massagem vigorosa para contorno corporal.', 'Corporal', 160, 60, 4),
    (v_biz, 'Design de sobrancelhas', 'Design personalizado com henna opcional.', 'Sobrancelhas', 60, 40, 5);

  insert into professionals (business_id, user_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, v_owner, 'Juliana Prado', 'Esteticista', 'Especialista em estética facial e protocolos de skincare.', array['Facial','Sobrancelhas'], 0, 1)
    returning id into p_juliana;
  insert into professionals (business_id, name, role, bio, specialties, commission_pct, sort_order) values
    (v_biz, 'Paula Reis', 'Massoterapeuta', 'Drenagem e massagens com foco em bem-estar.', array['Corporal'], 40, 2)
    returning id into p_paula;

  insert into professional_services (professional_id, service_id)
  select p_juliana, id from services where business_id = v_biz and category in ('Facial','Sobrancelhas')
  union all
  select p_paula,   id from services where business_id = v_biz and category = 'Corporal';
end $$;


-- =====================================================================
-- PARTE E — BLOQUEIOS DE AGENDA
-- =====================================================================
do $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Lumina: férias da Camila (+7 a +9) e treinamento da equipe (+14, 12h–13h)
  insert into schedule_blocks (business_id, professional_id, date_start, date_end, reason)
  select b.id, p.id, v_today + 7, v_today + 9, 'Férias'
    from businesses b join professionals p on p.business_id = b.id
   where b.slug = 'luminabelle' and p.name = 'Camila Duarte';

  insert into schedule_blocks (business_id, professional_id, date_start, date_end, time_start, time_end, reason)
  select id, null, v_today + 14, v_today + 14, '12:00', '13:00', 'Treinamento da equipe'
    from businesses where slug = 'luminabelle';

  -- Imperial: folga semanal do Diego às segundas (recorrente por 6 meses)
  insert into schedule_blocks (business_id, professional_id, date_start, date_end, reason, recurring, weekdays)
  select b.id, p.id, v_today, v_today + 180, 'Folga semanal', true, array[1]::smallint[]
    from businesses b join professionals p on p.business_id = b.id
   where b.slug = 'barbearia-imperial' and p.name = 'Diego Lima';

  -- Harmonize: manutenção dos equipamentos (+10, dia inteiro, equipe toda)
  insert into schedule_blocks (business_id, professional_id, date_start, date_end, reason)
  select id, null, v_today + 10, v_today + 10, 'Manutenção dos equipamentos'
    from businesses where slug = 'clinica-harmonize';
end $$;


-- =====================================================================
-- PARTE F — AGENDAMENTOS (de 3 dias atrás até 5 dias à frente)
-- Respeita horário de funcionamento, bloqueios e serviços de cada
-- profissional. Conflitos de horário são descartados pela trava no_overlap.
-- =====================================================================
do $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_names text[] := array['Ana Paula Costa','Mariana Ribeiro','Fernanda Souza','Juliana Martins',
                          'Carlos Eduardo','Lucas Pereira','Gabriel Rocha','Patrícia Gomes',
                          'Beatriz Lima','Rodrigo Alves','Larissa Mendes','Thiago Barbosa',
                          'Camila Ferreira','Bruno Carvalho','Aline Teixeira','Vanessa Oliveira'];
  v_slots time[] := array['09:00','10:30','13:30','15:00','16:30']::time[];
  b record; p record; s record; h record;
  d int; v_day date; v_dow int; t time; v_end time;
  v_status booking_status; v_source booking_source; v_name text;
begin
  perform setseed(0.42);

  for b in select id from businesses where slug in ('luminabelle','barbearia-imperial','clinica-harmonize') loop
    for d in -3..5 loop
      v_day := v_today + d;
      v_dow := extract(dow from v_day)::int;
      select * into h from business_hours where business_id = b.id and weekday = v_dow;
      continue when h.closed;

      for p in select id, name from professionals where business_id = b.id and active loop
        foreach t in array v_slots loop
          continue when random() > 0.6;

          -- serviço aleatório que este profissional atende
          select sv.* into s from services sv
           where sv.business_id = b.id and sv.active
             and ( not exists (select 1 from professional_services ps where ps.professional_id = p.id)
                   or exists (select 1 from professional_services ps
                               where ps.professional_id = p.id and ps.service_id = sv.id) )
           order by random() limit 1;
          continue when s.id is null;

          v_end := t + make_interval(mins => s.duration_min);
          continue when t < h.open_time or v_end > h.close_time or v_end <= t;

          -- pula horários bloqueados
          continue when exists (
            select 1 from schedule_blocks k
             where k.business_id = b.id
               and (k.professional_id is null or k.professional_id = p.id)
               and v_day between k.date_start and k.date_end
               and (not k.recurring or v_dow = any(k.weekdays))
               and (k.time_start is null or (t < k.time_end and v_end > k.time_start))
          );

          v_status := case
            when d < 0 then (case when random() < 0.12 then 'cancelled' else 'completed' end)::booking_status
            when d = 0 then (case when random() < 0.7  then 'confirmed' else 'pending'   end)::booking_status
            else           (case when random() < 0.55 then 'pending'   else 'confirmed' end)::booking_status
          end;
          v_source := (array['online','online','whatsapp','manual'])[1 + floor(random()*4)::int]::booking_source;
          v_name   := v_names[1 + floor(random() * array_length(v_names, 1))::int];

          insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
            professional_name, customer_name, customer_phone, booking_date, start_time, end_time, status, source)
          values (b.id, s.id, p.id, s.name, s.price, s.duration_min,
            p.name, v_name, '(35) 9' || lpad((floor(random()*99999999))::text, 8, '0'),
            v_day, t, v_end, v_status, v_source)
          on conflict do nothing;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;


-- =====================================================================
-- PARTE G — CAIXA (atendimentos concluídos + 6 meses de histórico)
-- =====================================================================
do $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_methods text[] := array['pix','pix','credito','debito','dinheiro'];
  b record; m int; i int; v_month_start date;
begin
  perform setseed(0.17);

  -- 1) Entradas dos atendimentos concluídos
  insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date)
  select bk.business_id, bk.id, 'income', 'atendimento',
         (v_methods[1 + floor(random()*5)::int])::payment_method,
         bk.service_name || ' — ' || bk.customer_name, bk.price, bk.booking_date
    from bookings bk
    join businesses bz on bz.id = bk.business_id
   where bz.slug in ('luminabelle','barbearia-imperial','clinica-harmonize')
     and bk.status = 'completed' and bk.price > 0;

  -- 2) Histórico dos últimos 6 meses (mês atual + 5 anteriores)
  for b in select id, slug from businesses where slug in ('luminabelle','barbearia-imperial','clinica-harmonize') loop
    for m in 0..5 loop
      v_month_start := date_trunc('month', v_today - make_interval(months => m))::date;

      -- entradas avulsas de atendimentos
      for i in 1..(case when m = 0 then 12 else 35 end) loop
        insert into cash_entries (business_id, kind, category, method, description, amount, entry_date)
        values (b.id, 'income', 'atendimento', (v_methods[1 + floor(random()*5)::int])::payment_method,
                'Atendimento', round((40 + random() * 260)::numeric, 2),
                least(v_month_start + floor(random() * 28)::int, v_today - 4));
      end loop;

      -- saídas fixas e variáveis
      insert into cash_entries (business_id, kind, category, method, description, amount, entry_date) values
        (b.id, 'expense', 'aluguel',  'pix', 'Aluguel e condomínio', case b.slug when 'clinica-harmonize' then 3200 else 2400 end,
         least(v_month_start + 4, v_today)),
        (b.id, 'expense', 'produtos', 'credito', 'Reposição de produtos', round((350 + random()*600)::numeric, 2),
         least(v_month_start + 12, v_today)),
        (b.id, 'expense', 'comissao', 'pix', 'Comissões da equipe', round((900 + random()*1400)::numeric, 2),
         least(v_month_start + 25, v_today));
    end loop;
  end loop;
end $$;


-- =====================================================================
-- PARTE H — AVALIAÇÕES
-- =====================================================================
insert into reviews (business_id, author_name, rating, comment, created_at)
select b.id, r.author, r.rating, r.comment, now() - make_interval(days => r.days_ago)
from businesses b
join (values
  ('luminabelle',        'Mariana R.',  5, 'Amei o corte! A Renata entendeu exatamente o que eu queria.', 3),
  ('luminabelle',        'Fernanda S.', 5, 'Mechas perfeitas, a Camila é uma artista.', 12),
  ('luminabelle',        'Patrícia G.', 4, 'Ótimo atendimento, só atrasou um pouquinho.', 25),
  ('barbearia-imperial', 'Lucas P.',    5, 'Melhor barba da cidade, ambiente sensacional.', 5),
  ('barbearia-imperial', 'Gabriel R.',  5, 'Degradê impecável com o Diego.', 9),
  ('barbearia-imperial', 'Thiago B.',   4, 'Muito bom, agendamento online facilitou demais.', 30),
  ('clinica-harmonize',  'Beatriz L.',  5, 'Limpeza de pele maravilhosa, ambiente muito tranquilo.', 4),
  ('clinica-harmonize',  'Aline T.',    5, 'A drenagem com a Paula é incrível.', 15),
  ('clinica-harmonize',  'Vanessa O.',  4, 'Profissionais atenciosas, recomendo.', 40)
) as r(slug, author, rating, comment, days_ago) on r.slug = b.slug;


-- =====================================================================
-- PARTE I — CONFERÊNCIA
-- =====================================================================
select
  b.name,
  (select count(*) from services s         where s.business_id = b.id) as servicos,
  (select count(*) from professionals p    where p.business_id = b.id) as profissionais,
  (select count(*) from bookings bk        where bk.business_id = b.id) as agendamentos,
  (select count(*) from schedule_blocks k  where k.business_id = b.id) as bloqueios,
  (select count(*) from cash_entries c     where c.business_id = b.id) as lancamentos_caixa,
  (select count(*) from reviews r          where r.business_id = b.id) as avaliacoes
from businesses b
where b.slug in ('luminabelle','barbearia-imperial','clinica-harmonize')
order by b.name;
