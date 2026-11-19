// =====================================================================
// COPY DA LANDING PAGE ("/") — protótipo aprovado: docs/landing/prototipo-v6.html
// Todo texto da página mora aqui; os componentes em src/components/landing só desenham.
// Sem classes do Tailwind neste arquivo (a pasta não entra no `content` do Tailwind).
// Preços NÃO ficam aqui: vêm da tabela plans (getPublicPlans, migrations 28a/28b/52)
// e o preço de lançamento de launch_offer() (getLaunchOffer, migration 53).
// =====================================================================

/** Trecho de título com palavra grifada em dourado: [antes, grifo, depois] */
export type Marked = readonly [string, string, string];

export const LANDING_SEO = {
  title: "Genix Agenda | Agenda online e WhatsApp automático para quem atende com hora marcada",
  description:
    "Vitrine digital, agenda online e WhatsApp automático para salões, barbearias, estética e outros profissionais. Comece grátis: 6 meses no plano Grátis, 15 dias com tudo liberado, sem cartão.",
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
  signup: { href: "/cadastro", label: "Começar grátis" },
};

/** Microgarantias do hero e do fechamento */
const LANDING_MICRO = ["Sem cartão", "6 meses grátis", "15 dias com tudo liberado"];

export const LANDING_HERO = {
  kicker: "Genix Agenda · Sua agenda trabalha. Você atende.",
  title: ["Você atende, responde WhatsApp e cuida da agenda ", "ao mesmo tempo?"] as const,
  lead: "A Genix Agenda recebe os agendamentos, lembra seu cliente pelo WhatsApp e organiza o seu caixa, enquanto você faz o que sabe fazer.",
  inputPlaceholder: "Seu e-mail ou WhatsApp",
  cta: "Começar grátis",
  micro: LANDING_MICRO,
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
  reminderLabel: "Lembrete automático · 12:30",
  reminderText: "Oi, Bia! Passando para lembrar do seu horário hoje às 14h, com a Carla. Até já! 💛",
  floats: [
    { value: "+12", label: "agendamentos online esta semana" },
    { value: "4 tipos", label: "de mensagem automática" },
  ],
};

export const LANDING_NICHES = ["Salões", "Barbearias", "Manicures", "Estética", "Sobrancelha e cílios", "Massoterapia", "Tatuagem", "Personal trainer"];

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

/** Etiquetas de plano dos cards (conferidas com plan_allows/plan_kind e as travas do painel) */
const PLAN_TAG = {
  all: "Todos os planos",
  basic: "A partir do Básico",
  pro: "Profissional e Equipe",
  team: "Equipe",
};

