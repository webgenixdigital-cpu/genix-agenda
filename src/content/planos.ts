// =====================================================================
// PLANOS — FONTE ÚNICA dos textos de "o que cada plano inclui" (migration 59).
// Lido por: tabela comparativa (Assinatura), cartões de preço da "/" e da /para,
// etiquetas da landing e dos blocos de benefícios, cadeados (LOCKED_FEATURES),
// menu (lockedHrefsFor), ajuda (planNote), banners, Termos e textos de prazo.
//
// Preços NÃO ficam aqui: vêm da tabela plans (getPublicPlans) e do preço de
// lançamento de launch_offer() (getLaunchOffer). Nº de profissionais do Equipe:
// plans.max_professionals/included_professionals.
//
// A regra de verdade é o banco: plan_allows(bid, mínimo) e vitrine_online_allowed
// (59). Mudou o plano mínimo de um recurso? Mude AQUI e no banco.
// Sem classes do Tailwind neste arquivo (fica fora do content do Tailwind).
// =====================================================================

export type PlanKind = "gratis" | "basico" | "profissional" | "equipe";
export type MinPlan = Exclude<PlanKind, "gratis">;

export const PLAN_ORDER: readonly PlanKind[] = ["gratis", "basico", "profissional", "equipe"];

export const PLAN_NAMES: Record<PlanKind, string> = {
  gratis: "Grátis",
  basico: "Básico",
  profissional: "Profissional",
  equipe: "Equipe",
};

/** Mesma ordem de plan_rank no banco (migration 52) */
export const PLAN_RANK: Record<PlanKind, number> = { gratis: 0, basico: 1, profissional: 2, equipe: 3 };

/** Duração do Grátis (meses a partir do cadastro) */
export const FREE_MONTHS = 6;
/** Teste do Equipe de toda conta nova */
export const TRIAL_DAYS = 15;

// ---------------------------------------------------------------------
// Catálogo de recursos: plano mínimo de cada um
// ---------------------------------------------------------------------
export type FeatureKey =
  | "agenda"
  | "editar"
  | "cartao"
  | "avaliacoes"
  | "vitrine"
  | "diretorio"
  | "confirmacao"
  | "pedidoAvaliacao"
  | "semSelo"
  | "encaixe"
  | "bloqueios"
  | "lembretes"
  | "recorrencia"
  | "financeiro"
  | "faturamento"
  | "retornos"
  | "pacotes"
  | "combos"
  | "metas"
  | "whatsapp"
  | "equipe"
  | "acessos"
  | "comissoes"
  | "parceiro"
  | "nix";

export type Feature = {
  /** texto da tabela comparativa */
  label: string;
  /** plano mínimo (gratis = todos) */
  min: PlanKind;
};

export const FEATURES: Record<FeatureKey, Feature> = {
  agenda: { label: "Agenda interna, clientes, ficha e histórico", min: "gratis" },
  editar: { label: "Remarcar, editar e trocar o serviço do agendamento", min: "gratis" },
  cartao: { label: "Cartão de visita: link com serviços, preços e botão do WhatsApp", min: "gratis" },
  avaliacoes: { label: "Avaliações dos clientes no seu link", min: "gratis" },
  semSelo: { label: "Sem o selo “Feito com Genix Agenda”", min: "basico" },
  lembretes: { label: "Lembretes de véspera (fila em um toque)", min: "basico" },
  financeiro: { label: "Financeiro: caixa e pagamentos pendentes", min: "basico" },
  faturamento: { label: "Faturamento e relatório para o contador", min: "basico" },
  // 67: encaixe, bloqueios e recorrência saíram do Básico
  encaixe: { label: "Encaixe e encaixe sobreposto", min: "profissional" },
  bloqueios: { label: "Bloqueios: almoço, folgas, férias e feriados", min: "profissional" },
  recorrencia: { label: "Agendamentos recorrentes", min: "profissional" },
  vitrine: { label: "Vitrine com agendamento online 24h e QR Code", min: "profissional" },
  diretorio: { label: "Aparece no diretório de espaços do Genix Agenda", min: "profissional" },
  confirmacao: { label: "Confirmação automática dos agendamentos online", min: "profissional" },
  pedidoAvaliacao: { label: "Pedido de avaliação depois do atendimento", min: "profissional" },
  retornos: { label: "Retornos (hora de voltar)", min: "profissional" },
  pacotes: { label: "Pacotes de sessões", min: "profissional" },
  combos: { label: "Combos de serviços", min: "profissional" },
  metas: { label: "Metas de faturamento, atendimentos e clientes", min: "profissional" },
  whatsapp: { label: "WhatsApp automático (ativação assistida)", min: "profissional" },
  equipe: { label: "Mais de 1 profissional", min: "equipe" },
  acessos: { label: "Acessos da equipe e “Meus ganhos”", min: "equipe" },
  comissoes: { label: "Comissões por profissional", min: "equipe" },
  parceiro: { label: "Salão-parceiro no faturamento", min: "equipe" },
  nix: { label: "Nix, assistente que tira dúvidas do sistema", min: "equipe" },
};

