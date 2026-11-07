# Briefing para o Code — Nova landing page (SPIN Selling)

Protótipo aprovado: `docs/landing/prototipo-v5.html` (abrir no navegador; é a referência visual e de copy).

## Objetivo
Trocar a página de apresentação do produto pela nova landing page do protótipo v5, mantendo o visual, a copy e as animações aprovadas.

## Antes de começar
1. Ler o CLAUDE.md e localizar qual rota mostra hoje a apresentação do produto (lembrete: desde o PR #12, "/" é a página do profissional; confirmar onde está a landing atual).
2. Me apresentar o plano (rota, arquivos, componentes) ANTES de implementar. Não mudar nenhuma rota sem aprovação.

## Regras
- Copy centralizada no arquivo de copy do projeto (padrão do PR #18). Nada de texto solto nos componentes.
- Fontes e cores: usar as já configuradas no projeto (Playfair Display + DM Sans; paleta Warm Luxury). Não carregar fonte do Google Fonts como no protótipo.
- Logo: componente `src/components/brand-logo.tsx` (não usar a imagem em base64 do protótipo).
- Classes de cor/estilo do Tailwind não podem ficar em `src/lib`.
- Responsivo: 0 rolagem lateral, alvos de toque ≥ 44 px, conferir com `npm run test:responsivo` (filtrar a rota nova).
- Animações respeitam `prefers-reduced-motion`.
- Abrir PR com gh. Não fazer merge.

## Estrutura (na ordem)
1. **Barra superior fixa:** logo · links Recursos / Planos / Dúvidas (some no celular) · botão "Entrar" (contorno) → `https://genixagenda.com.br/admin/login` (usar a rota relativa `/admin/login`) · botão "Testar grátis" (preenchido) → cadastro atual.
2. **Hero (Situação):** título, subtítulo, campo e-mail/WhatsApp + "Testar 15 dias grátis", 3 microgarantias; mock de celular animado (agenda se monta, lembrete do WhatsApp, resposta "1", status vira Confirmado) + 2 cards flutuantes (somem < 600 px). Desktop: texto à esquerda, celular à direita; celular: uma coluna centralizada.
3. **Faixa de nichos** deslizando (marquee).
4. **P — Pergunta em destaque** + 4 cards de dor (só título e texto, sem ícone).
5. **I — Pergunta** (fundo escuro) + calculadora de faltas: faltas/semana × valor médio × 52 = perda/ano, e perda/mês.
6. **N — Pergunta** + comparação Hoje × Com a Genix Agenda.
7. **Como resolve:** 6 cards (linha da dor em marrom + título + texto, sem ícone).
8. **Depoimentos:** selo "5,0 ★★★★★ no Google" com link para o perfil + 3 avaliações reais (Renata Domingues, Carol Francioli, Alana), texto exatamente como no protótipo, avatar com a inicial.
9. **Planos:** botão Mensal/Anual; Grátis, Profissional (destaque escuro, "Mais escolhido"), Equipe. Valores vêm da fonte de planos do projeto (migrations 28A/28B), não fixos no componente. Linha: "Uma única falta evitada por mês já paga o plano Profissional."
10. **Perguntas frequentes** (acordeão, 4 perguntas).
11. **Fechamento (fundo escuro):** pergunta final + "Testar 15 dias grátis".
12. **Rodapé:** logo + "© {ano atual} Genix Agenda™. Todos os direitos reservados." (sem cidade e sem nome da empresa).

## Detalhes visuais
- Perguntas SPIN: selo redondo com a letra (P, I, N, ?), título grande em itálico, palavra-chave grifada em dourado.
- Espaçamento em múltiplos de 8 px; seções com 96 px de respiro (64 px no celular).
- Centralizado: perguntas, títulos de seção e chamadas. Alinhado à esquerda: cards, listas, planos e perguntas frequentes.
- Seções aparecem suavemente ao rolar (IntersectionObserver).

## A confirmar com o Leonardo
- O card do plano Profissional diz "Agendamentos ilimitados": confirmar se é verdade no sistema antes de publicar.
- SEO: manter title/description e entrada no sitemap da rota escolhida.
