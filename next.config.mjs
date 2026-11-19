import { existsSync } from "node:fs";
import { join } from "node:path";

// Foto de capa do hero da "/" (opcional): public/brand/capa-hero.webp ou .jpg.
// Conferida no build (na Vercel a função não enxerga o public/); sem arquivo, o hero fica só com o fundo escuro.
const landingHeroImage =
  ["webp", "jpg"].map((ext) => `/brand/capa-hero.${ext}`).find((p) => existsSync(join(process.cwd(), "public", p))) ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { LANDING_HERO_IMAGE: landingHeroImage },
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
