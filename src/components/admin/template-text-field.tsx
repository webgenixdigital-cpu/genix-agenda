"use client";

import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { renderTemplate, type TemplateData } from "@/lib/whatsapp/templates";

export const TEMPLATE_MAX = 1000;

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultText: string;
  vars: readonly { key: string; label: string }[];
  /** dados de exemplo da prévia */
  sample: TemplateData;
  testIds: { restore: string; textarea: string; /** recebe a chave já em kebab-case */ varButton: (key: string) => string };
};

/** Texto de mensagem com variáveis: Restaurar padrão, chips que inserem no cursor, contador e prévia */
export function TemplateTextField({ id, label, value, onChange, defaultText, vars, sample, testIds }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertVar(key: string) {
    const el = ref.current;
    const token = `{${key}}`;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const next = (value.slice(0, start) + token + value.slice(end)).slice(0, TEMPLATE_MAX);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 text-muted-foreground"
          onClick={() => onChange(defaultText)}
          data-testid={testIds.restore}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" /> Restaurar padrão
        </Button>
      </div>
      <Textarea
        id={id}
        ref={ref}
        rows={7}
        maxLength={TEMPLATE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testIds.textarea}
      />
      <p className="text-right text-xs text-muted-foreground">
        {value.length}/{TEMPLATE_MAX}
      </p>
      <div className="flex flex-wrap gap-2">
        {vars.map((v) => (
          <button
            key={v.key}
            type="button"
            className="min-h-11 rounded-full border bg-white px-3 text-xs font-medium hover:bg-secondary"
            onClick={() => insertVar(v.key)}
            data-testid={testIds.varButton(v.key.replace(/_/g, "-"))}
          >
            {`{${v.key}}`} <span className="text-muted-foreground">· {v.label}</span>
          </button>
        ))}
      </div>
      <div className="rounded-xl bg-[#E7F7E1] p-3 text-sm">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Prévia</p>
        <p className="whitespace-pre-line break-words">{renderTemplate(value, sample)}</p>
      </div>
    </div>
  );
}
