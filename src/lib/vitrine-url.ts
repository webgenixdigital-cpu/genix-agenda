// Link curto da vitrine por subdomínio: https://<slug>.genixagenda.com.br
// O /v/<slug> continua funcionando. O middleware faz o rewrite (src/middleware.ts).
// Leve (sem dependências): pode ir para o middleware, servidor e navegador.

export const ROOT_DOMAIN = "genixagenda.com.br";
export const ROOT_ORIGIN = `https://${ROOT_DOMAIN}`;

/** Nunca viram vitrine (nem como subdomínio nem como slug) */
export const RESERVED_SUBDOMAINS = [
  "www", "wa", "app", "api", "genix", "admin", "painel", "mail", "email", "blog",
  "ajuda", "suporte", "status", "cdn", "docs", "static",
] as const;

/** Reservados de slug: subdomínios + rotas antigas (mesma lista do banco, migration 62) */
export const RESERVED_SLUGS: readonly string[] = [
  ...RESERVED_SUBDOMAINS, "v", "login", "auth", "assets", "public", "segmento",
];

/** Formato de slug = rótulo de DNS válido (o banco ainda limita a 40) */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isSubdomainSlug(slug: string | null | undefined): slug is string {
  return !!slug && SLUG_RE.test(slug) && !slug.includes("--") && !RESERVED_SLUGS.includes(slug);
}

/** "localhost:3000" / "127.0.0.1:3000" → é local? */
export function isLocalHost(host: string) {
  const h = host.toLowerCase().split(":")[0];
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
}

/**
 * Endereço público da vitrine.
 * - produção (ou sem origem): https://<slug>.genixagenda.com.br
 * - local (origem localhost): http://<slug>.localhost:<porta>, para testar
 * - slug que não serve como subdomínio: <origem>/v/<slug>
 */
export function vitrineUrl(slug: string, origin?: string | null) {
  let local: URL | null = null;
  if (origin) {
    try {
      const u = new URL(origin);
      if (isLocalHost(u.host)) local = u;
    } catch {
      /* origem inválida: segue para produção */
    }
  }
  if (!isSubdomainSlug(slug)) return `${local ? local.origin : ROOT_ORIGIN}/v/${slug}`;
  if (local) return `${local.protocol}//${slug}.localhost${local.port ? `:${local.port}` : ""}`;
  return `https://${slug}.${ROOT_DOMAIN}`;
}

/** Texto curto para mostrar: "nome.genixagenda.com.br" */
export function vitrineLabel(slug: string, origin?: string | null) {
  return vitrineUrl(slug, origin).replace(/^https?:\/\//, "");
}

/** Origem do site principal a partir do host atual (local: http://localhost:<porta>) */
export function mainOrigin(host: string | null | undefined) {
  if (host && isLocalHost(host)) {
    const port = host.split(":")[1];
    return `http://localhost${port ? `:${port}` : ""}`;
  }
  return ROOT_ORIGIN;
}

/**
 * Host → slug da vitrine, ou:
 * - null: não é subdomínio de vitrine (domínio principal, previews da Vercel, outros);
 * - "reserved": subdomínio reservado ou inválido (o middleware manda para o domínio principal).
 */
export function subdomainOf(host: string | null | undefined): string | null | "reserved" {
  if (!host) return null;
  const h = host.toLowerCase().split(":")[0];
  let sub: string | null = null;
  if (h.endsWith(`.${ROOT_DOMAIN}`)) sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  else if (h.endsWith(".localhost")) sub = h.slice(0, -".localhost".length);
  if (!sub) return null;
  return isSubdomainSlug(sub) ? sub : "reserved";
}
