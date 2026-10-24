# Banco de dados (Supabase)

## migrations/
Histórico completo do banco, **na ordem em que foi aplicado em produção** (01 → 17).
Todas já estão aplicadas no projeto Supabase de produção.

- Não existe o arquivo 02: ele é o seed de demonstração (ver `seed/`).
- Algumas migrations têm uma PARTE 1 que precisa rodar **sozinha** (ex.: `alter type ... add value`).
  Isso está indicado no topo de cada arquivo.
- Novas mudanças: criar `18_nome.sql`, `19_nome.sql`... sempre **aditivas e reversíveis**.
  Nada destrutivo (drop de tabela/coluna, delete em massa) sem autorização explícita.

## seed/02_seed_demo.sql
Dados de demonstração (Lumina, Imperial, Harmonize).
**NÃO rodar em produção:** ele apaga e recria os espaços demo e desfaz a configuração da demonstração pública.
Uso apenas em um banco novo de desenvolvimento.

## manual/
Comandos aplicados à mão em produção, guardados como registro (ex.: demonstração pública).

## Templates de e-mail
Ficam em `/supabase-templates` (raiz do repositório) e são colados em
Supabase → Authentication → Emails → Templates. Os links usam `token_hash` (funcionam em outro aparelho).
