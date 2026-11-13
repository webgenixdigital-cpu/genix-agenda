// Telefone internacional (45) — parte que usa a libphonenumber-js (versão "min").
// Fica fora de lib/phone.ts para não pesar as telas que só exibem números:
// usada nas server actions (validação) e no PhoneInput (carregado sob demanda).

import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { BR, cleanCountry, isPhoneShapeValid, normalizePhone } from "@/lib/phone";

/** Validação completa: Brasil = regra de sempre; outros = regra do banco + libphonenumber */
export function isPhoneValid(country: string, national: string) {
  const c = cleanCountry(country);
  if (!isPhoneShapeValid(c, national)) return false;
  if (c === BR) return true;
  return isValidPhoneNumber(`+${c}${national}`);
}

/**
 * Telefone digitado → { país, número nacional } pronto para gravar, ou null
 * se for inválido. Usado pelas server actions (o banco reconfere).
 */
export function parseCustomerPhone(raw: string | null | undefined, country?: string | null) {
  const c = cleanCountry(country);
  const phone = normalizePhone(raw ?? "", c);
  return isPhoneValid(c, phone) ? { country: c, phone } : null;
}

/** "+351 912 345 678" / "00351…" → país e número nacional (ou null) */
export function parseInternational(text: string) {
  const parsed = parsePhoneNumberFromString(text.trim().replace(/^00/, "+"));
  if (!parsed?.countryCallingCode) return null;
  return { country: String(parsed.countryCallingCode), national: String(parsed.nationalNumber), region: parsed.country ?? null };
}

// ---------------------------------------------------------------------
// Lista de países para o seletor
// ---------------------------------------------------------------------
export type PhoneCountry = { iso: CountryCode; code: string; name: string; flag: string };

/** Brasil primeiro; depois os mais comuns para os clientes da Genix */
export const PRIORITY: CountryCode[] = ["BR", "PT", "US", "AR", "PY", "UY", "ES", "IT"];

const flagOf = (iso: string) =>
  String.fromCodePoint(...iso.toUpperCase().split("").map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

let cache: { priority: PhoneCountry[]; rest: PhoneCountry[] } | null = null;

export function phoneCountries() {
  if (cache) return cache;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["pt-BR"], { type: "region" });
  } catch {
    names = null;
  }
  const all: PhoneCountry[] = getCountries().map((iso) => ({
    iso,
    code: String(getCountryCallingCode(iso)),
    name: names?.of(iso) ?? iso,
    flag: flagOf(iso),
  }));
  const priority = PRIORITY.map((iso) => all.find((c) => c.iso === iso)).filter((c): c is PhoneCountry => !!c);
  const rest = all.filter((c) => !PRIORITY.includes(c.iso)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  cache = { priority, rest };
  return cache;
}

/**
 * Região (bandeira) de um número salvo: o banco guarda só o código do país,
 * e +1 é EUA e Canadá; a região sai do próprio número (ou a principal do código).
 */
export function regionOf(country: string, national = ""): CountryCode | null {
  const c = cleanCountry(country);
  if (c === BR) return "BR";
  const parsed = national ? parsePhoneNumberFromString(`+${c}${national}`) : undefined;
  if (parsed?.country) return parsed.country;
  const { priority, rest } = phoneCountries();
  return ([...priority, ...rest].find((x) => x.code === c)?.iso as CountryCode | undefined) ?? null;
}