/** O plano inclui o recurso? (mesma regra de plan_allows) */
export const featureIn = (key: FeatureKey, kind: PlanKind) => PLAN_RANK[kind] >= PLAN_RANK[FEATURES[key].min];

/** "a partir do Básico" / "planos Profissional e Equipe" / "plano Equipe" (cadeados e ajuda) */
export const scopeLabel = (min: MinPlan) =>
  min === "equipe" ? "plano Equipe" : min === "profissional" ? "planos Profissional e Equipe" : "planos pagos, a partir do Básico";

/** Etiqueta curta da landing: "Todos os planos" / "A partir do Básico" / "Profissional e Equipe" / "Equipe" */
export const planTag = (key: FeatureKey) => {
  const min = FEATURES[key].min;
  return min === "gratis" ? "Todos os planos" : min === "basico" ? "A partir do Básico" : min === "profissional" ? "Profissional e Equipe" : "Equipe";
};

/** Frase da ajuda: "Recurso dos planos Profissional e Equipe." */
export const planNote = (key: FeatureKey) => {
  const min = FEATURES[key].min;
  return min === "gratis" ? "Recurso de todos os planos." : `Recurso dos ${scopeLabel(min)}.`;
};

// ---------------------------------------------------------------------
// Promessa e prazos (landing, /para, cadastro, Termos, Assinatura, banners)
// ---------------------------------------------------------------------
export const PLAN_PROMISE = {
  /** "15 dias com tudo liberado, inclusive a vitrine de agendamento online" */
  trial: `${TRIAL_DAYS} dias com tudo liberado, inclusive a vitrine de agendamento online`,
  trialShort: `${TRIAL_DAYS} dias com tudo liberado`,
  /** "Grátis por 6 meses: agenda interna e cartão de visita" */
  free: `Grátis por ${FREE_MONTHS} meses: agenda interna e cartão de visita`,
  freeShort: `${FREE_MONTHS} meses grátis`,
  /** vitrine com agendamento online: só a partir do Profissional */
  vitrineFrom: "Vitrine com agendamento online a partir do Profissional",
  /** o que acontece no fim do Grátis */
  freeOver: `Depois dos ${FREE_MONTHS} meses, sem assinar, o painel fica só para consulta: você vê a agenda, os clientes e o histórico e pode cancelar horários, mas para agendar de novo é preciso assinar o Básico. Nada é apagado.`,
  /** aviso do painel quando o Grátis acabou: [título, texto] */
  freeOverTitle: "Seu Grátis terminou.",
  freeOverPanel: "O painel está só para consulta: você vê tudo e pode cancelar horários. Assine o Básico para continuar agendando.",
  /** cartão de visita (Grátis e Básico) */
  card: "Seu link funciona como cartão de visita: serviços, preços, endereço, horários, avaliações e o botão “Agendar pelo WhatsApp”.",
  /** oferta da vitrine completa */
  vitrineUpsell: "Com o Profissional, o cliente vê os horários livres e agenda sozinho, 24 horas, e seu espaço aparece no diretório.",
  /** frase do fim do teste */
  afterTrial: `No fim do teste, escolha o seu plano ou siga no Grátis, que vale ${FREE_MONTHS} meses a partir do cadastro.`,
} as const;

/** Microgarantias do hero e do fechamento da landing */
export const PLAN_MICRO: string[] = ["Sem cartão", PLAN_PROMISE.trialShort, PLAN_PROMISE.freeShort];

/** Cupom de lançamento (migration 53): textos. Preços, prazo e duração vêm do banco (launch_offer/billing_quote). */
export const LAUNCH_TEXT = {
  /** "Preço de lançamento até 31/12/2026" */
  until: (label: string, end: string) => `${label} até ${end}`,
  /** "por 12 meses" */
  forMonths: (n: number) => `por ${n} meses`,
  /** "depois R$ 62,70/mês" */
  then: (full: string, per: string) => `depois ${full}${per}`,
  /** quem já assinou: "Desconto até 09/12/2027; depois R$ 62,70" */
  subscribed: (until: string, full: string) => `Desconto até ${until}; depois ${full}`,
  /** acessível: preço cheio riscado */
  wasLabel: (full: string) => `Preço normal: ${full}`,
};

/**
 * Indique e ganhe (56; crédito proporcional, 61): fonte única dos textos (Início, Assinatura, landing,
 * Ajuda, Termos). A regra fica no banco e em lib/referral.ts + lib/referral-credit.ts.
 */
