-- =====================================================================
-- GENIX AGENDA — Diretório público com endereço (busca por bairro)
-- O endereço já é público na vitrine de cada espaço.
-- =====================================================================
create or replace view public_directory
with (security_invoker = true) as
select
  b.id, b.slug, b.name, b.segment, b.subcategory, b.tagline,
  b.city, b.state, b.logo_url, b.hero_image, b.whatsapp, b.whatsapp_message,
  coalesce(round(avg(r.rating)::numeric, 1), 0) as rating_avg,
  count(r.id)                                    as rating_count,
  (select min(s.price) from services s where s.business_id = b.id and s.active) as min_price,
  (select count(*)     from services s where s.business_id = b.id and s.active) as service_count,
  n.name as niche_name,
  n.icon as niche_icon,
  b.address
from businesses b
left join reviews r on r.business_id = b.id and r.visible
left join niches n on n.id = b.subcategory
where b.is_published
group by b.id, n.name, n.icon;

-- Conferência
select name, city, address from public_directory limit 5;