export const LANDING_SOLUTION = {
  kicker: "Como resolve",
  title: "Cada recurso existe para acabar com uma dor",
  items: [
    {
      from: "Ajuda a reduzir as faltas",
      title: "WhatsApp automático",
      text: "Do seu número: confirmação do agendamento, lembrete na véspera, lembrete antes do horário e parabéns no aniversário. Com ritmo seguro, das 8h às 20h.",
      plan: PLAN_TAG.pro,
    },
    {
      from: "Acaba com o WhatsApp à noite",
      title: "Vitrine aberta 24h",
      text: "Um link com serviços, fotos e só os horários livres. O cliente escolhe e agenda sozinho, a qualquer hora.",
      plan: PLAN_TAG.all,
    },
    {
      from: "Acaba com o horário perdido",
      title: "Encaixe e encaixe sobreposto",
      text: "Encaixe um cliente entre horários ou durante a pausa de outro atendimento, como no tempo de ação da química.",
      plan: PLAN_TAG.basic,
    },
    {
      from: "Acaba com o cliente fixo esquecido",
      title: "Recorrência",
      text: "O cliente de toda semana ou de cada 15 dias já fica com os próximos horários marcados.",
      plan: PLAN_TAG.basic,
    },
    {
      from: "Acaba com o cliente que some",
      title: "Retornos",
      text: "Uma lista de quem está na hora de voltar, para você chamar com um toque.",
      plan: PLAN_TAG.pro,
    },
    {
      from: "Aumenta o valor de cada visita",
      title: "Pacotes, planos fechados e combos",
      text: "Venda 4 manicures + 2 pedicures com preço fechado, com datas livres ou já marcadas. O saldo baixa sozinho.",
      plan: PLAN_TAG.pro,
    },
    {
      from: "Acaba com as contas misturadas",
      title: "Caixa organizado",
      text: "Entradas e saídas por período, pagamentos pendentes, planilha para baixar e relatório para o contador.",
      plan: PLAN_TAG.basic,
    },
    {
      from: "Acaba com a ficha de papel",
      title: "Ficha do cliente",
      text: "Histórico de atendimentos, aniversário e telefone de qualquer país, tudo num lugar só.",
      plan: PLAN_TAG.all,
    },
    {
      from: "Organiza a equipe",
      title: "Equipe e comissões",
      text: "Acesso para recepção e profissionais, % de comissão por profissional e a estimativa de ganhos de cada um.",
      plan: PLAN_TAG.team,
    },
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

/** Planos: só textos. Valores, limite do Grátis, nº de profissionais e preço de lançamento vêm do banco. */
export const LANDING_PLANS = {
  kicker: "Planos",
  title: "Comece grátis. Cresça quando quiser.",
  /** aviso do topo (some quando o prazo do cupom passa) */
  launchNotice: (end: string, months: number) =>
    `Preço de lançamento no Profissional e no Equipe para quem assinar até ${end}, por ${months} meses.`,
  /** linha abaixo do preço com desconto */
  launchPer: (months: number) => `preço de lançamento por ${months} meses`,
  toggleLabel: "Forma de pagamento",
  monthly: "Mensal",
  yearly: "Anual",
  yearlyBonus: "2 meses grátis",
  perMonth: "/mês",
  perYear: "/ano",
  cta: "Começar grátis",
  yearlyEquivalent: (perMonth: string) => `equivale a ${perMonth}/mês`,
  free: {
    name: "Grátis",
    text: "Para conhecer e organizar a agenda.",
    price: "R$ 0",
    per: "por 6 meses · 15 dias com tudo liberado",
    items: (limit: number) => [
      "1 profissional",
      `${limit} agendamentos online por dia`,
      "Agenda, ficha do cliente e vitrine",
      "Avaliações dos clientes",
    ],
  },
  basic: {
    name: "Básico",
    text: "Agenda completa para quem atende sozinho.",
    items: [
      "Agendamentos online ilimitados",
      "Encaixe e encaixe sobreposto",
      "Recorrência e bloqueios",
      "Lembretes da véspera com um toque",
      "Caixa e financeiro",
    ],
  },
  pro: {
    badge: "Mais escolhido",
    name: "Profissional",
    text: "Tudo liberado para 1 profissional.",
    items: ["Tudo do Básico", "WhatsApp automático (ativação assistida)", "Retornos, pacotes e combos", "Planos fechados com datas marcadas"],
  },
  team: {
    name: "Equipe",
    text: (included: number) => `Para salões com até ${included} profissionais.`,
    extra: (price: string, per: string) => `+ ${price}${per} por profissional extra`,
    items: ["Tudo do Profissional", "Acessos para recepção e equipe", "% de comissão por profissional", "Salão-parceiro"],
  },
  /** [negrito, resto] */
  referral: ["Indique e ganhe:", " a cada espaço indicado que assinar, você ganha 1 mês grátis."] as const,
  roi: ["Uma única falta evitada por mês ", "já paga o plano Básico", "."] as Marked,
};

/** Pergunta do preço de lançamento: só entra no FAQ enquanto o cupom está no prazo */
export const LANDING_FAQ_LAUNCH = (end: string, months: number) => ({
  q: "Como funciona o preço de lançamento?",
  a: `Quem assinar o Profissional ou o Equipe até ${end} paga o preço de lançamento por ${months} meses. O desconto entra sozinho, sem cupom para digitar.`,
});

export const LANDING_FAQ = {
  kicker: "Dúvidas",
  title: "Perguntas frequentes",
  /** posição da pergunta do preço de lançamento (LANDING_FAQ_LAUNCH) na lista */
  launchIndex: 3,
  items: [
    { q: "Meu cliente precisa baixar algum aplicativo?", a: "Não. Ele agenda pelo seu link, direto no navegador do celular." },
    {
      q: "Quais mensagens saem pelo WhatsApp automático?",
      a: "Confirmação do agendamento, lembrete na véspera, lembrete antes do horário (1h, 1h30 ou 2h) e parabéns no aniversário. Você liga só as que quiser. O envio sai do seu número, num ritmo seguro, e a ativação é feita junto com a nossa equipe.",
    },
    {
      q: "O que acontece depois dos 6 meses grátis?",
      a: "Você escolhe um plano. Se não assinar, seu painel, seus dados e o agendamento manual continuam funcionando; só a vitrine deixa de receber agendamentos online.",
    },
    {
      q: "É difícil começar?",
      a: "Você cadastra serviços e horários em poucos minutos, e a configuração inicial guia cada passo. Os botões de ajuda explicam cada tela.",
    },
    { q: "Posso cancelar quando quiser?", a: "Sim, sem multa." },
  ],
};

export const LANDING_CLOSING = {
  letter: "?",
  tag: "Última pergunta",
  title: ["Quanto tempo você quer ", "continuar perdendo", " com faltas e mensagens?"] as Marked,
  cta: "Começar grátis",
  micro: LANDING_MICRO,
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
