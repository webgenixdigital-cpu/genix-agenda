// Textos dos botões de ajuda (?) do painel — <Ajuda id="..." />.
// Português simples, para o dono do salão. Para mudar um texto, edite aqui.
// Cada item: título, "Para que serve" (1–2 frases), "Como fazer" (passos curtos) e,
// quando fizer sentido, "Atenção" (uma ou mais linhas).

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
    serve: "É o resumo do seu dia: atendimentos de hoje, pedidos esperando confirmação e como está o mês.",
    passos: [
      "Confira a agenda de hoje logo no topo.",
      "Toque em “Abrir agenda” para ver os horários com detalhes.",
      "Se aparecer pedido pendente, toque nele para confirmar.",
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
      "Essa lista é manual. Para enviar sozinho, veja “WhatsApp automático” em Configurações.",
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
    atencao: ["Recurso dos planos pagos."],
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
      "Recurso dos planos pagos.",
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
    atencao: ["Só profissionais que fazem todos os serviços do combo podem atender.", "Recurso dos planos pagos."],
  },
  "pacotes-modelos": {
    titulo: "Pacotes",
    serve: "Cria os pacotes que você vende, como “10 drenagens” ou “4 manicures + 2 pedicures”.",
    passos: [
      "Toque em “Novo pacote”.",
      "Escolha os serviços, quantas sessões de cada, o preço fechado e a validade.",
      "Depois, venda o pacote na ficha do cliente ou no Novo agendamento.",
    ],
    atencao: ["Mudar um modelo não muda pacotes já vendidos.", "Recurso dos planos pagos."],
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
      "Recurso do plano Equipe.",
    ],
  },
  comissoes: {
    titulo: "Comissão",
    serve: "Guarda a porcentagem que o profissional recebe de cada atendimento, para calcular o que é dele.",
    passos: ["Abra o profissional em Equipe.", "Preencha a comissão em %.", "Ele acompanha o valor em “Meus ganhos”."],
    atencao: ["O valor em “Meus ganhos” é uma estimativa; o fechamento oficial é feito por você.", "Recurso do plano Equipe."],
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
    atencao: ["O sistema só organiza os valores. Contrato e impostos ficam com você e o seu contador.", "Recurso do plano Equipe."],
  },
  "financeiro-caixa": {
    titulo: "Caixa",
    serve: "Mostra tudo o que entrou e saiu: atendimentos concluídos, pacotes vendidos e lançamentos que você faz.",
    passos: [
      "Escolha o período no topo.",
      "Toque em “Novo lançamento” para registrar uma entrada ou despesa avulsa.",
      "Veja os totais por forma de pagamento.",
    ],
    atencao: ["Atendimento concluído entra sozinho no caixa. Não lance de novo à mão.", "Recurso dos planos pagos."],
  },
  "faturamento-limites": {
    titulo: "Faturamento e limites",
    serve:
      "Acompanha quanto você faturou nos últimos 12 meses e avisa quando estiver chegando perto do limite do seu enquadramento (ex.: MEI).",
    passos: ["Em Configurações, escolha o enquadramento do seu espaço.", "Aqui, acompanhe o total e a barra até o limite."],
    atencao: ["É um acompanhamento para te avisar a tempo. Confirme os valores com o seu contador."],
  },
  contador: {
    titulo: "Relatório para o contador",
    serve: "Junta num relatório o que o contador costuma pedir: receitas, despesas e, se tiver, a parte dos parceiros.",
    passos: ["Escolha o mês ou o período.", "Imprima ou baixe a planilha.", "Envie para o seu contador."],
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
    serve: "Mostra seu plano, a próxima cobrança e deixa trocar de plano.",
    passos: ["Compare os planos.", "Escolha mensal ou anual (no anual você ganha 2 meses).", "Pague por Pix ou cartão."],
    atencao: [
      "Plano maior no mensal: muda na hora, e o novo valor vale a partir da próxima cobrança.",
      "Plano maior no anual: muda quando você pagar a diferença proporcional aos dias que faltam.",
      "Plano menor: começa na próxima renovação.",
      "Se o teste grátis acabar sem assinatura, a conta passa para o Grátis e nada é apagado.",
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
    serve: "É o endereço da sua página de agendamento, para colocar no Instagram e mandar para os clientes.",
    passos: ["Copie o link ou baixe o QR code.", "Coloque na bio do Instagram e no WhatsApp."],
    atencao: ["Se mudar o endereço, atualize onde já divulgou (Instagram, cartões, QR code impresso)."],
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
    atencao: ["Pedido não confirmado aparece como “pendente” no Início e na Agenda."],
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
      "Recurso dos planos pagos, em teste.",
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
      "No Remarcar, só a matriz e a recepção podem usar.",
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
    atencao: ["Datas com conflito são puladas, sem criar data extra no fim.", "Recurso dos planos pagos."],
  },
  "vender-pacote": {
    titulo: "Vender pacote",
    serve: "Registra a venda de um pacote para o cliente. O valor entra no caixa na hora.",
    passos: [
      "Escolha o pacote e a forma de pagamento.",
      "Escolha “Livre” (o cliente marca cada sessão depois) ou “Datas fixas”.",
      "Confirme a venda.",
    ],
    atencao: ["Recurso dos planos pagos."],
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
    serve: "Acrescenta serviços a um atendimento (ex.: chegou para corte e quer barba também) e aplica desconto.",
    passos: [
      "Toque em “Editar”.",
      "Em “Adicionar serviço”, escolha o serviço e decida se aumenta o tempo.",
      "Em “Desconto”, escolha R$ ou % e informe o valor.",
    ],
    atencao: [
      "O serviço original não sai, exceto nas sessões de pacote (veja “Serviços do pacote nesta data”).",
      "O profissional só dá desconto até o limite definido em Configurações.",
    ],
  },
  concluir: {
    titulo: "Concluir atendimento",
    serve: "Marca que o atendimento foi feito e lança o valor no caixa.",
    passos: ["Toque em “Concluir”.", "Confira o valor e escolha a forma de pagamento.", "Confirme."],
    atencao: [
      "Sessão de pacote não entra no caixa de novo: já foi paga na venda.",
      "Depois de concluir, o cliente pode receber o link de avaliação.",
    ],
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
} satisfies Record<string, AjudaItem>;

export type AjudaId = keyof typeof AJUDA_TEXTOS;
export const AJUDA: Record<AjudaId, AjudaItem> = AJUDA_TEXTOS;
