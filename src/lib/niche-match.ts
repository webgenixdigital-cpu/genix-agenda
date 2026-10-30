// Busca de nichos por nome e sinônimos, ignorando acentos e maiúsculas.
// Funções puras: usadas no servidor (/espacos) e no navegador (sugestões).

export type NicheOption = { id: string; name: string; keywords: string[] };

/** "Cílios " → "cilios" */
export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Pontuação do nicho para o termo (0 = não combina; maior = melhor) */
export function nicheScore(n: NicheOption, term: string) {
  const t = normalizeText(term);
  if (!t) return 0;
  const name = normalizeText(n.name);
  if (name.startsWith(t)) return 4;
  if (name.split(" ").some((w) => w.startsWith(t))) return 3;
  const kws = n.keywords.map(normalizeText);
  if (kws.some((k) => k.startsWith(t) || k.split(" ").some((w) => w.startsWith(t)))) return 2;
  // termo mais longo que contém um sinônimo inteiro ("manicure em sp" → unhas)
  if (t.length >= 3 && kws.some((k) => k.length >= 3 && t.includes(k))) return 1;
  return 0;
}

/** Nichos que combinam com o termo, do melhor para o pior (sem repetição) */
export function matchNiches<T extends NicheOption>(niches: T[], term: string, limit = 8): T[] {
  const seen = new Set<string>();
  return niches
    .map((n, i) => ({ n, i, s: nicheScore(n, term) }))
    .filter(({ n, s }) => s > 0 && !seen.has(n.id) && seen.add(n.id))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ n }) => n);
}
