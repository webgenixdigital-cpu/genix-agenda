"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Lock, SendHorizontal, Sparkles } from "lucide-react";
import { LockedFeatureCard } from "@/components/admin/locked-feature";
import { Ajuda } from "@/components/ajuda";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "bloqueado" | "teste" | "pago";
type Msg = { role: "user" | "model"; text: string };

const MAX = 1000;
const MAX_HISTORY_MSGS = 20; // 10 trocas, igual ao limite da rota
const SUGESTOES = [
  "Como cadastro o almoço como bloqueio?",
  "Como funciona o pagamento “Escolher depois”?",
  "O que muda entre o Profissional e o Equipe?",
];

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/**
 * Texto da Nix: só **negrito** vira <strong>; listas com "* " / "- " viram "• "; "#" de título sai.
 * Sem HTML vindo do modelo (React escapa o resto).
 */
function NixText({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^(\s*)[*-]\s+/, "$1• "));
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
              <strong key={j}>{part.slice(2, -2)}</strong>
            ) : (
              part
            )
          )}
          {i < lines.length - 1 && "\n"}
        </span>
      ))}
    </>
  );
}

export function NixChat({ mode, trialEndsAt }: { mode: Mode; trialEndsAt?: string | null }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, sending]);

  async function send(question: string) {
    const q = question.trim().slice(0, MAX);
    if (!q || sending) return;
    setError(null);
    setText("");
    // últimas 10 trocas (pergunta + resposta); a lista sempre alterna, então começa por uma pergunta
    const history = msgs.slice(-MAX_HISTORY_MSGS);
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setSending(true);
    try {
      const res = await fetch("/api/agente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string; restantes?: number | null; error?: string } | null;
      if (!res.ok || !data?.reply) {
        setError(data?.error ?? "Não foi possível falar com a Nix agora. Tente de novo em instantes.");
        // a pergunta volta para o campo, para tentar de novo
        setMsgs((m) => m.slice(0, -1));
        setText(q);
        return;
      }
      setMsgs((m) => [...m, { role: "model", text: data.reply! }]);
      if (typeof data.restantes === "number") setLeft(data.restantes);
    } catch {
      setError("Sem conexão. Confira a internet e tente de novo.");
      setMsgs((m) => m.slice(0, -1));
      setText(q);
    } finally {
      setSending(false);
    }
  }

  const locked = mode === "bloqueado";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={locked ? "Nix, assistente (plano Equipe)" : "Abrir a Nix, assistente"}
        className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:bg-primary/90 active:scale-95 md:bottom-6 md:right-6"
        data-testid="btn-nix"
      >
        <Sparkles className="h-6 w-6" />
        {locked && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-card text-primary ring-1 ring-border">
            <Lock className="h-3 w-3" />
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" data-testid="nix-painel">
          <div className="border-b px-4 py-3 pr-14">
            <SheetTitle className="flex items-center gap-2 font-heading text-2xl">
              <Sparkles className="h-5 w-5 text-primary" /> Nix
              <Ajuda id="nix" className="-ml-1" />
            </SheetTitle>
            <SheetDescription>Sua assistente para tirar dúvidas do Genix Agenda.</SheetDescription>
          </div>

          {locked ? (
            <div className="p-4">
              <LockedFeatureCard feature="nix" />
            </div>
          ) : (
            <>
              {mode === "teste" && trialEndsAt && (
                <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="nix-faixa-teste">
                  Nix liberada até {br(trialEndsAt)}.{" "}
                  <Link href="/admin/assinatura" className="inline-flex min-h-11 items-center font-semibold underline" onClick={() => setOpen(false)}>
                    Continue com o plano Equipe
                  </Link>
                  {left !== null && <span className="block text-xs">Perguntas restantes hoje: {left}</span>}
                </div>
              )}

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="nix-mensagens">
                {msgs.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Oi! Eu sou a Nix. Pergunte como fazer qualquer coisa no sistema. Por enquanto eu ainda não vejo a
                      agenda nem o caixa do seu espaço.
                    </p>
                    <div className="flex flex-col gap-2">
                      {SUGESTOES.map((s, i) => (
                        <Button
                          key={s}
                          type="button"
                          variant="outline"
                          className="h-auto min-h-11 justify-start whitespace-normal text-left"
                          onClick={() => send(s)}
                          disabled={sending}
                          data-testid={`btn-nix-sugestao-${i}`}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                      m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                    )}
                  >
                    {m.role === "model" ? <NixText text={m.text} /> : m.text}
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> A Nix está pensando…
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <form
                className="space-y-2 border-t p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                }}
              >
                {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-destructive" data-testid="nix-erro">{error}</p>}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, MAX))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(text);
                      }
                    }}
                    rows={2}
                    placeholder="Escreva sua dúvida…"
                    aria-label="Pergunta para a Nix"
                    className="min-h-11 flex-1 resize-none"
                    data-testid="input-nix"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    disabled={sending || !text.trim()}
                    aria-label="Enviar"
                    data-testid="btn-nix-enviar"
                  >
                    <SendHorizontal className="h-5 w-5" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  A Nix pode errar. Não envie senhas nem dados pessoais de clientes.
                </p>
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
