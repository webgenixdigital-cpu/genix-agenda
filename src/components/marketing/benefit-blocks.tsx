// Benefícios em 3 blocos, cada item com o plano mínimo (usado na "/" e na /para/[nicho]).
// Não repete a tabela de preços: aqui é o "para que serve"; lá, o "quanto custa".
import { CalendarCheck, HeartHandshake, Wallet } from "lucide-react";
import { FEATURES, PLAN_NAMES, type FeatureKey, type PlanKind } from "@/content/planos";
import { cn } from "@/lib/utils";

// O plano de cada item vem do catálogo (src/content/planos.ts, FEATURES).

const BLOCKS: { icon: typeof CalendarCheck; title: string; text: string; items: [string, FeatureKey][] }[] = [
  {
    icon: CalendarCheck,
    title: "Agenda que se organiza sozinha",
    text: "Seu link mostra seus serviços e, no Profissional, os clientes marcam sozinhos. Você só confere o dia.",
    items: [
      ["Cartão de visita com botão do WhatsApp", "cartao"],
      ["Agendamento online 24 horas na vitrine", "vitrine"],
      ["Confirmação automática", "confirmacao"],
      ["Remarcar com os horários livres", "editar"],
      ["Visão da semana com arrastar", "agenda"],
      ["Encaixe, inclusive por cima de outro atendimento", "encaixe"],
      ["Agendamentos recorrentes", "recorrencia"],
      ["Bloqueios de almoço, folgas, férias e feriados", "bloqueios"],
    ],
  },
  {
    icon: HeartHandshake,
    title: "Clientes que voltam",
    text: "Tudo sobre cada cliente num lugar só e o lembrete certo na hora certa.",
    items: [
      ["Ficha e histórico de cada cliente", "agenda"],
      ["Lembretes de véspera em um toque", "lembretes"],
      ["Avaliações dos clientes no seu link", "avaliacoes"],
      ["Pedido de avaliação depois do atendimento", "pedidoAvaliacao"],
      ["Retornos: quem está na hora de voltar", "retornos"],
      ["Pacotes de sessões com saldo", "pacotes"],
    ],
  },
  {
    icon: Wallet,
    title: "Dinheiro sob controle",
    text: "Saiba quanto entrou, quanto falta para o limite e entregue tudo pronto ao contador.",
    items: [
      ["Caixa com Pix, cartão e dinheiro", "financeiro"],
      ["Faturamento e limites do MEI e do Simples", "faturamento"],
      ["Relatório pronto para o contador", "faturamento"],
      ["Metas de faturamento e atendimentos", "metas"],
      ["Comissões e “Meus ganhos” da equipe", "comissoes"],
      ["Salão-parceiro no faturamento", "parceiro"],
    ],
  },
];

const TAG: Record<PlanKind, string> = {
  gratis: "bg-green-50 text-green-800 ring-green-600/20",
  basico: "bg-stone-100 text-stone-800 ring-stone-500/20",
  profissional: "bg-primary/10 text-primary ring-primary/20",
  equipe: "bg-[#F2C078]/30 text-[#7a4520] ring-[#C47B47]/30",
};

export function BenefitBlocks({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-8 lg:grid-cols-3", className)}>
      {BLOCKS.map(({ icon: Icon, title, text, items }) => (
        <div key={title} className="flex flex-col rounded-2xl border bg-card p-6 text-center md:p-7" data-testid={`bloco-${title.split(" ")[0].toLowerCase()}`}>
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-sans text-lg font-semibold">{title}</h3>
          <p className="copy mt-2 text-sm text-muted-foreground">{text}</p>
          <ul className="mt-6 space-y-3 text-left">
            {items.map(([item, key]) => (
              <li key={item} className="flex items-start justify-between gap-3 text-sm">
                <span>{item}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1", TAG[FEATURES[key].min])}>{PLAN_NAMES[FEATURES[key].min]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
