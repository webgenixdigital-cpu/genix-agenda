import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Política de Privacidade | Genix Agenda" };

// MODELO: revise com um advogado antes de vender em escala.
export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de Privacidade">
      <section>
        <p>
          Esta política explica como o {LEGAL.produto}, oferecido por {LEGAL.razaoSocial} ({LEGAL.nomeFantasia}), CNPJ {LEGAL.cnpj},
          trata dados pessoais, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).
        </p>
      </section>

      <section>
        <h2>1. Papéis de cada parte</h2>
        <ul>
          <li><strong>Dados dos Profissionais</strong> (quem cria conta): a Genix é a <strong>controladora</strong>.</li>
          <li><strong>Dados dos Clientes Finais</strong> (quem agenda pela vitrine): o <strong>Profissional</strong> é o controlador, e a Genix atua como <strong>operadora</strong>, tratando os dados apenas para fornecer o serviço ao Profissional.</li>
        </ul>
        <p>Pedidos sobre dados de agendamentos devem ser feitos diretamente ao estabelecimento. Quando recebermos esses pedidos, vamos encaminhá-los.</p>
      </section>

      <section>
        <h2>2. Dados que tratamos</h2>
        <ul>
          <li><strong>Profissionais:</strong> nome, e-mail, senha (armazenada de forma criptografada), WhatsApp, dados do estabelecimento (nome, endereço, serviços, preços, horários, equipe) e dados de pagamento da assinatura, processados pelo parceiro de pagamentos.</li>
          <li><strong>Clientes Finais:</strong> nome, WhatsApp, observações informadas no agendamento, histórico de agendamentos e avaliações publicadas (exibidas com o nome abreviado).</li>
          <li><strong>Dados técnicos:</strong> registros de acesso e cookies essenciais de sessão, necessários para manter o login.</li>
        </ul>
        <p>O serviço não se destina a dados de saúde ou prontuários e não deve ser usado para isso.</p>
      </section>

      <section>
        <h2>3. Para que usamos</h2>
        <ul>
          <li>Criar e manter contas, autenticar o acesso e recuperar senhas (execução de contrato).</li>
          <li>Exibir a vitrine, registrar agendamentos e permitir o contato por WhatsApp (execução de contrato).</li>
          <li>Cobrar assinaturas e emitir comprovantes (execução de contrato e obrigação legal).</li>
          <li>Enviar avisos operacionais por e-mail, como confirmação de conta, recuperação de senha e fim do teste (execução de contrato).</li>
          <li>Manter a segurança, prevenir fraudes e cumprir obrigações legais (legítimo interesse e obrigação legal).</li>
        </ul>
        <p>Não vendemos dados pessoais.</p>
      </section>

      <section>
        <h2>4. Com quem compartilhamos</h2>
        <p>Usamos fornecedores que tratam dados em nosso nome, com medidas de segurança adequadas:</p>
        <ul>
          <li>Hospedagem e banco de dados (Vercel e Supabase), que podem armazenar dados fora do Brasil, com garantias contratuais.</li>
          <li>Envio de e-mails transacionais (Resend).</li>
          <li>Processamento de pagamentos da assinatura (Asaas).</li>
        </ul>
        <p>Também podemos compartilhar dados quando exigido por lei ou por ordem de autoridade competente.</p>
      </section>

      <section>
        <h2>5. Por quanto tempo guardamos</h2>
        <p>
          Mantemos os dados enquanto a conta estiver ativa. Após o encerramento, excluímos ou anonimizamos os dados, exceto
          quando a guarda for exigida por lei (por exemplo, registros de acesso e documentos fiscais, pelos prazos legais).
        </p>
      </section>

      <section>
        <h2>6. Segurança</h2>
        <p>
          Adotamos criptografia na comunicação, senhas criptografadas, isolamento dos dados de cada estabelecimento e controle de
          acesso. Nenhum sistema é totalmente imune a incidentes; se ocorrer algum que possa gerar risco relevante, comunicaremos
          os afetados e a ANPD, conforme a lei.
        </p>
      </section>

      <section>
        <h2>7. Seus direitos</h2>
        <p>Você pode solicitar, nos termos da LGPD:</p>
        <ul>
          <li>Confirmação e acesso aos seus dados.</li>
          <li>Correção de dados incompletos ou desatualizados.</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários.</li>
          <li>Portabilidade e informação sobre compartilhamentos.</li>
          <li>Revogação de consentimento, quando essa for a base legal.</li>
        </ul>
        <p>
          Contato do encarregado de dados: <a href={`mailto:${LEGAL.emailPrivacidade}`} className="underline">{LEGAL.emailPrivacidade}</a>.
          Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </section>

      <section>
        <h2>8. Cookies</h2>
        <p>
          Usamos apenas cookies essenciais para manter você conectado ao painel. Não usamos cookies de publicidade.
        </p>
      </section>

      <section>
        <h2>9. Alterações</h2>
        <p>Esta política pode ser atualizada. A data no topo indica a versão vigente. Mudanças relevantes serão avisadas no painel ou por e-mail.</p>
      </section>
    </LegalPage>
  );
}
