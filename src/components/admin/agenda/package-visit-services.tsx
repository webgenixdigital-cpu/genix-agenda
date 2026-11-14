"use client";

import { Ajuda } from "@/components/ajuda";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import {
  getPackageVisitOptions,
  setPackageVisitServices,
  type PackageVisitOptions,
} from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const br = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Sessão de pacote (48_pacote_servicos_por_data): marcar/desmarcar quais serviços
 * do pacote serão feitos nesta data. Some quando o agendamento não é de pacote.
 * Matriz, recepção e o profissional da própria data (o banco confere).
 */
export function PackageVisitServices({
  bookingId,
  open,
  onSaved,
}: {
  bookingId: string;
  open: boolean;
  /** recarrega os itens e totais do "Editar" */
  onSaved: () => Promise<void> | void;
}) {
  const [options, setOptions] = useState<PackageVisitOptions | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [pending, start] = useTransition();

  async function load() {
    const r = await getPackageVisitOptions(bookingId);
    if (!r || !r.ok) return setOptions(null);
    setOptions(r.options);
    setChecked((r.options?.items ?? []).filter((i) => i.marked && i.service_id).map((i) => i.service_id!));
  }

  useEffect(() => {
    if (!open) return;
    setOptions(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId]);

  if (!options) return null;

  const original = options.items.filter((i) => i.marked && i.service_id).map((i) => i.service_id!);
  const changed = original.length !== checked.length || original.some((id) => !checked.includes(id));

  function toggle(serviceId: string, on: boolean) {
    setChecked((list) => (on ? [...list, serviceId] : list.filter((x) => x !== serviceId)));
  }

  function save() {
    if (checked.length === 0) return void toast.error("Marque ao menos um serviço. Para não fazer nada nesta data, cancele o agendamento.");
    start(async () => {
      const r = await setPackageVisitServices(bookingId, checked);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      toast.success("Serviços do pacote atualizados");
      await load();
      await onSaved();
    });
  }

  return (
    <section className="space-y-2 rounded-xl border border-primary/30 bg-secondary/30 p-3" data-testid="servicos-pacote-data">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Package className="h-4 w-4 text-primary" /> Serviços do pacote nesta data
        <Ajuda id="servicos-pacote-data" />
      </h3>
      <p className="text-xs text-muted-foreground">
        {options.package_name}
        {options.expires_at && ` · vale até ${br(options.expires_at)}`}
      </p>

      {!options.editable ? (
        <p className="text-sm text-muted-foreground">
          Não dá para mudar: o agendamento não está pendente/confirmado ou o pacote não está mais valendo.
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {options.items.map((i) => {
              const id = i.service_id;
              const on = !!id && checked.includes(id);
              const remaining = i.sessions_total - i.used_elsewhere - (on ? 1 : 0);
              const disabled = !id || !i.can_do || (!on && remaining <= 0);
              return (
                <li key={i.package_item_id}>
                  <label
                    className={cn(
                      "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg bg-white px-3 text-sm",
                      disabled && !on && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-primary"
                      checked={on}
                      disabled={pending || (disabled && !on)}
                      onChange={(e) => id && toggle(id, e.target.checked)}
                      data-testid={`check-pacote-data-${i.package_item_id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.service_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {!i.can_do
                          ? "o profissional desta data não faz"
                          : `${Math.max(remaining, 0)} de ${i.sessions_total} restantes`}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Mais de um serviço vira uma visita só, com o tempo somado. Se desmarcar o primeiro, outro marcado vira o principal.
          </p>
          <Button
            className="h-11 w-full"
            disabled={pending || !changed || checked.length === 0}
            onClick={save}
            data-testid="btn-salvar-servicos-pacote"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar serviços desta data"}
          </Button>
        </>
      )}
    </section>
  );
}
