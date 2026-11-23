// Textos dos botões de ajuda (?) do painel — <Ajuda id="..." />.
// Português simples, para o dono do salão. Para mudar um texto, edite aqui.
// Cada item: título, "Para que serve" (1–2 frases), "Como fazer" (passos curtos) e,
// quando fizer sentido, "Atenção" (uma ou mais linhas).

import { FREE_MONTHS, PLAN_PROMISE, REFERRAL_TEXT, TRIAL_DAYS, planNote } from "@/content/planos";

export type AjudaItem = {
  titulo: string;
  serve: string;
  passos: string[];
  atencao?: string[];
};

const AJUDA_TEXTOS = {
  // ------------------------------------------------------------------ telas e seções
  inicio: {
    titulo: "Início",
    serve:
      "É o resumo do seu dia em quadros: atendimentos de hoje, pagamentos a registrar, aniversários, retornos, próximo feriado e o que ainda falta configurar. Cada pessoa da equipe vê só os quadros que pode abrir.",
    passos: [
      "Toque em qualquer quadro para ir direto à tela dele (Agenda, Clientes, Lembretes, Bloqueios, Configurações...).",
      "Quadro em amarelo pede atenção: pedido a confirmar, pagamento pendente, WhatsApp desconectado ou informação faltando.",
      "Quadro apagado, com “Tudo em dia”, quer dizer que não há nada a fazer ali.",
      "Mais abaixo fica a agenda de hoje e o link da sua vitrine.",
    ],
    atencao: [
      "O quadro de feriados mostra só os nacionais. Feriados da sua cidade ou do seu estado você cadastra em Bloqueios.",
    ],
  },
  agenda: {
    titulo: "Agenda",
    serve: "Mostra todos os horários marcados, por dia, semana ou mês. A Agenda sempre abre no dia de hoje.",
    passos: [
      "Escolha Dia, Semana ou Mês no topo.",
      "Use as setas ou a data para ir a outro dia; “Hoje” volta para hoje.",
      "Toque num atendimento para confirmar, remarcar, editar ou concluir.",
      "Na Semana, toque num horário vazio para marcar ali.",
    ],
  },
  clientes: {
    titulo: "Clientes",
    serve: "A lista de todas as pessoas que já marcaram com você, com histórico e contato.",
    passos: ["Busque pelo nome ou pelo WhatsApp.", "Toque no cliente para abrir a ficha."],
    atencao: ["O cliente entra na lista sozinho quando marca pela vitrine ou quando você agenda para ele."],
  },
  "ficha-cliente": {
    titulo: "Ficha do cliente",
    serve: "Tudo sobre um cliente num lugar só: visitas, valores, pacotes, aniversário e anotações.",
    passos: [
      "Confira o histórico de atendimentos e o que mudou em cada um.",
      "Toque em “Editar” para corrigir nome, WhatsApp ou aniversário.",
      "Em Pacotes, veja o saldo ou venda um pacote novo.",
    ],
  },
  lembretes: {
    titulo: "Lembretes",
    serve: "A lista de quem tem horário amanhã (ou hoje) para você lembrar pelo WhatsApp com um toque.",
    passos: [
      "Toque em “Enviar lembrete”: o WhatsApp abre com a mensagem pronta.",
      "Envie a mensagem no WhatsApp.",
      "Pronto: o cliente sai da fila sozinho e vai para “Já lembrados”. Se foi engano, toque em “Voltar para a fila”.",
    ],
    atencao: [
      "Para mudar o texto da mensagem, toque em “Editar mensagem”.",
      "Essa lista é manual. Para enviar sozinho, veja “WhatsApp automático” em Configurações (planos Profissional e Equipe).",
      planNote("lembretes"),
    ],
  },
  retornos: {
    titulo: "Retornos",
    serve:
      "Mostra os clientes que já passaram (ou estão perto) do tempo de voltar para repetir um serviço, como manutenção de unha a cada 15 dias.",
    passos: [
      "Em Serviços, preencha o “Retorno sugerido” de cada serviço.",
      "Aqui, em “Hora de voltar” e “Nos próximos 7 dias”, toque em “Chamar para voltar”: o WhatsApp abre com a mensagem pronta.",
      "O cliente vai sozinho para “Já chamados”. Se foi engano, toque em “Voltar para a fila”.",
    ],
    atencao: [planNote("retornos")],
  },
  nix: {
    titulo: "Nix, a assistente",
    serve: "Responde dúvidas sobre o uso do Genix Agenda numa conversa: como fazer, onde fica cada coisa e o que cada plano inclui.",
    passos: [
      "Toque no botão redondo no canto de baixo da tela.",
      "Escreva a dúvida (ou toque numa sugestão) e envie.",
      "A conversa fica aberta enquanto você está na página; ao recarregar, começa de novo.",
    ],
    atencao: [
      "Por enquanto a Nix não vê a agenda, os clientes nem o caixa do seu espaço: ela explica como fazer.",
      "A conversa é processada pelo Google Gemini. Não envie senhas, cartões nem dados pessoais de clientes.",
      "A Nix pode errar. Na dúvida, confira no ponto de Ajuda (?) de cada tela.",
      "Recurso do plano Equipe (matriz e recepção). No teste de 15 dias, fica liberada nos 3 últimos dias, com limite de perguntas por dia.",
    ],
  },
  metas: {
    titulo: "Metas",
    serve:
      "Mostra onde você quer chegar no período (faturamento, atendimentos, ticket médio ou clientes novos), quanto já fez e quanto precisa por dia até o fim.",
    passos: [
      "Toque em “Nova meta”, escolha o que medir e o valor.",
      "Escolha o período: “Este mês”, “Próximo mês” ou as datas que quiser (até 1 ano).",
      "No plano Equipe, escolha se a meta é do espaço todo ou de um profissional.",
      "Acompanhe aqui: “No ritmo” quer dizer que, mantendo o passo, você bate a meta no prazo.",
    ],
    atencao: [
      "Faturamento e ticket médio contam pela data do pagamento, como no Financeiro. Atendimentos contam pela data do atendimento. Quem foi atendido em 30/11 e pagou em 02/12 conta como atendimento em novembro e como dinheiro em dezembro.",
      "A meta de um profissional não conta venda de pacote nem de produto, só o que entrou pelos atendimentos dele.",
      "Cliente novo é quem fez o primeiro atendimento no período. Só ter a ficha cadastrada não conta.",
      "A recepção vê e edita as metas, mas só os totais: os lançamentos do caixa continuam só com a matriz.",
      planNote("metas"),
    ],
  },
  bloqueios: {
    titulo: "Bloqueios",
    serve: "Fecha horários na agenda (férias, folga, almoço, curso) para ninguém marcar neles pela vitrine.",
    passos: [
      "Toque em “Novo bloqueio”.",
      "Escolha o profissional (ou a equipe toda), os dias e, se quiser, só um horário.",
      "Para algo que se repete toda semana (como almoço ou folga fixa), marque os dias da semana.",
    ],
    atencao: [
      "Bloqueio não cancela atendimentos já marcados nesses horários; confira a agenda.",
      `${planNote("bloqueios")} Vale para almoço, folga fixa, férias e feriados.`,
    ],
  },
  servicos: {
    titulo: "Serviços",
    serve: "A lista do que você oferece, com preço e duração. É ela que aparece na vitrine.",
    passos: [
      "Toque em “Novo serviço” e preencha nome, preço e duração.",
      "Diga quais profissionais fazem cada serviço.",
      "Desmarque “aparece na vitrine” para serviços que só você agenda.",
    ],
  },
  combos: {
    titulo: "Combos",
    serve: "Junta 2 a 6 serviços num só, com preço especial (ex.: Corte + Barba).",
    passos: [
      "Toque em “Novo combo”.",
      "Escolha os serviços e o preço do combo; o tempo é a soma dos serviços.",
      "Salve: o combo aparece na vitrine e na agenda.",
    ],
    atencao: ["Só profissionais que fazem todos os serviços do combo podem atender.", planNote("combos")],
  },
  "pacotes-modelos": {
    titulo: "Pacotes",
    serve: "Cria os pacotes que você vende, como “10 drenagens” ou “4 manicures + 2 pedicures”.",
    passos: [
      "Toque em “Novo pacote”.",
      "Escolha os serviços, quantas sessões de cada, o preço fechado e a validade.",
      "Depois, venda o pacote na ficha do cliente ou no Novo agendamento.",
    ],
    atencao: ["Mudar um modelo não muda pacotes já vendidos.", planNote("pacotes")],
  },
  equipe: {
    titulo: "Equipe",
    serve: "Cadastra quem atende no seu espaço e o que cada um faz.",
    passos: [
      "Toque em “Novo profissional” e preencha nome e foto.",
      "Marque os serviços que ele faz.",
      "Para ele entrar no sistema com login próprio, use “Acessos da equipe”.",
    ],
    atencao: ["No plano Equipe, a partir do 4º profissional há um valor extra por mês."],
  },
  "acessos-equipe": {
    titulo: "Acessos da equipe",
    serve: "Dá login próprio para a recepção e para cada profissional, cada um vendo só o que precisa.",
    passos: [
      "Escolha o tipo de acesso: Recepção ou Profissional.",
      "Informe o e-mail da pessoa.",
      "Ela recebe um e-mail para criar a senha.",
    ],
    atencao: [
      "A recepção vê a agenda de todos, mas não vê financeiro nem configurações.",
      "O profissional vê só a própria agenda e os próprios clientes.",
      planNote("acessos"),
    ],
  },
  comissoes: {
    titulo: "Comissão",
    serve: "Guarda a porcentagem que o profissional recebe de cada atendimento, para calcular o que é dele.",
    passos: ["Abra o profissional em Equipe.", "Preencha a comissão em %.", "Ele acompanha o valor em “Meus ganhos”."],
    atencao: ["O valor em “Meus ganhos” é uma estimativa; o fechamento oficial é feito por você.", planNote("comissoes")],
  },
  "salao-parceiro": {
    titulo: "Salão-parceiro",
    serve:
      "Para quem trabalha com profissionais parceiros (Lei do Salão-Parceiro): separa a parte do salão e a do parceiro nos relatórios.",
    passos: [
      "Em Configurações, marque que trabalha com profissionais parceiros.",
      "Em Equipe, marque quem é parceiro.",
      "Confira os valores no Financeiro e no relatório do contador.",
    ],
    atencao: ["O sistema só organiza os valores. Contrato e impostos ficam com você e o seu contador.", planNote("parceiro")],
  },
  "financeiro-caixa": {
    titulo: "Caixa",
    serve: "Mostra tudo o que entrou e saiu: atendimentos concluídos, pacotes vendidos e lançamentos que você faz.",
    passos: [
      "Escolha o período no topo.",
      "Toque em “Novo lançamento” para registrar uma entrada ou despesa avulsa.",
      "Veja os totais por forma de pagamento.",
    ],
    atencao: ["Atendimento concluído entra sozinho no caixa. Não lance de novo à mão.", planNote("financeiro")],
  },
  "faturamento-limites": {
    titulo: "Faturamento e limites",
    serve:
      "Acompanha quanto você faturou nos últimos 12 meses e avisa quando estiver chegando perto do limite do seu enquadramento (ex.: MEI).",
    passos: ["Em Configurações, escolha o enquadramento do seu espaço.", "Aqui, acompanhe o total e a barra até o limite."],
    atencao: ["É um acompanhamento para te avisar a tempo. Confirme os valores com o seu contador.", planNote("faturamento")],
  },
  contador: {
    titulo: "Relatório para o contador",
    serve: "Junta num relatório o que o contador costuma pedir: receitas, despesas e, se tiver, a parte dos parceiros.",
    passos: ["Escolha o mês ou o período.", "Imprima ou baixe a planilha.", "Envie para o seu contador."],
    atencao: [planNote("faturamento")],
  },
  "meus-ganhos": {
    titulo: "Meus ganhos",
    serve: "Mostra ao profissional quanto ele ganhou no mês com os atendimentos concluídos.",
    passos: ["Escolha o mês.", "Confira cada atendimento e o valor da sua comissão."],
    atencao: [
      "É uma estimativa a partir dos atendimentos concluídos; o fechamento oficial é com a matriz.",
      "Se faltar algum atendimento, peça para concluir na agenda.",
    ],
  },
  assinatura: {
    titulo: "Assinatura",
    serve: "Mostra seu plano, quantos dias faltam do Grátis ou do teste, a próxima cobrança, e deixa trocar de plano.",
    passos: [
      "Compare os 4 planos na tabela: o que cada um inclui e o que não inclui.",
      "Escolha Básico, Profissional ou Equipe, mensal ou anual (no anual você ganha 2 meses).",
      "Pague por Pix ou cartão.",
    ],
    atencao: [
      `O Grátis vale ${FREE_MONTHS} meses a partir do cadastro (os ${TRIAL_DAYS} dias de teste do Equipe contam dentro). ${PLAN_PROMISE.freeOver}`,
      `No Grátis e no Básico, seu link é um cartão de visita com o botão do WhatsApp. ${PLAN_PROMISE.vitrineFrom}.`,
      "Básico e Profissional são para 1 profissional. Para mais gente, escolha o Equipe.",
      "Plano maior no mensal: muda na hora, e o novo valor vale a partir da próxima cobrança.",
      "Plano maior no anual: muda quando você pagar a diferença proporcional aos dias que faltam.",
      "Plano menor: começa na próxima renovação.",
      "Se o teste grátis acabar sem assinatura, a conta passa para o Grátis e nada é apagado.",
    ],
  },
  indicacao: {
    titulo: "Indique e ganhe",
    serve: "Indique o Genix Agenda para outros espaços e ganhe um crédito na sua assinatura, até 1 mês grátis, para cada um que assinar e pagar.",
    passos: [
      "Copie o seu link ou toque em “Compartilhar no WhatsApp”. A mensagem já vai pronta.",
      "A pessoa cria a conta pelo seu link. O link fica guardado no aparelho dela por 30 dias, então ela pode olhar o site antes.",
      REFERRAL_TEXT.rule,
      REFERRAL_TEXT.howMuch,
    ],
    atencao: [
      "Vale só para contas novas, criadas pelo seu link. Não dá para vincular depois do cadastro.",
      REFERRAL_TEXT.fullMonth,
      "Cada espaço indicado gera 1 crédito, uma única vez, mesmo se cancelar e assinar de novo. Cada cobrança recebe 1 crédito; os outros ficam para as cobranças seguintes.",
      "Se você ainda não assina, os créditos ficam guardados e entram depois do pagamento da sua 1ª assinatura. Se a sua próxima cobrança ainda não foi gerada, o crédito entra quando ela for gerada (cerca de 40 dias antes do vencimento).",
      "Não vale indicar a si mesmo (mesmo e-mail, WhatsApp ou CPF/CNPJ). Se o pagamento do indicado for estornado antes de você usar, o crédito é cancelado.",
      "O crédito é desconto na assinatura, não em dinheiro. O preço de lançamento continua até a mesma data.",
      REFERRAL_TEXT.legacy,
    ],
  },
  "preco-lancamento": {
    titulo: "Preço de lançamento",
    serve: "Desconto automático nos planos Profissional e Equipe para quem assinar até 31/12/2026, durante 12 meses.",
    passos: [
      "Escolha o Profissional ou o Equipe, mensal ou anual: o preço com desconto já aparece, sem digitar cupom.",
      "Os 12 meses contam a partir da primeira cobrança. No anual, o desconto vale para a primeira anuidade.",
      "Depois dos 12 meses, a cobrança volta sozinha ao preço normal. Você não precisa fazer nada.",
    ],
    atencao: [
      "O desconto é um só por espaço. Se trocar entre Profissional e Equipe, ele continua até a mesma data.",
      "No anual, a anuidade só tem desconto se o ano inteiro couber até a data final. Quem passa do mensal para o anual no meio do desconto paga o anual no preço normal.",
      "O Básico e o profissional extra do Equipe não têm desconto.",
      "Se cancelar e assinar de novo, o desconto vale só até a data final original. Se a primeira fatura nunca foi paga, o desconto é desfeito e você pode usar de novo.",
    ],
  },
  configuracoes: {
    titulo: "Configurações",
    serve: "Ajusta como o seu espaço funciona: dados da vitrine, horários, confirmação, mensagens e descontos.",
    passos: ["Abra a seção que quer mudar.", "Altere e toque em Salvar dentro dela."],
  },

  // ------------------------------------------------------------------ configurações e WhatsApp
  "link-vitrine": {
    titulo: "Link da vitrine",
    serve: "É o endereço da sua página, para colocar no Instagram e mandar para os clientes.",
    passos: ["Copie o link ou baixe o QR code.", "Coloque na bio do Instagram e no WhatsApp."],
    atencao: [
      `No Grátis e no Básico: ${PLAN_PROMISE.card}`,
      `${PLAN_PROMISE.vitrineUpsell} ${planNote("vitrine")}`,
      "Se mudar o endereço, atualize onde já divulgou (Instagram, cartões, QR code impresso).",
    ],
  },
  "vitrine-carrinho": {
    titulo: "Pedido pelo WhatsApp",
    serve:
      "No cartão de visita, o cliente escolhe um ou mais serviços e manda o pedido já montado no seu WhatsApp, com os serviços, o total estimado e a duração.",
    passos: [
      "O cliente toca em “Adicionar” nos serviços que quer.",
      "Aparece uma barra com o total. Ele pode escrever o nome e toca em “Pedir pelo WhatsApp”.",
      "A mensagem chega no seu WhatsApp. Você responde com o horário que tem livre para a soma dos serviços.",
    ],
    atencao: [
      "O cartão não consulta a sua agenda: o horário é sempre combinado na conversa.",
      "Serviço com preço R$ 0,00 aparece como “Valor a combinar” e não entra no total.",
      "Nada do pedido fica salvo no sistema. Quando marcar, lance o atendimento na Agenda.",
      `${PLAN_PROMISE.vitrineUpsell} ${planNote("vitrine")}`,
    ],
  },
  horarios: {
    titulo: "Horários e agendamento",
    serve: "Diz em que dias e horários você atende e com quanto tempo de antecedência o cliente pode marcar.",
    passos: [
      "Marque os dias abertos e o horário de abrir e fechar.",
      "Escolha de quanto em quanto tempo aparecem os horários (ex.: de 30 em 30 min).",
      "Para almoço e folgas, use Bloqueios.",
    ],
  },
  "confirmacao-automatica": {
    titulo: "Confirmação dos agendamentos online",
    serve: "Decide se o que o cliente marca na vitrine já entra confirmado ou espera você confirmar.",
    passos: [
      "Tudo automático: todo agendamento da vitrine já entra confirmado.",
      "Só clientes recorrentes: confirma sozinho quem já foi atendido aqui; cliente novo espera você.",
      "Tudo manual: você confirma cada pedido.",
      "Escolha uma das opções e salve.",
    ],
    atencao: ["Pedido não confirmado aparece como “pendente” no Início e na Agenda.", planNote("confirmacao")],
  },
  descontos: {
    titulo: "Descontos",
    serve: "Define até quanto o profissional pode dar de desconto sozinho.",
    passos: ["Escolha o desconto máximo em %.", "Salve. Coloque 0 se só você e a recepção puderem dar desconto."],
  },
  enquadramento: {
    titulo: "Enquadramento e faturamento",
    serve: "Informa se o seu espaço é MEI, Simples etc., para o sistema acompanhar o limite de faturamento.",
    passos: [
      "Escolha o enquadramento.",
      "Se quiser, informe o CNPJ e a data de início das atividades.",
      "Se trabalha com parceiros, marque a opção do salão-parceiro.",
    ],
  },
  "whatsapp-automatico": {
    titulo: "WhatsApp automático (beta)",
    serve: "Envia as mensagens pelo seu próprio WhatsApp, sozinho, sem você precisar tocar em nada.",
    passos: [
      "Toque em Conectar e leia o QR code com o WhatsApp do celular do espaço.",
      "Escolha quais mensagens quer ligar.",
      "A Genix libera o envio para o seu espaço.",
    ],
    atencao: [
      "Para não parecer robô, o intervalo entre as mensagens varia (7 a 13 minutos), com no máximo 6 por hora, das 8h às 20h.",
      "Confirmação e lembretes saem só para agendamentos confirmados; a de aniversário não depende de agendamento.",
      "Se duas mensagens caírem perto para o mesmo cliente, a segunda é adiada para não incomodar; só é descartada se passar do prazo — e fica registrada.",
      `${planNote("whatsapp")} Em teste.`,
    ],
  },
  "msg-confirmacao": {
    titulo: "Mensagem de confirmação",
    serve: "Avisa o cliente que o horário ficou confirmado.",
    passos: ["Ligue a chave.", "Ajuste o texto, se quiser."],
    atencao: [
      "Sai cerca de 5 minutos depois de o horário ficar confirmado (ou remarcado). Fora das 8h–20h, sai às 8h.",
      "Se não sair em 2 horas, é descartada.",
    ],
  },
  "msg-antes": {
    titulo: "Lembrete antes do horário",
    serve: "Lembra o cliente no próprio dia, pouco antes do atendimento.",
    passos: ["Ligue a chave.", "Escolha com quanto tempo antes: 1h, 1h30 ou 2h.", "Ajuste o texto, se quiser."],
  },
  "msg-vespera": {
    titulo: "Lembrete de véspera",
    serve: "Lembra o cliente no dia anterior ao horário.",
    passos: ["Ligue a chave.", "Ajuste os 3 textos; eles são usados um de cada vez, para variar."],
    atencao: ["Se você já lembrou o cliente pela lista manual de Lembretes, o automático não manda de novo."],
  },
  "msg-aniversario": {
    titulo: "Mensagem de aniversário",
    serve: "Manda parabéns no dia do aniversário do cliente.",
    passos: ["Cadastre o aniversário na ficha do cliente.", "Ligue a chave e ajuste o texto."],
    atencao: ["Sai uma vez por ano, num horário entre 8h e 19h."],
  },
  "texto-lembrete-manual": {
    titulo: "Mensagem do lembrete",
    serve: "Muda o texto que abre no WhatsApp quando você lembra o cliente pela lista de Lembretes.",
    passos: [
      "Toque em “Editar mensagem”.",
      "Ajuste o texto de “Amanhã” e o de “Hoje”.",
      "Use as palavras entre chaves para preencher sozinho: {primeiro_nome}, {servico}, {profissional}, {data}, {hora}, {espaco} e {total}.",
    ],
    atencao: ["Exemplo: “Oi, {primeiro_nome}! Lembrando do seu {servico} amanhã às {hora} com {profissional}.” vira “Oi, Ana! Lembrando do seu Corte amanhã às 14:00 com Bia.”"],
  },

  // ------------------------------------------------------------------ botões
  "novo-agendamento": {
    titulo: "Novo agendamento",
    serve: "Marca um horário para quem pediu por telefone, WhatsApp ou no balcão. Já entra confirmado.",
    passos: [
      "Digite o WhatsApp do cliente; se ele já existe, o nome aparece sozinho.",
      "Se ele tiver pacote, toque em “Usar pacote”.",
      "Escolha o serviço, o dia e um dos horários livres.",
      "Escolha o profissional e salve.",
    ],
  },
  encaixe: {
    titulo: "Encaixe",
    serve: "Marca num horário fora da lista, por exemplo antes de abrir ou depois de fechar.",
    passos: ["Marque “Encaixe”.", "Escolha o horário.", "Escolha um profissional livre e salve."],
    atencao: [
      "O encaixe ignora o horário de funcionamento, mas não passa por cima de bloqueios nem de outro atendimento.",
      "Para marcar por cima de outro atendimento (enquanto o produto age), use o “Encaixe sobreposto”.",
      "No Remarcar, só a matriz e a recepção podem usar.",
      `${planNote("encaixe")} No Grátis, escolha um dos horários livres da lista.`,
    ],
  },
  "encaixe-sobreposto": {
    titulo: "Encaixe sobreposto",
    serve:
      "Marca um atendimento por cima de outro do mesmo profissional, no mesmo horário. Serve para aproveitar o tempo parado de um procedimento longo, como a pausa da progressiva ou da coloração.",
    passos: [
      "Marque “Encaixe sobreposto”.",
      "Digite o horário e escolha o profissional.",
      "Confira em “Vai ficar por cima de” qual atendimento fica embaixo e salve.",
    ],
    atencao: [
      "Use só quando der para atender os dois clientes ao mesmo tempo.",
      "Só cabe um encaixe sobreposto por vez no mesmo trecho.",
      "Precisa ter um atendimento embaixo. Se o horário estiver livre, marque normal.",
      "Bloqueios continuam valendo, e a vitrine continua vendo esse horário como ocupado.",
      "A matriz e a recepção usam em qualquer agenda; o profissional, só na própria.",
      "Na agenda ele aparece com o selo “Encaixe”, ao lado do outro atendimento. Para mudar o horário, use o Remarcar.",
      planNote("encaixe"),
    ],
  },
  remarcar: {
    titulo: "Remarcar",
    serve: "Muda o dia ou o horário de um atendimento sem cancelar e marcar de novo.",
    passos: [
      "Toque em “Remarcar”.",
      "Escolha o novo dia e um horário livre (e outro profissional, se quiser).",
      "Confirme.",
    ],
    atencao: [
      "O histórico guarda a mudança.",
      "Se o lembrete já tinha sido enviado, ele volta para a fila de Lembretes.",
      "O cliente recebe a nova confirmação pelo WhatsApp automático, se estiver ligado.",
    ],
  },
  repetir: {
    titulo: "Repetir este horário",
    serve: "Marca de uma vez vários atendimentos iguais: toda semana, a cada 15 dias ou todo mês.",
    passos: [
      "Preencha o agendamento normalmente.",
      "Marque “Repetir este horário” e escolha a frequência e quantas vezes.",
      "Toque em “Ver datas”, confira e crie.",
    ],
    atencao: ["Datas com conflito são puladas, sem criar data extra no fim.", planNote("recorrencia")],
  },
  "vender-pacote": {
    titulo: "Vender pacote",
    serve: "Registra a venda de um pacote para o cliente. O valor entra no caixa na hora.",
    passos: [
      "Escolha o pacote e a forma de pagamento.",
      "Escolha “Livre” (o cliente marca cada sessão depois) ou “Datas fixas”.",
      "Confirme a venda.",
    ],
    atencao: [planNote("pacotes")],
  },
  "datas-fixas": {
    titulo: "Datas fixas",
    serve: "Já deixa todas as sessões do pacote marcadas na agenda, escolhendo o que será feito em cada data.",
    passos: [
      "Monte a regra: profissional, primeiro dia, horário e frequência.",
      "Toque em “Gerar datas”: o sistema sugere quais serviços vão em cada data.",
      "Marque ou desmarque as caixinhas; o contador mostra quanto ainda resta.",
      "Confira os horários e venda.",
    ],
    atencao: [
      "Mais de um serviço na mesma data vira uma visita só.",
      "O que sobrar sem data fica no saldo, para marcar depois.",
      "Datas depois da validade não entram.",
    ],
  },
  "servicos-pacote-data": {
    titulo: "Serviços do pacote nesta data",
    serve: "Muda quais serviços do pacote serão feitos numa data já marcada.",
    passos: ["Abra o atendimento e toque em “Editar”.", "Marque ou desmarque os serviços do pacote.", "Salve."],
    atencao: [
      "Não dá para passar do saldo do pacote.",
      "Se desmarcar o primeiro serviço, outro marcado vira o principal.",
      "Para não fazer nada nessa data, cancele o atendimento.",
    ],
  },
  "editar-agendamento": {
    titulo: "Editar agendamento",
    serve:
      "Troca o serviço principal, acrescenta serviços a um atendimento (ex.: chegou para corte e quer barba também) e aplica desconto.",
    passos: [
      "Toque em “Editar”.",
      "Para mudar o serviço principal, toque em “Trocar serviço”, escolha o novo e confira o novo horário de término e o valor.",
      "Em “Adicionar serviço”, escolha o serviço e decida se aumenta o tempo.",
      "Em “Desconto”, escolha R$ ou % e informe o valor.",
    ],
    atencao: [
      "Na troca, o início continua o mesmo, os serviços adicionais e o desconto ficam. Se o novo serviço não couber (horário ocupado, bloqueio ou meia-noite), nada muda: remarque ou escolha outro.",
      "Sessão de pacote: dá para trocar por outro serviço com saldo no mesmo pacote. Escolher um serviço de fora tira a sessão do pacote (o saldo volta) e ela passa a ser cobrada.",
      "Só dá para trocar o serviço de agendamentos pendentes ou confirmados. Se já foi concluído, reabra o atendimento.",
      "O profissional só dá desconto até o limite definido em Configurações. Se a troca deixar o desconto acima desse limite, peça para a matriz ou a recepção.",
    ],
  },
  concluir: {
    titulo: "Concluir atendimento",
    serve: "Marca que o atendimento foi feito e lança o valor no caixa.",
    passos: ["Toque em “Concluir”.", "Confira o valor e escolha a forma de pagamento.", "Confirme."],
    atencao: [
      "Sessão de pacote não entra no caixa de novo: já foi paga na venda.",
      `Depois de concluir, você pode mandar ao cliente o link de avaliação. ${planNote("pedidoAvaliacao")}`,
    ],
  },
  "pagamento-pendente": {
    titulo: "Escolher depois (Pagamento pendente)",
    serve:
      "Conclui o atendimento mesmo sem saber ainda a forma de pagamento. Ele fica concluído, com o selo “Pagamento pendente”, até alguém registrar o pagamento.",
    passos: [
      "No Concluir, toque em “Escolher depois”.",
      "O atendimento aparece com o selo “Pagamento pendente” na Agenda e na ficha do cliente.",
      "Quando o cliente pagar, toque em “Registrar pagamento” no atendimento ou na lista “Pagamentos pendentes” da Agenda.",
    ],
    atencao: [
      "Enquanto estiver pendente, nada entra no caixa nem no faturamento.",
      "O atendimento já conta em “Meus ganhos”, com o aviso de pagamento pendente.",
      "Diferente de “Concluir sem lançar no caixa”, que conclui e não fica pendente.",
    ],
  },
  "registrar-pagamento": {
    titulo: "Registrar pagamento",
    serve: "Lança no caixa o pagamento de um atendimento ou pacote que ficou com “Pagamento pendente”.",
    passos: [
      "Escolha a forma de pagamento.",
      "Confira o valor (vem o que foi cobrado; dá para mudar se o cliente pagou outro valor).",
      "Confira a data (hoje, ou o dia em que o cliente pagou).",
      "Toque em “Registrar no caixa”: o selo some.",
    ],
    atencao: [
      "O pagamento entra no caixa e no faturamento na data escolhida.",
      "Para desfazer, reabra o atendimento (o lançamento sai junto).",
    ],
  },
  "pagamentos-pendentes": {
    titulo: "Pagamentos pendentes",
    serve: "Lista os atendimentos concluídos e os pacotes vendidos com “Escolher depois” que ainda não foram pagos.",
    passos: [
      "Confira cliente, data, o que foi feito e o valor.",
      "Quando o cliente pagar, toque em “Registrar pagamento”.",
    ],
    atencao: ["O profissional vê só os atendimentos dele; pacotes, só a matriz e a recepção."],
  },
  "reabrir-atendimento": {
    titulo: "Reabrir atendimento",
    serve: "Desfaz um “Concluir” feito por engano (valor ou forma de pagamento errados, cliente errado…).",
    passos: ["Toque em “Reabrir” no atendimento concluído.", "Confirme.", "Conclua de novo com os dados certos."],
    atencao: [
      "O lançamento automático desse atendimento sai do caixa (lançamentos manuais não mudam).",
      "Deixa de contar na comissão, em “Meus ganhos” e nas visitas do cliente.",
      "A sessão do pacote continua reservada para esse horário.",
      "A avaliação já enviada continua; o link fica pausado até concluir de novo.",
      "Só a matriz e a recepção podem reabrir; a recepção, só atendimentos de até 30 dias.",
    ],
  },
  "atualizar-futuros": {
    titulo: "Atualizar os agendamentos futuros",
    serve: "Quando você muda o tempo de um serviço, escolhe se os horários já marcados também mudam.",
    passos: ["Altere a duração do serviço e salve.", "Escolha se quer atualizar os agendamentos futuros."],
    atencao: ["Os que baterem com outro horário não mudam. Para esses, remarque ou ajuste na Agenda."],
  },
  "ficha-tecnica": {
    titulo: "Ficha técnica",
    serve: "Guarda anotações do serviço para a próxima visita (ex.: cor usada, tamanho da unha, preferências).",
    passos: ["Toque em “Editar ficha técnica”.", "Preencha os campos e salve."],
    atencao: ["Não use para dados de saúde (alergias, remédios, doenças). O sistema não é feito para guardar esse tipo de informação."],
  },
  pets: {
    titulo: "Pets",
    serve: "Guarda os pets deste tutor: espécie, raça, porte, peso, pelagem e comportamento. Isso ajuda a prever o tempo do banho e da tosa.",
    passos: ["Toque em “Adicionar pet”.", "Preencha o que souber (só o nome é obrigatório) e salve.", "Para mudar algo, toque no lápis ao lado do pet."],
    atencao: [
      "Não registre dados de saúde (doenças, remédios, alergias).",
      "Arquivar tira o pet da lista sem apagar o histórico. Excluir apaga de vez e só a matriz pode.",
    ],
  },
} satisfies Record<string, AjudaItem>;

export type AjudaId = keyof typeof AJUDA_TEXTOS;
export const AJUDA: Record<AjudaId, AjudaItem> = AJUDA_TEXTOS;
