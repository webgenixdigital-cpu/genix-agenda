/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // páginas dinâmicas (painel) não ficam guardadas no navegador: voltar à Agenda pelo menu
    // ou pelo Início sempre busca de novo (abre em "hoje" mesmo logo após a meia-noite)
    staleTimes: { dynamic: 0 },
  },
  async redirects() {
    return [
      // a página do profissional virou a "/"; 301 para não quebrar links já divulgados
      { source: "/profissional", destination: "/", statusCode: 301 },
    ];
  },
};

export default nextConfig;
