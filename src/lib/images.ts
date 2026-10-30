// Fotos no Supabase Storage (bucket público "imagens", migration 27).
// As colunas (businesses.hero_image, professionals.photo_url) guardam a URL
// pública completa; links antigos colados (https://...) continuam valendo.
//
// Nomes dos arquivos (pasta = id do espaço; só o dono escreve nela):
//   {business_id}/capa-{ts}.webp        capa 1200×675
//   {business_id}/capa-{ts}-mini.webp   miniatura 600×338 (cartão da /espacos)
//   {business_id}/profissionais/{ts}.webp  foto 400×400
// (".jpg" no lugar de ".webp" quando o navegador não gera WebP)

export const IMAGE_BUCKET = "imagens";

export const IMAGE_SIZES = {
  capa: { width: 1200, height: 675 },
  capaMini: { width: 600, height: 338 },
  profissional: { width: 400, height: 400 },
} as const;

/** Início das URLs públicas do bucket */
export function imagePublicPrefix() {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/`;
}

/** Caminho no bucket se a URL é uma foto nossa deste espaço; senão null */
export function storagePathOf(url: string | null | undefined, businessId: string): string | null {
  if (!url) return null;
  const prefix = imagePublicPrefix();
  if (!url.startsWith(prefix)) return null;
  const path = decodeURIComponent(url.slice(prefix.length).split("?")[0]);
  return path.startsWith(`${businessId}/`) && !path.includes("..") ? path : null;
}

const COVER_RE = /\/capa-(\d+)\.(webp|jpg)$/;

/** Miniatura da capa (600×338). Link externo antigo: a própria URL. */
export function coverThumb(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith(imagePublicPrefix()) || !COVER_RE.test(url)) return url;
  return url.replace(COVER_RE, "/capa-$1-mini.$2");
}

/** Arquivos do Storage ligados a uma URL (capa: capa + miniatura) */
export function storagePathsFor(url: string | null | undefined, businessId: string): string[] {
  const path = storagePathOf(url, businessId);
  if (!path) return [];
  const mini = COVER_RE.test(`/${path.split("/").pop()}`) ? path.replace(/\.(webp|jpg)$/, "-mini.$1") : null;
  return mini ? [path, mini] : [path];
}

/**
 * Apaga do Storage a foto antiga (e a miniatura) quando ela foi trocada ou
 * removida. Só mexe em arquivos nossos, da pasta deste espaço; links externos
 * antigos ficam como estão. Falha ao apagar não impede o salvamento.
 */
export async function removeReplacedImage(
  supabase: { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } },
  businessId: string,
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined
) {
  if (!oldUrl || oldUrl === newUrl) return;
  const paths = storagePathsFor(oldUrl, businessId);
  if (!paths.length) return;
  try {
    await supabase.storage.from(IMAGE_BUCKET).remove(paths);
  } catch {
    /* arquivo fica órfão no bucket; a foto nova já está salva */
  }
}
