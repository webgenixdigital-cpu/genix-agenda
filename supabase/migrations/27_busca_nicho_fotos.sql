-- =====================================================================
-- GENIX AGENDA — Sinônimos dos nichos + fotos no Supabase Storage
-- Pode rodar inteira de uma vez (e de novo, sem erro), ANTES do merge.
-- Só acrescenta. Reversão comentada no final.
--
-- PARTE 1: niches.keywords (sinônimos usados na busca da /espacos,
--          editáveis no /genix).
-- PARTE 2: bucket público "imagens" (capa do espaço e fotos da equipe).
--          Os arquivos chegam JÁ comprimidos do navegador (WebP, ou JPEG
--          no Safari que não gera WebP), até 1 MB.
-- PARTE 3: escrita só do dono (owner), na pasta {business_id}/...
--          Leitura: pela URL pública do bucket (sem policy de select,
--          então ninguém lista as pastas).
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Sinônimos dos nichos (sem acento, minúsculas)
-- =====================================================================
alter table niches add column if not exists keywords text[] not null default '{}';

-- seleção inicial: só preenche quem ainda está sem palavras-chave
update niches n
set keywords = v.k
from (values
  ('salao',            array['cabelo', 'cabeleireiro', 'cabeleireira', 'corte', 'escova', 'coloracao', 'mechas']),
  ('barbearia',        array['barba', 'barbeiro', 'corte masculino']),
  ('unhas',            array['manicure', 'pedicure', 'esmalte', 'gel', 'alongamento']),
  ('sobrancelhas',     array['sobrancelha', 'henna', 'brow']),
  ('lash',             array['cilios', 'extensao de cilios', 'lash lifting']),
  ('maquiagem',        array['make', 'maquiadora', 'noiva']),
  ('clinica-estetica', array['estetica', 'limpeza de pele', 'facial', 'drenagem', 'peeling']),
  ('depilacao',        array['cera', 'depilar', 'buco']),
  ('massagem',         array['spa', 'relaxante', 'massoterapia']),
  ('tattoo',           array['tatuagem', 'tatuador', 'piercing']),
  ('personal',         array['treino', 'academia'])
) as v(id, k)
where n.id = v.id and n.keywords = '{}';


-- =====================================================================
-- PARTE 2 — Bucket público "imagens"
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- =====================================================================
-- PARTE 3 — Escrita só do dono, na pasta do próprio espaço
-- A pasta é comparada como texto (pasta inválida não gera erro de uuid).
-- A demonstração (viewer) não é owner: fica bloqueada aqui também.
-- =====================================================================
drop policy if exists "imagens: dono envia" on storage.objects;
create policy "imagens: dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(name))[1] and is_business_owner(b.id)
    )
  );

drop policy if exists "imagens: dono atualiza" on storage.objects;
create policy "imagens: dono atualiza" on storage.objects for update to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(name))[1] and is_business_owner(b.id)
    )
  )
  with check (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(name))[1] and is_business_owner(b.id)
    )
  );

drop policy if exists "imagens: dono apaga" on storage.objects;
create policy "imagens: dono apaga" on storage.objects for delete to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(name))[1] and is_business_owner(b.id)
    )
  );


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; antes, volte o código)
-- Atenção: apagar o bucket apaga as fotos enviadas. As colunas hero_image
-- e photo_url continuam com as URLs, que deixam de abrir.
-- =====================================================================
-- drop policy if exists "imagens: dono envia" on storage.objects;
-- drop policy if exists "imagens: dono atualiza" on storage.objects;
-- drop policy if exists "imagens: dono apaga" on storage.objects;
-- delete from storage.objects where bucket_id = 'imagens';
-- delete from storage.buckets where id = 'imagens';
-- alter table niches drop column if exists keywords;
-- =====================================================================