export const REFERRAL_TEXT = {
  homeTitle: "Indique e economize na próxima mensalidade!",
  homeBody: "Quando o espaço indicado pagar a 1ª mensalidade, você recebe desconto ou até 1 mês grátis, dependendo do plano assinado!",
  /** frase da regra (card da Assinatura e Ajuda) */
  rule:
    "Quando um espaço que você indicou pagar a 1ª mensalidade ou anuidade, você ganha um crédito do valor da mensalidade dele, até o valor da sua: a sua próxima cobrança fica menor ou, se o crédito cobrir tudo, sai 1 mês grátis.",
  /** linha da landing, depois de “Indique e ganhe:” */
  landing: " a cada espaço indicado que assinar, você ganha um crédito na sua mensalidade, até 1 mês grátis.",
  /** como o valor é calculado (Ajuda e Termos) */
  howMuch:
    "O crédito é o menor valor entre a mensalidade que o espaço indicado pagou (no anual, o valor pago dividido por 12) e a sua mensalidade (no anual, a renovação dividida por 12).",
  /** quando vira 1 mês grátis em vez de desconto */
  fullMonth:
    "Se o crédito for igual ou maior que a sua mensalidade, ou se a cobrança ficaria abaixo de R$ 5,00, a sua próxima cobrança vai 1 mês para frente (no anual, a renovação fica 1 mês depois).",
  /** prêmios gerados antes da regra do crédito */
  legacy: "Indicações que já tinham gerado prêmio antes desta regra continuam valendo 1 mês grátis.",
  copy: "Copiar link de indicação",
  copied: "Link copiado!",
  copyFailed: "Não foi possível copiar. Selecione o link abaixo e copie:",
  howItWorks: "Como funciona",
} as const;

// ---------------------------------------------------------------------
// Tabela comparativa (Assinatura)
// ---------------------------------------------------------------------
/** true = inclui; false = não inclui; texto = inclui com esse limite */
export type PlanCell = boolean | string;
export type PlanFeatureRow = { label: string; values: Record<PlanKind, PlanCell> };

/** Ordem das linhas da tabela */
const TABLE_ORDER: FeatureKey[] = [
  "agenda",
  "editar",
  "cartao",
  "avaliacoes",
  "semSelo",
  "lembretes",
  "financeiro",
  "faturamento",
  "encaixe",
  "bloqueios",
  "recorrencia",
  "vitrine",
  "diretorio",
  "confirmacao",
  "pedidoAvaliacao",
  "retornos",
  "pacotes",
  "combos",
  "metas",
  "whatsapp",
  "acessos",
  "comissoes",
  "parceiro",
  "nix",
];

/** included = profissionais inclusos no Equipe (plans.included_professionals) */
export function planFeatureRows(included: number): PlanFeatureRow[] {
  const row = (key: FeatureKey): PlanFeatureRow => ({
    label: FEATURES[key].label,
    values: {
      gratis: featureIn(key, "gratis"),
      basico: featureIn(key, "basico"),
      profissional: featureIn(key, "profissional"),
      equipe: featureIn(key, "equipe"),
    },
  });
  const rows = TABLE_ORDER.map(row);
  // o cartão de visita vira a vitrine completa a partir do Profissional
  const card = rows[TABLE_ORDER.indexOf("cartao")];
  card.values.profissional = "Vitrine completa";
  card.values.equipe = "Vitrine completa";
  return [
    {
      label: "Prazo",
      values: { gratis: `${FREE_MONTHS} meses, depois só consulta`, basico: "Sem prazo", profissional: "Sem prazo", equipe: "Sem prazo" },
    },
    { label: "Profissionais", values: { gratis: "1", basico: "1", profissional: "1", equipe: `Até ${included} + extra` } },
    ...rows,
  ];
}

// ---------------------------------------------------------------------
// Cartões de preço (landing "/" e /para): mesmo conteúdo nos dois
// ---------------------------------------------------------------------
export const PLAN_CARDS: Record<PlanKind, { tagline: string; items: (included: number) => string[] }> = {
  gratis: {
    tagline: `Agenda interna por ${FREE_MONTHS} meses, sem pagar nada.`,
    items: () => [
      "Agenda, clientes, ficha e histórico",
      "Cartão de visita com botão do WhatsApp",
      "Remarcar e editar agendamento",
      "1 profissional",
    ],
  },
  basico: {
    tagline: "Agenda sem prazo, lembretes e caixa para quem atende sozinho.",
    items: () => [
      "Tudo do Grátis, sem prazo e sem o selo",
      "Lembretes da véspera em um toque",
      "Caixa, faturamento e contador",
    ],
  },
  profissional: {
    tagline: "Vitrine completa: o cliente agenda sozinho, 24h.",
    items: () => [
      "Tudo do Básico",
      "Vitrine com agendamento online 24h",
      "Encaixe, bloqueios e recorrência",
      "Confirmação automática e diretório",
      "WhatsApp automático (ativação assistida)",
      "Retornos, pacotes, combos e metas",
      "Pedido de avaliação",
    ],
  },
  equipe: {
    tagline: "Para salões e equipes.",
    items: (included) => [
      "Tudo do Profissional",
      `Até ${included} profissionais inclusos`,
      "Acessos para recepção e profissionais",
      "Comissões, “Meus ganhos” e salão-parceiro",
    ],
  },
};
