// Calculadora de preço de venda (69): contas puras, sem tela e sem banco.
// Preço = (CD + CF) ÷ (1 − (IMP + TX + COM + ML) / 100)
//   CD  = custo direto do serviço (material + outros)
//   CF  = custo fixo do mês ÷ horas trabalhadas no mês × duração do serviço (em horas)
//   IMP, TX, COM, ML = imposto, taxa da maquininha, comissão e margem desejada, em %
// Sem classes do Tailwind (src/lib fica fora do content do Tailwind).

export type PaymentForm = "credito" | "debito" | "pix" | "dinheiro";
export type FeeChoice = PaymentForm | "media";

export type Fees = Record<PaymentForm, number>;

/** Soma dos % que viram preço; a partir daqui o preço fica inviável */
export const PCT_WARNING = 70;
/** Semáforo: abaixo disso a margem é baixa */
export const LOW_MARGIN_PCT = 15;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Soma dos custos fixos do mês */
export const fixedMonthly = (items: { amount: number }[]) => round2(items.reduce((s, i) => s + Math.max(num(i.amount), 0), 0));

/** Custo fixo de um atendimento: custo do mês ÷ horas do mês × duração (min) */
export function fixedPerService(monthly: number, hoursMonth: number, durationMin: number) {
  if (!(hoursMonth > 0) || !(durationMin > 0)) return 0;
  return round2((monthly / hoursMonth) * (durationMin / 60));
}

/** Taxa da forma escolhida; "media" = média das 4 formas */
export function feeFor(fees: Fees, choice: FeeChoice) {
  if (choice !== "media") return num(fees[choice]);
  const all = [fees.credito, fees.debito, fees.pix, fees.dinheiro].map(num);
  return round2(all.reduce((s, v) => s + v, 0) / all.length);
}

export const pctSum = (...pcts: number[]) => round2(pcts.reduce((s, p) => s + num(p), 0));

/** "Quanto cobrar?": preço sugerido; null quando a soma dos % chega a 100 (impossível) */
export function suggestedPrice(input: { cd: number; cf: number; imp: number; tx: number; com: number; ml: number }) {
  const total = pctSum(input.imp, input.tx, input.com, input.ml);
  if (total >= 100) return null;
  return round2((num(input.cd) + num(input.cf)) / (1 - total / 100));
}

export type ProfitBreakdown = {
  price: number;
  cd: number;
  cf: number;
  imp: number;
  tx: number;
  com: number;
  /** custo real do atendimento (CD + CF + impostos + taxa + comissão) */
  cost: number;
  profit: number;
  /** lucro em % do preço; null com preço 0 */
  profitPct: number | null;
};

/** "Quanto eu lucro?": a partir do preço, quanto custa de verdade e quanto sobra */
export function realProfit(input: { price: number; cd: number; cf: number; imp: number; tx: number; com: number }): ProfitBreakdown {
  const price = Math.max(num(input.price), 0);
  const imp = round2((price * num(input.imp)) / 100);
  const tx = round2((price * num(input.tx)) / 100);
  const com = round2((price * num(input.com)) / 100);
  const cd = num(input.cd);
  const cf = num(input.cf);
  const cost = round2(cd + cf + imp + tx + com);
  const profit = round2(price - cost);
  return { price, cd, cf, imp, tx, com, cost, profit, profitPct: price > 0 ? Math.round((profit / price) * 1000) / 10 : null };
}

export type Light = "prejuizo" | "baixa" | "saudavel";

/** Semáforo do lucro: prejuízo (< 0) · margem baixa (< 15%) · saudável */
export function trafficLight(profitPct: number | null): Light {
  if (profitPct === null || profitPct < 0) return "prejuizo";
  return profitPct < LOW_MARGIN_PCT ? "baixa" : "saudavel";
}

export const LIGHT_LABEL: Record<Light, string> = {
  prejuizo: "Prejuízo",
  baixa: "Margem baixa",
  saudavel: "Saudável",
};

/** Imposto sugerido pelo enquadramento (sempre editável; conferir com o contador) */
export type Regime = "mei" | "simples" | "autonomo" | "nao_sei";
export const REGIME_TAX: Record<Regime, number | null> = {
  mei: 0,        // o DAS do MEI é valor fixo mensal: entra nos custos fixos
  simples: 6,    // Anexo III, primeira faixa (ISS incluso)
  autonomo: null,
  nao_sei: null,
};

/** Lista sugerida de custos fixos do mês (ordem da tela) */
export const FIXED_COST_ITEMS: { key: string; label: string; cashCategory?: string }[] = [
  { key: "aluguel", label: "Aluguel", cashCategory: "aluguel" },
  { key: "energia", label: "Energia" },
  { key: "agua", label: "Água" },
  { key: "internet", label: "Internet" },
  { key: "telefone", label: "Telefone" },
  { key: "sistema", label: "Sistema (Genix Agenda)" },
  { key: "contador", label: "Contador" },
  { key: "das", label: "DAS / impostos fixos" },
  { key: "limpeza", label: "Produtos de limpeza" },
  { key: "marketing", label: "Marketing" },
  { key: "prolabore", label: "Seu pró-labore" },
  { key: "outros", label: "Outros", cashCategory: "outros" },
];
