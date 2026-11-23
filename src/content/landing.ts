// =====================================================================
// COPY DA LANDING PAGE ("/") — protótipo aprovado: docs/landing/prototipo-v6.html
// Todo texto da página mora aqui; os componentes em src/components/landing só desenham.
// Sem classes do Tailwind neste arquivo (a pasta não entra no `content` do Tailwind).
// Preços NÃO ficam aqui: vêm da tabela plans (getPublicPlans, migrations 28a/28b/52)
// e o preço de lançamento de launch_offer() (getLaunchOffer, migration 53).
// =====================================================================

import { FREE_MONTHS, PLAN_MICRO, PLAN_PROMISE, REFERRAL_TEXT, TRIAL_DAYS, planTag } from "@/content/planos";

/** Trecho de título com palavra grifada em dourado: [antes, grifo, depois] */
export type Marked = readonly [string, string, string];

export const LANDING_SEO = {
  title: "Genix Agenda | Agenda online e WhatsApp automático para quem atende com hora marcada",
  description:
    `Vitrine digital, agenda online e WhatsApp automático para salões, barbearias, estética e outros profissionais. Comece grátis: ${PLAN_PROMISE.trial}, sem cartão. Depois, agenda interna grátis por ${FREE_MONTHS} meses.`,
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
const LANDING_MICRO = PLAN_MICRO;

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

/** Etiquetas de plano dos cards: vêm do catálogo (src/content/planos.ts, FEATURES) */

export const LANDING_SOLUTION = {
  kicker: "Como resolve",
  title: "Cada recurso existe para acabar com uma dor",
  items: [
    {
      from: "Ajuda a reduzir as faltas",
      title: "WhatsApp automático",
      text: "Do seu número: confirmação do agendamento, lembrete na véspera, lembrete antes do horário e parabéns no aniversário. Com ritmo seguro, das 8h às 20h.",
      plan: planTag("whatsapp"),
    },
    {
      from: "Acaba com o WhatsApp à noite",
      title: "Vitrine aberta 24h",
      text: "Um link com serviços, fotos e só os horários livres. O cliente escolhe e agenda sozinho, a qualquer hora.",
      plan: planTag("vitrine"),
    },
    {
      from: "Seu link desde o primeiro dia",
      title: "Cartão de visita",
      text: "No Grátis e no Básico, seu link mostra serviços, preços, endereço, avaliações e o botão “Agendar pelo WhatsApp”.",
      plan: planTag("cartao"),
    },
    {
      from: "Acaba com o horário perdido",
      title: "Encaixe e encaixe sobreposto",
      text: "Encaixe um cliente entre horários ou durante a pausa de outro atendimento, como no tempo de ação da química.",
      plan: planTag("encaixe"),
    },
    {
      from: "Acaba com o cliente fixo esquecido",
      title: "Recorrência",
      text: "O cliente de toda semana ou de cada 15 dias já fica com os próximos horários marcados.",
      plan: planTag("recorrencia"),
    },
    {
      from: "Acaba com o cliente que some",
      title: "Retornos",
      text: "Uma lista de quem está na hora de voltar, para você chamar com um toque.",
      plan: planTag("retornos"),
    },
    {
      from: "Aumenta o valor de cada visita",
      title: "Pacotes, planos fechados e combos",
      text: "Venda 4 manicures + 2 pedicures com preço fechado, com datas livres ou já marcadas. O saldo baixa sozinho.",
      plan: planTag("pacotes"),
    },
    {
      from: "Acaba com as contas misturadas",
      title: "Caixa organizado",
      text: "Entradas e saídas por período, pagamentos pendentes, planilha para baixar e relatório para o contador.",
      plan: planTag("financeiro"),
    },
    {
      from: "Acaba com a ficha de papel",
      title: "Ficha do cliente",
      text: "Histórico de atendimentos, aniversário e telefone de qualquer país, tudo num lugar só.",
      plan: planTag("agenda"),
    },
    {
      from: "Organiza a equipe",
      title: "Equipe e comissões",
      text: "Acesso para recepção e profissionais, % de comissão por profissional e a estimativa de ganhos de cada um.",
      plan: planTag("comissoes"),
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

/** Planos: só a moldura. O que cada plano inclui vem de PLAN_CARDS (src/content/planos.ts);
 *  valores, nº de profissionais e preço de lançamento vêm do banco. */
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
    price: "R$ 0",
    per: `por ${FREE_MONTHS} meses · depois só consulta`,
  },
  pro: {
    badge: "Mais escolhido",
  },
  team: {
    extra: (price: string, per: string) => `+ ${price}${per} por profissional extra`,
  },
  /** linha abaixo dos cartões */
  trialNote: `Toda conta nova tem ${PLAN_PROMISE.trial}, sem cartão. ${PLAN_PROMISE.afterTrial}`,
  /** [negrito, resto] */
  referral: ["Indique e ganhe:", REFERRAL_TEXT.landing] as const,
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
      q: `O que acontece depois dos ${FREE_MONTHS} meses grátis?`,
      a: `Você escolhe um plano. ${PLAN_PROMISE.freeOver}`,
    },
    {
      q: "O cliente consegue agendar sozinho no plano Grátis?",
      a: `No Grátis e no Básico, seu link é um cartão de visita: o cliente vê serviços, preços e avaliações e chama você pelo botão do WhatsApp. A vitrine com agendamento online 24h vem no Profissional e no Equipe. No teste de ${TRIAL_DAYS} dias ela fica liberada.`,
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
