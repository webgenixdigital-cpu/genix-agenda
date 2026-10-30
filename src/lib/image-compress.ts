// Recorte e compressão de fotos NO NAVEGADOR (canvas + createImageBitmap).
// Só é importado pelo diálogo de recorte do painel (carregado sob demanda).

export const MAX_PICK_BYTES = 8 * 1024 * 1024; // escolha: até 8 MB
const TARGET_BYTES = 250 * 1024; // meta do arquivo final
const HARD_LIMIT = 1024 * 1024; // limite do bucket

export type CropArea = { x: number; y: number; width: number; height: number };

export class PhotoError extends Error {}

const ACCEPTED = /^image\/(jpeg|png|webp|heic|heif)$/;
const HEIC = /\.(heic|heif)$/i;

/** Confere tipo e tamanho do arquivo escolhido */
export function checkPicked(file: File) {
  const isHeic = HEIC.test(file.name) || /heic|heif/.test(file.type);
  if (!ACCEPTED.test(file.type) && !isHeic && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new PhotoError("Formato não aceito. Envie uma foto em JPG, PNG, WEBP ou HEIC.");
  }
  if (file.size > MAX_PICK_BYTES) throw new PhotoError("A foto passa de 8 MB. Escolha uma foto menor.");
  return { isHeic };
}

/** Decodifica a foto (respeita a rotação do celular). HEIC só abre onde o navegador suporta. */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  const { isHeic } = checkPicked(file);
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError(
      isHeic
        ? "Este navegador não abre fotos HEIC. Envie a foto em JPG (no iPhone: Ajustes › Câmera › Formatos › Mais compatível)."
        : "Não conseguimos abrir essa foto. Tente outra em JPG ou PNG."
    );
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Recorta a área e gera o arquivo no tamanho final: WebP ~0,8 (desce até 0,6
 * se passar de 250 KB). Navegador que não gera WebP (alguns Safari) → JPEG.
 */
export async function renderPhoto(
  bitmap: ImageBitmap,
  area: CropArea,
  size: { width: number; height: number }
): Promise<{ blob: Blob; ext: "webp" | "jpg"; type: "image/webp" | "image/jpeg" }> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Não foi possível preparar a foto neste navegador.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff"; // PNG com transparência vira fundo branco
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height);

  for (const type of ["image/webp", "image/jpeg"] as const) {
    let best: Blob | null = null;
    for (const q of [0.8, 0.72, 0.65, 0.6]) {
      const blob = await toBlob(canvas, type, q);
      if (!blob || blob.type !== type) break; // formato não suportado: tenta o próximo
      best = blob;
      if (blob.size <= TARGET_BYTES) break;
    }
    if (best && best.size <= HARD_LIMIT) return { blob: best, ext: type === "image/webp" ? "webp" : "jpg", type };
  }
  throw new PhotoError("Não foi possível comprimir a foto. Tente outra imagem.");
}
