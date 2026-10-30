"use client";

// Diálogo de recorte + compressão. Carregado sob demanda (next/dynamic) pelo
// PhotoUpload: react-easy-crop só entra no painel, e só quando alguém escolhe uma foto.
import { useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { decodePhoto, PhotoError, renderPhoto } from "@/lib/image-compress";

export type CropOutput = { suffix: string; size: { width: number; height: number } };
export type CropResult = { suffix: string; blob: Blob; ext: "webp" | "jpg"; type: "image/webp" | "image/jpeg" };

const PREVIEW_MAX = 1600; // a prévia do recorte não precisa da foto inteira

export default function PhotoCropDialog({
  file,
  aspect,
  outputs,
  title,
  onCancel,
  onError,
  onDone,
}: {
  file: File;
  aspect: number;
  outputs: CropOutput[];
  title: string;
  onCancel: () => void;
  onError: (message: string) => void;
  onDone: (results: CropResult[]) => Promise<void>;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [preview, setPreview] = useState<{ url: string; scale: number } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  // decodifica a foto e gera uma prévia leve (JPEG) para o recorte
  useEffect(() => {
    let cancelled = false;
    let url = "";
    (async () => {
      try {
        const bmp = await decodePhoto(file);
        const scale = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
        if (!blob) throw new PhotoError("Não conseguimos abrir essa foto. Tente outra em JPG ou PNG.");
        url = URL.createObjectURL(blob);
        if (cancelled) return;
        setBitmap(bmp);
        setPreview({ url, scale });
      } catch (e) {
        if (!cancelled) onError(e instanceof PhotoError ? e.message : "Não conseguimos abrir essa foto. Tente outra em JPG ou PNG.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // só quando o arquivo muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  async function confirm() {
    if (!bitmap || !preview || !area) return;
    setBusy(true);
    try {
      // área da prévia → pixels da foto original
      const s = 1 / preview.scale;
      const full = {
        x: Math.max(0, area.x * s),
        y: Math.max(0, area.y * s),
        width: Math.min(bitmap.width, area.width * s),
        height: Math.min(bitmap.height, area.height * s),
      };
      const results: CropResult[] = [];
      for (const o of outputs) results.push({ suffix: o.suffix, ...(await renderPhoto(bitmap, full, o.size)) });
      await onDone(results);
    } catch (e) {
      onError(e instanceof PhotoError ? e.message : "Não foi possível preparar a foto. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{title}</DialogTitle>
          <DialogDescription>Arraste para posicionar e use o zoom para ajustar o enquadramento.</DialogDescription>
        </DialogHeader>

        <div className="relative h-72 overflow-hidden rounded-xl bg-stone-900 sm:h-80">
          {preview ? (
            <Cropper
              image={preview.url}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, px) => setArea(px)}
              objectFit="contain"
            />
          ) : (
            <div className="grid h-full place-items-center text-stone-300">
              <Loader2 className="h-6 w-6 animate-spin" aria-label="Abrindo a foto" />
            </div>
          )}
        </div>

        <label className="flex min-h-11 items-center gap-3 text-sm">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-11 flex-1 accent-primary"
            aria-label="Zoom da foto"
            data-testid="range-foto-zoom"
          />
        </label>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11" onClick={onCancel} disabled={busy} data-testid="btn-foto-cancelar">
            Cancelar
          </Button>
          <Button type="button" className="h-11" onClick={confirm} disabled={!area || busy} data-testid="btn-foto-usar">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Usar esta foto"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
