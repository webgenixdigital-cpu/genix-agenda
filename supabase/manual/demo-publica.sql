-- =====================================================================
-- CONFIGURAÇÃO DA DEMONSTRAÇÃO PÚBLICA (já aplicada em produção)
-- Registro do que foi feito. NÃO é preciso rodar de novo.
-- Pré-requisito: usuário demo@genixagenda.com.br criado no Auth (senha só nas
-- variáveis DEMO_EMAIL / DEMO_PASSWORD do servidor).
-- =====================================================================

-- Lumina vira o espaço de demonstração
update businesses set is_demo = true where slug = 'luminabelle';

-- Usuário demo entra como "viewer" (somente leitura, trava no banco)
insert into business_members (business_id, user_id, role)
select b.id, u.id, 'viewer'
from businesses b, auth.users u
where b.slug = 'luminabelle' and u.email = 'demo@genixagenda.com.br'
on conflict (business_id, user_id) do update set role = 'viewer';

-- Contas do seed com senha aleatória (ninguém entra como dono dos espaços demo)
update auth.users
set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
where email in ('dona@lumina.com', 'dono@imperial.com', 'gestor@harmonize.com');
