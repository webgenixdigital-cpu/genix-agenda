// =====================================================================
// COPY DA LANDING PAGE ("/") — protótipo aprovado: docs/landing/prototipo-v5.html
// Todo texto da página mora aqui; os componentes em src/components/landing só desenham.
// Sem classes do Tailwind neste arquivo (a pasta não entra no `content` do Tailwind).
// Preços NÃO ficam aqui: vêm da tabela plans (getPublicPlans, migrations 28a/28b).
// =====================================================================

/** Trecho de título com palavra grifada em dourado: [antes, grifo, depois] */
export type Marked = readonly [string, string, string];

export const LANDING_SEO = {
  title: "Genix Agenda | Agenda online grátis e vitrine digital para profissionais",
  description:
    "Agenda online, vitrine digital e lembretes automáticos no WhatsApp para salões, barbearias, clínicas de estética e outros profissionais. Grátis para sempre para 1 profissional, sem cartão.",
};

export const LANDING_NAV = {
  ariaLabel: "Principal",
  links: [
    { href: "#recursos", label: "Recursos", testid: "link-nav-recursos" },
    { href: "#planos", label: "Planos", testid: "link-nav-planos" },
    { href: "#duvidas", label: "Dúvidas", testid: "link-nav-duvidas" },
  ],
  findSpace: { href: "/espacos", label: "Encontrar um espaço", short: "Espaços" },
  login: { href: "/admin/login", label: "Entrar" },
  signup: { href: "/cadastro", label: "Testar grátis" },
};

export const LANDING_HERO = {
  kicker: "Agenda online para beleza e bem-estar",
  title: ["Você atende, responde WhatsApp e cuida da agenda ", "ao mesmo tempo?"] as const,
  lead: "A Genix Agenda recebe os agendamentos, lembra seu cliente pelo WhatsApp e organiza seu financeiro, enquanto você faz o que sabe fazer.",
  inputPlaceholder: "Seu e-mail ou WhatsApp",
  cta: "Testar 15 dias grátis",
  micro: ["Sem cartão", "Pronto em minutos", "Plano grátis para sempre"],
};

/** Mock do celular (ilustração; nomes fictícios) */
export const LANDING_PHONE = {
  day: "Hoje · quinta",
  count: "3 atendimentos",
  slots: [
    { time: "09:00", service: "Corte + escova", customer: "Ana Souza" },
    { time: "10:30", service: "Manicure", customer: "Júlia Lima" },
    { time: "14:00", service: "Coloração", customer: "Bia Rocha" },
  ],
  confirmed: "Confirmado",
  pending: "Pendente",
  reminderLabel: "Lembrete automático · 08:12",
  reminderText: "Oi, Bia! Seu horário é hoje às 14h. Responda 1 para confirmar.",
  reply: "1 ✓✓",
  floats: [
    { value: "+12", label: "agendamentos online esta semana" },
    { value: "0", label: "faltas hoje" },
  ],
};

export const LANDING_NICHES = ["Salões", "Barbearias", "Manicures", "Estética", "Sobrancelha e cílios", "Massoterapia"];

export const LANDING_SPIN_TAG = "Pergunta";

export const LANDING_PROBLEM = {
  letter: "P",
  title: ["Quantas vezes nesta semana você ", "reservou um horário", " para alguém que não apareceu?"] as Marked,
  text: "Falta, WhatsApp à noite, buraco na agenda e contas misturadas: o dia a dia de quem atende sozinho ou com uma equipe pequena.",
  pains: [
    { title: "Cliente que não aparece", text: "Ela marcou, você reservou o horário e ela não veio, sem avisar." },
    { title: "WhatsApp até meia-noite", text: "“Tem horário sábado?” Responder um por um rouba sua noite." },
    { title: "Buracos na agenda", text: "Um cancelamento de última hora vira horário vazio que ninguém preenche." },
    { title: "Quanto sobrou no mês?", text: "Caderno, planilha e Pix misturados. No fim do mês, você não sabe se lucrou." },
  ],
};

export const LANDING_IMPLICATION = {
  letter: "I",
  title: ["Você já calculou ", "quanto dinheiro", " sai pela porta a cada falta?"] as Marked,
  text: "Coloque os seus números e veja o que poucas faltas por semana custam em um ano.",
  calc: {
    missesLabel: "Faltas por semana",
    priceLabel: "Valor médio do atendimento (R$)",
    resultLabel: "Você deixa de ganhar por ano",
    perMonth: "por mês",
    defaultMisses: 2,
    defaultPrice: 80,
    weeksPerYear: 52,
  },
};

export const LANDING_NEED = {
  letter: "N",
  title: ["E se a sua agenda ", "se preenchesse e lembrasse", " o cliente sozinha?"] as Marked,
  before: {
    title: "Hoje",
    items: ["Responder horários um por um", "Lembrar cliente manualmente", "Faltas sem aviso", "Financeiro no caderno"],
  },
  after: {
    title: "Com a Genix Agenda",
    items: [
      "Cliente agenda sozinho pelo seu link",
      "Lembrete automático no WhatsApp",
      "Confirmação com um toque",
      "Faturamento e relatório para o contador",
    ],
  },
};

