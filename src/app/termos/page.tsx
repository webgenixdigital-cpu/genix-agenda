import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";
import { REFERRAL_TEXT } from "@/content/planos";

export const metadata = { title: "Termos de Uso | Genix Agenda" };

// MODELO: revise com um advogado antes de vender em escala.
export default function TermosPage() {
  return (
    <LegalPage title="Termos de Uso" updatedAt={LEGAL.termosAtualizadoEm}>
      <section>
        <h2>1. Quem somos e o que é o serviço</h2>
        <p>
          O {LEGAL.produto} é um software online oferecido por {LEGAL.razaoSocial} ({LEGAL.nomeFantasia}), CNPJ {LEGAL.cnpj},
          com sede em {LEGAL.endereco} (“Genix”, “nós”).
        </p>
        <p>
          O serviço permite que profissionais e estabelecimentos (“Profissional”, “você”) publiquem uma vitrine digital,
          recebam pedidos de agendamento de seus clientes (“Clientes Finais”) e organizem agenda, equipe e financeiro.
        </p>
        <p>Ao criar uma conta ou usar o serviço, você concorda com estes Termos e com a <Link href="/privacidade" className="underline">Política de Privacidade</Link>.</p>
      </section>

      <section>
        <h2>2. Conta e acesso</h2>
        <ul>
          <li>Você deve ter pelo menos 18 anos e fornecer informações verdadeiras, incluindo um e-mail válido que será confirmado.</li>
          <li>Você é responsável por manter sua senha em sigilo e por todas as ações realizadas na sua conta.</li>
          <li>Cada conta corresponde a um estabelecimento. A equipe pode ter acesso conforme as permissões disponíveis.</li>
        </ul>
      </section>

      <section>
        <h2>3. Planos, teste grátis e pagamento</h2>
        <ul>
          <li><strong>Teste grátis:</strong> toda conta nova recebe 15 dias do plano Equipe, com todos os recursos liberados (inclusive a vitrine com agendamento online), sem cadastro de cartão.</li>
          <li><strong>Plano Grátis:</strong> ao final do teste, se não houver assinatura, a conta passa automaticamente para o plano Grátis, com recursos e limites informados na página de planos (por exemplo, número de profissionais ativos). Nenhum dado é apagado nessa mudança.</li>
          <li><strong>Vitrine e agendamento online:</strong> a vitrine com agendamento online pelo cliente, a confirmação automática, a presença no diretório de espaços e o pedido de avaliação após o atendimento fazem parte dos planos Profissional e Equipe (e do teste grátis). Nos planos Grátis e Básico, o link do estabelecimento funciona como cartão de visita, com serviços, preços, endereço, horários, avaliações já recebidas e botão para contato pelo WhatsApp, sem agendamento online. Agendamentos online já marcados antes de uma mudança de plano continuam válidos.</li>
          <li><strong>Prazo do plano Grátis:</strong> o plano Grátis vale por 6 meses contados do cadastro (o teste de 15 dias está incluído nesse prazo). Para contas criadas antes de 18 de novembro de 2026, o prazo de 6 meses conta a partir dessa data. Ao fim do prazo, sem assinatura, o painel fica disponível só para consulta: é possível ver a agenda, os clientes e o histórico e cancelar horários, mas não criar, editar, remarcar ou concluir agendamentos nem cadastrar ou editar clientes, até a contratação de um plano pago. Nenhum dado é apagado.</li>
          <li><strong>Planos pagos (Básico, Profissional e Equipe):</strong> cobrados de forma mensal ou anual, conforme os valores vigentes na página de planos no momento da contratação, incluindo eventual valor por profissional adicional.</li>
          <li>Os pagamentos são processados por empresa parceira de meios de pagamento. A renovação é automática ao fim de cada período, até o cancelamento.</li>
          <li>Em caso de falta de pagamento, poderemos, após aviso, retornar a conta ao plano Grátis.</li>
          <li>Alterações de preço serão comunicadas com antecedência e só valem para o período seguinte.</li>
          <li>
            <strong>Indique e ganhe:</strong> cada conta tem um link de indicação. Quando um espaço novo, cadastrado por esse link,
            paga a primeira cobrança de um plano pago, quem indicou ganha um crédito na própria assinatura. Regras:
            <ul>
              <li>{REFERRAL_TEXT.howMuch}</li>
              <li>o crédito reduz o valor da próxima cobrança de quem indicou (no plano anual, a renovação);</li>
              <li>{REFERRAL_TEXT.fullMonth}</li>
              <li>se a próxima cobrança ainda não foi gerada, o crédito fica guardado e é aplicado quando ela for gerada. Cada cobrança recebe no máximo 1 crédito; os demais ficam para as cobranças seguintes;</li>
              <li>a indicação só vale no cadastro da conta nova e não pode ser feita depois;</li>
              <li>cada espaço indicado gera no máximo 1 prêmio, mesmo que cancele e assine de novo;</li>
              <li>não há limite de indicações. Vários prêmios se acumulam e são usados em sequência;</li>
              <li>para quem ainda não tem assinatura paga, os prêmios ficam guardados e são usados após o pagamento da primeira assinatura;</li>
              <li>não vale indicar a si mesmo (mesmo dono, e-mail, WhatsApp ou CPF/CNPJ);</li>
              <li>se a primeira cobrança do espaço indicado for estornada ou cancelada antes do uso, o prêmio é cancelado;</li>
              <li>o prêmio é desconto na assinatura, não pode ser trocado por dinheiro e não muda a data final de descontos promocionais em vigor;</li>
              <li>prêmios gerados antes desta regra continuam valendo 1 mês grátis.</li>
            </ul>
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Cancelamento e direito de arrependimento</h2>
        <ul>
          <li>Você pode cancelar a assinatura a qualquer momento. O acesso ao plano pago continua até o fim do período já pago.</li>
          <li>Nos termos do Código de Defesa do Consumidor, quando aplicável, você pode desistir da contratação em até 7 dias da primeira cobrança, com devolução do valor pago.</li>
          <li>Fora dessa hipótese, não há reembolso proporcional de períodos já iniciados, salvo previsão legal.</li>
        </ul>
      </section>

      <section>
        <h2>5. Suas responsabilidades</h2>
        <ul>
          <li>Você é responsável pelo conteúdo publicado na sua vitrine (textos, preços, imagens, serviços) e por ter os direitos de uso das imagens.</li>
          <li>Você é responsável pela prestação dos seus serviços aos Clientes Finais, incluindo preços, qualidade, atendimento, cancelamentos e reembolsos entre você e eles.</li>
          <li>Você é o controlador dos dados pessoais dos seus Clientes Finais e deve tratá-los conforme a Lei Geral de Proteção de Dados (LGPD), usando-os apenas para fins relacionados ao atendimento.</li>
          <li>As mensagens enviadas por WhatsApp a partir do sistema são de sua responsabilidade e devem respeitar as regras do WhatsApp e o consentimento dos clientes.</li>
          <li>O {LEGAL.produto} não é destinado ao registro de prontuários ou informações clínicas. Não insira dados de saúde dos clientes no sistema.</li>
        </ul>
      </section>

      <section>
        <h2>6. Usos proibidos</h2>
        <ul>
          <li>Publicar conteúdo ilegal, enganoso, ofensivo ou que viole direitos de terceiros.</li>
          <li>Tentar acessar dados de outros estabelecimentos, burlar limites dos planos ou prejudicar o funcionamento do serviço.</li>
          <li>Usar o serviço para envio de mensagens em massa não solicitadas (spam).</li>
        </ul>
        <p>Em caso de violação, poderemos suspender ou encerrar a conta, mediante aviso quando possível.</p>
      </section>

      <section>
        <h2>7. Disponibilidade e limitação de responsabilidade</h2>
        <ul>
          <li>Trabalhamos para manter o serviço disponível e seguro, mas podem ocorrer interrupções para manutenção ou por falhas de terceiros (hospedagem, internet, provedores de mensagens e pagamentos).</li>
          <li>Não nos responsabilizamos por perdas indiretas, lucros cessantes ou por atos de Clientes Finais (como faltas a agendamentos).</li>
          <li>Recomendamos que você mantenha controle próprio das informações essenciais do seu negócio.</li>
        </ul>
      </section>

      <section>
        <h2>8. Propriedade intelectual</h2>
        <p>
          O software, a marca {LEGAL.produto} e os materiais do serviço pertencem à Genix. O conteúdo que você publica continua sendo seu;
          você nos autoriza a exibi-lo na sua vitrine e no diretório do {LEGAL.produto} enquanto a vitrine estiver publicada.
        </p>
      </section>

      <section>
        <h2>9. Encerramento da conta</h2>
        <p>
          Você pode pedir o encerramento da conta pelo e-mail {LEGAL.emailContato}. Os dados serão tratados conforme a
          Política de Privacidade, respeitados os prazos legais de guarda.
        </p>
      </section>

      <section>
        <h2>10. Alterações e foro</h2>
        <p>
          Podemos atualizar estes Termos. Mudanças relevantes serão avisadas no painel ou por e-mail. Fica eleito o foro de {LEGAL.foro},
          ressalvado o direito do consumidor de propor ação no foro do seu domicílio.
        </p>
        <p>Dúvidas: <a href={`mailto:${LEGAL.emailContato}`} className="underline">{LEGAL.emailContato}</a>.</p>
      </section>
    </LegalPage>
  );
}
