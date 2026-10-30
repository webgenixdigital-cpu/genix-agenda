"use client";

// "Enviar foto" do painel: escolhe → recorta e comprime no navegador → envia ao
// Storage (bucket "imagens", pasta do espaço) → devolve a URL pública.
// O recorte (react-easy-crop) só é carregado quando alguém escolhe uma foto.
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CropResult } from "@/components/admin/photo/photo-crop-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IMAGE_BUCKET, IMAGE_SIZES } from "@/lib/images";
import { cn } from "@/lib/utils";

const PhotoCropDialog = dynamic(() => import("@/components/admin/photo/photo-crop-dialog"), { ssr: false });

const KINDS = {
  capa: {
    aspect: 16 / 9,
    title: "Ajustar a foto de capa",
    outputs: [
      { suffix: "", size: IMAGE_SIZES.capa },
      { suffix: "-mini", size: IMAGE_SIZES.capaMini },
    ],
  },
  profissional: {
    aspect: 1,
    title: "Ajustar a foto",
    outputs: [{ suffix: "", size: IMAGE_SIZES.profissional }],
  },
} as const;

// cliente do Supabase no navegador: só carregado na hora de enviar/apagar (fora do bundle inicial)
const browserClient = () => import("@/lib/supabase/client").then((m) => m.createClient());

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

/** Apaga do Storage arquivos enviados agora e não usados (ex.: troca antes de salvar) */
export async function removeUploaded(paths: string[]) {
  if (paths.length) await (await browserClient()).storage.from(IMAGE_BUCKET).remove(paths);
}

export function PhotoUpload({
  kind,
  businessId,
  value,
  readOnly = false,
  help,
  onUploaded,
  onRemove,
  onLinkChange,
  testid,
}: {
  kind: keyof typeof KINDS;
  businessId: string;
  value: string;
  /** demonstração / sem permissão: o botão abre o convite (?demo=bloqueado) */
  readOnly?: boolean;
  help?: string;
  /** URL pública nova + caminhos enviados (para apagar se não for usada) */
  onUploaded: (url: string, paths: string[]) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  /** link colado (fotos antigas por URL continuam valendo) */
  onLinkChange?: (url: string) => void;
  testid: string;
}) {
  const cfg = KINDS[kind];
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function pick() {
    if (readOnly) {
      router.push(`${pathname}?demo=bloqueado`);
      return;
    }
    inputRef.current?.click();
  }

  async function upload(results: CropResult[]) {
    const supabase = await browserClient();
    const base = kind === "capa" ? `${businessId}/capa-${Date.now()}` : `${businessId}/profissionais/${Date.now()}`;
    const paths: string[] = [];
    for (const r of results) {
      const path = `${base}${r.suffix}.${r.ext}`;
      const { error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, r.blob, { contentType: r.type, cacheControl: "31536000", upsert: false });
      if (error) {
        await removeUploaded(paths);
        toast.error("Não foi possível enviar a foto. Confira a conexão e tente de novo.");
        return;
      }
      paths.push(path);
    }
    const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(paths[0]).data.publicUrl;
    setFile(null);
    setBusy(true);
    try {
      await onUploaded(url, paths);
      toast.success(`Foto pronta (${Math.round(results[0].blob.size / 1024)} KB)`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (readOnly) {
      router.push(`${pathname}?demo=bloqueado`);
      return;
    }
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Prévia */}
        <div
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden border bg-secondary text-muted-foreground",
            kind === "capa" ? "aspect-video w-full rounded-xl sm:w-56" : "h-24 w-24 rounded-full"
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Prévia da foto" className="h-full w-full object-cover" data-testid={`${testid}-previa`} />
          ) : (
            <ImagePlus className="h-6 w-6" aria-hidden />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={pick} disabled={busy} data-testid={`${testid}-enviar`}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            Enviar foto
          </Button>
          {value && (
            <Button type="button" variant="ghost" className="h-11 text-muted-foreground hover:text-destructive" onClick={remove}
              disabled={busy} data-testid={`${testid}-remover`}>
              <Trash2 className="mr-2 h-4 w-4" /> Remover
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // permite escolher a mesma foto de novo
            if (f) setFile(f);
          }}
          data-testid={`${testid}-arquivo`}
        />
      </div>

      {help && <p className="text-xs text-muted-foreground">{help}</p>}

      {onLinkChange && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">Ou cole um link da foto</summary>
          <Input className="mt-1 h-11" placeholder="https://..." value={value} onChange={(e) => onLinkChange(e.target.value)}
            data-testid={`${testid}-link`} />
        </details>
      )}

      {file && (
        <PhotoCropDialog
          file={file}
          aspect={cfg.aspect}
          outputs={[...cfg.outputs]}
          title={cfg.title}
          onCancel={() => setFile(null)}
          onError={(m) => {
            setFile(null);
            toast.error(m);
          }}
          onDone={upload}
        />
      )}
    </div>
  );
}
