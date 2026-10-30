// Benefícios em 3 blocos, cada item com o plano mínimo (usado na "/" e na /para/[nicho]).
// Não repete a tabela de preços: aqui é o "para que serve"; lá, o "quanto custa".
import { CalendarCheck, HeartHandshake, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

type MinPlan = "Grátis" | "Profissional" | "Equipe";

const BLOCKS: { icon: typeof CalendarCheck; title: string; text: string; items: [string, MinPlan][] }[] = [
  {
    icon: CalendarCheck,
    title: "Agenda que se organiza sozinha",
    text: "Os clientes marcam pelo link e a agenda se ajeita. Você só confere o dia.",
    items: [
      ["Agendamento online 24 horas", "Grátis"],
      ["Confirmação automática", "Grátis"],
      ["Remarcar com os horários livres", "Grátis"],
      ["Visão da semana com arrastar", "Grátis"],
      ["Agendamentos recorrentes", "Profissional"],
      ["Bloqueios de férias, folgas e feriados", "Profissional"],
    ],
  },
  {
    icon: HeartHandshake,
    title: "Clientes que voltam",
    text: "Tudo sobre cada cliente num lugar só e o lembrete certo na hora certa.",
    items: [
      ["Ficha e histórico de cada cliente", "Grátis"],
      ["Lembretes de véspera em um toque", "Grátis"],
      ["Avaliações dos clientes na vitrine", "Grátis"],
      ["Retornos: quem está na hora de voltar", "Profissional"],
      ["Pacotes de sessões com saldo", "Profissional"],
    ],
  },
  {
    icon: Wallet,
    title: "Dinheiro sob controle",
    text: "Saiba quanto entrou, quanto falta para o limite e entregue tudo pronto ao contador.",
    items: [
      ["Caixa com Pix, cartão e dinheiro", "Profissional"],
      ["Faturamento e limites do MEI e do Simples", "Profissional"],
      ["Relatório pronto para o contador", "Profissional"],
      ["Comissões e “Meus ganhos” da equipe", "Equipe"],
      ["Salão-parceiro no faturamento", "Equipe"],
    ],
  },
];

const TAG: Record<MinPlan, string> = {
  Grátis: "bg-green-50 text-green-800 ring-green-600/20",
  Profissional: "bg-primary/10 text-primary ring-primary/20",
  Equipe: "bg-[#F2C078]/30 text-[#7a4520] ring-[#C47B47]/30",
};

export function BenefitBlocks({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-3", className)}>
      {BLOCKS.map(({ icon: Icon, title, text, items }) => (
        <div key={title} className="flex flex-col rounded-2xl border bg-card p-6" data-testid={`bloco-${title.split(" ")[0].toLowerCase()}`}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-sans text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          <ul className="mt-5 space-y-2.5">
            {items.map(([item, plan]) => (
              <li key={item} className="flex items-start justify-between gap-3 text-sm">
                <span>{item}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1", TAG[plan])}>{plan}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
