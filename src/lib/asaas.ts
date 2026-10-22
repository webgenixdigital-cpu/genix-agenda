// Cliente da API do Asaas (SOMENTE NO SERVIDOR).
// Ambiente definido por ASAAS_API_URL (sandbox ou produção) + ASAAS_API_KEY.

export class AsaasError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function asaas<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const base = process.env.ASAAS_API_URL;
  const key = process.env.ASAAS_API_KEY;
  if (!base || !key) throw new AsaasError(500, "Asaas não configurado (ASAAS_API_URL / ASAAS_API_KEY).");

  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "GenixAgenda/1.0",
      access_token: key,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    // O Asaas devolve { errors: [{ code, description }] }
    const description =
      (json?.errors as { description?: string }[] | undefined)?.map((e) => e.description).join(" ") ||
      `Erro ${res.status} no Asaas`;
    throw new AsaasError(res.status, description);
  }
  return json as T;
}

// ---------------------------------------------------------------------
// Tipos usados pelo Genix Agenda
// ---------------------------------------------------------------------
export type AsaasBillingType = "PIX" | "BOLETO" | "CREDIT_CARD";

export type AsaasCustomer = { id: string };

export type AsaasSubscription = {
  id: string;
  status: string;
  nextDueDate: string;
  cycle: "MONTHLY" | "YEARLY";
  value: number;
  externalReference?: string;
};

export type AsaasPayment = {
  id: string;
  status: string;
  dueDate: string;
  invoiceUrl: string;
  subscription?: string;
};