export const LANDING_SOLUTION = {
  kicker: "Como resolve",
  title: "Cada recurso existe para acabar com uma dor",
  items: [
    { from: "Acaba com as faltas", title: "WhatsApp automático", text: "Lembretes do seu número, com textos variados e ritmo seguro, das 8h às 20h." },
    { from: "Acaba com o WhatsApp à noite", title: "Sua vitrine online", text: "Um link com serviços, fotos e horários livres para colocar na bio." },
    { from: "Acaba com o cliente que some", title: "Retornos e recorrência", text: "A Genix avisa quando é hora do cliente voltar." },
    { from: "Aumenta o valor de cada visita", title: "Pacotes e combos", text: "Venda sessões antecipadas e combos de serviços." },
    { from: "Acaba com as contas misturadas", title: "Financeiro simples", text: "Veja quanto entrou e gere o relatório para o contador." },
    { from: "Organiza a equipe", title: "Equipe e comissões", text: "Acessos separados, agenda por profissional e comissões." },
  ],
};

export const LANDING_PROOF = {
  kicker: "Quem já usa",
  title: "Profissionais que recuperaram o tempo",
  badge: {
    score: "5,0",
    label: "no Google",
    ariaLabel: "Nota 5,0 de 5 no Google (abre em nova aba)",
    href: "https://www.google.com/search?q=Genix+Sistemas+Integrativos&stick=H4sIAAAAAAAA_-NgU1IxqEhNNbE0NjAyNk0xSDIytbQyqEhKNEpMMzW2SDZJNDZJNjVfxCrtnpqXWaEQnFlckpqbWKzgmVeSml6UWJJZll8MAIwSJfNGAAAA&hl=pt-BR",
  },
  source: "Avaliação no Google",
  starsLabel: "5 de 5 estrelas",
  // Texto exatamente como publicado no Google (inclusive a grafia original)
  reviews: [
    {
      name: "Renata Domingues",
      text: "“Ele tem sido extremamente eficaz na organização dos meus agendamentos e facilita muito a rotina da clínica. (…) ele envia todas as informações de forma clara e organizada para os clientes, o que ajuda muito no atendimento e na confirmação dos horários.”",
    },
    {
      name: "Carol Francioli",
      text: "“Uso esse sistema a algum tempo, gosto muito, ele é bem completo, tem gestão Finaceira, histórico do cliente, agendamento e mensagens automáticas. Facilita muito o dia a dia da clínica, além de ter um acesso fácil de qualquer aparelho ou dispositivo!”",
    },
    {
      name: "Alana",
      text: "“Recomendo muito! Mudou minha organização e administração da empresa, os clientes se adaptaram e gostaram muito. Quería ter começado antes! O suporte é impecável, sempre me ajudou e resolveu minhas questões quando os chamo.”",
    },
  ],
};

/** Planos: só textos. Valores, limite do Grátis e nº de profissionais vêm da tabela plans. */
export const LANDING_PLANS = {
  kicker: "Planos",
  title: "Comece grátis. Cresça quando quiser.",
  toggleLabel: "Forma de pagamento",
  monthly: "Mensal",
  yearly: "Anual",
  yearlyBonus: "2 meses grátis",
  perMonth: "/mês",
  perYear: "/ano",
  free: {
    name: "Grátis",
    text: "Para começar a organizar a agenda.",
    price: "R$ 0",
    per: "para sempre",
    items: (limit: number) => [`${limit} agendamentos online por dia`, "1 profissional", "Confirmação automática", "Lembretes manuais"],
    cta: "Criar conta grátis",
  },
  pro: {
    badge: "Mais escolhido",
    name: "Profissional",
    text: "Tudo liberado para quem atende sozinho.",
    yearlyEquivalent: (perMonth: string) => `equivale a ${perMonth}/mês`,
    items: ["WhatsApp automático", "Retornos, pacotes e combos", "Financeiro e faturamento", "Agendamentos online ilimitados"],
    cta: "Testar 15 dias grátis",
  },
  team: {
    name: "Equipe",
    text: (included: number) => `Para salões com até ${included} profissionais.`,
    extra: (price: string, per: string) => `+ ${price}${per} por profissional extra`,
    items: ["Tudo do Profissional", "Acessos por profissional", "Comissões", "Salão-parceiro"],
    cta: "Testar 15 dias grátis",
  },
  roi: ["Uma única falta evitada por mês ", "já paga o plano Profissional", "."] as Marked,
};

export const LANDING_FAQ = {
  kicker: "Dúvidas",
  title: "Perguntas frequentes",
  items: [
    { q: "Meu cliente precisa baixar algum aplicativo?", a: "Não. Ele agenda pelo seu link, direto no navegador do celular." },
    { q: "Os lembretes saem do meu WhatsApp?", a: "Sim. Você conecta seu número por QR Code, e o envio segue um ritmo seguro, com textos variados." },
    { q: "É difícil configurar?", a: "Você cadastra serviços e horários em poucos minutos, e a configuração inicial guia cada passo." },
    { q: "Posso cancelar quando quiser?", a: "Sim, sem multa. E o plano Grátis continua disponível." },
  ],
};

export const LANDING_CLOSING = {
  letter: "?",
  tag: "Última pergunta",
  title: ["Quanto tempo você quer ", "continuar perdendo", " com faltas e mensagens?"] as Marked,
  cta: "Testar 15 dias grátis",
  micro: ["Sem cartão", "Cancele quando quiser"],
};

export const LANDING_FOOTER = {
  copyright: (year: number) => `© ${year} Genix Agenda™. Todos os direitos reservados.`,
  ariaLabel: "Links institucionais",
  links: [
    { href: "/termos", label: "Termos de Uso", testid: "link-rodape-termos" },
    { href: "/privacidade", label: "Privacidade", testid: "link-rodape-privacidade" },
  ],
  contact: "Contato",
};

/** Chave do sessionStorage: o hero guarda o e-mail/WhatsApp e o /cadastro pré-preenche (sem URL) */
export const SIGNUP_PREFILL_KEY = "genix:cadastro-contato";
