-- =====================================================================
-- GENIX AGENDA — Storage "imagens": corrige as policies de storage.objects
-- Pode rodar inteira de uma vez (e de novo, sem erro), ANTES do merge.
-- Só recria policies (nada é apagado do bucket). Reversão no final.
--
-- Bug da 27: dentro de "exists (select 1 from businesses b where ...)",
-- o "name" sem prefixo é resolvido como b.name (o NOME do espaço, coluna
-- de businesses), e não como storage.objects.name (o caminho do arquivo).
-- A pasta comparada era o nome do espaço, nunca o id: todo upload caía em
-- "new row violates row-level security policy", e update/delete também
-- nunca casavam. Correção: qualificar como objects.name.
--
-- Também cria a policy de SELECT do dono (o remove() da foto antiga faz
-- select antes de apagar). Escopo: só a pasta do próprio espaço
-- ({business_id}/...). Visitantes continuam lendo pela URL pública
-- (bucket público não usa policy) e ninguém lista pastas de outros espaços.
-- A demonstração (viewer) não é owner: continua bloqueada.
-- =====================================================================

drop policy if exists "imagens: dono envia" on storage.objects;
create policy "imagens: dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(objects.name))[1] and is_business_owner(b.id)
    )
  );

drop policy if exists "imagens: dono atualiza" on storage.objects;
create policy "imagens: dono atualiza" on storage.objects for update to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(objects.name))[1] and is_business_owner(b.id)
    )
  )
  with check (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(objects.name))[1] and is_business_owner(b.id)
    )
  );

drop policy if exists "imagens: dono apaga" on storage.objects;
create policy "imagens: dono apaga" on storage.objects for delete to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(objects.name))[1] and is_business_owner(b.id)
    )
  );

drop policy if exists "imagens: dono vê" on storage.objects;
create policy "imagens: dono vê" on storage.objects for select to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from businesses b
      where b.id::text = (storage.foldername(objects.name))[1] and is_business_owner(b.id)
    )
  );


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; uploads voltam a falhar)
-- Volta às policies da 27 (com o bug) e remove a de SELECT.
-- =====================================================================
-- drop policy if exists "imagens: dono vê" on storage.objects;
-- e rodar de novo a PARTE 3 de 27_busca_nicho_fotos.sql
-- =====================================================================
