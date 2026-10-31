import type { MetadataRoute } from "next";

/** robots.txt: libera as páginas públicas e bloqueia painel, administração, rotas técnicas e telas de conta */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/genix",
        "/api",
        "/auth",
        "/demo",
        "/cadastro",
        "/esqueci-senha",
        "/redefinir-senha",
        "/v/*/avaliar",
      ],
    },
    sitemap: "https://genixagenda.com.br/sitemap.xml",
  };
}
