/**
 * Auditoria de responsividade — só leitura.
 *
 * Abre cada rota em 360, 390, 768, 1024 e 1440 px e mede:
 *  - rolagem lateral (document.documentElement.scrollWidth > innerWidth) e elementos que passam da tela;
 *  - conteúdo cortado (filho que estoura a caixa do pai / texto maior que a própria caixa);
 *  - alvos de toque < 44 px (links dentro de parágrafo são ignorados; ::after de .tap-target conta).
 * Abre também os diálogos principais (360 e 768) e mede se cabem na tela com rolagem interna.
 * Painel pela demo (viewer). Nenhum botão de salvar é clicado; escritas diretas no Supabase são abortadas.
 *
 * Saída: responsivo-report/relatorio-<rótulo>.md + .json + prints/ (pasta ignorada pelo Git).
 * Rótulo: RESPONSIVO_ROTULO (padrão "atual"). Link de avaliação opcional: RESPONSIVO_AVALIAR_URL.
 */
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const WIDTHS = [360, 390, 768, 1024, 1440];
const DIALOG_SIZES = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
];
// RESPONSIVO_LARGURAS=360,768 roda só essas larguras (o relatório continua com todas as colunas)
const ONLY_WIDTHS = (process.env.RESPONSIVO_LARGURAS ?? "").split(",").map(Number).filter(Boolean);
const runWidth = (w: number) => !ONLY_WIDTHS.length || ONLY_WIDTHS.includes(w);
const OUT = path.join(process.cwd(), "responsivo-report");
const LABEL = process.env.RESPONSIVO_ROTULO ?? "atual";
const SHOTS = path.join(OUT, "prints", LABEL);

type Measure = {
  W: number;
  sw: number;
  hscroll: boolean;
  offscreen: string[];
  cut: string[];
  small: string[];
};
type Row = { kind: "rota" | "dialogo"; name: string; width: number; status: string; problems: string[] };

const rows: Row[] = [];

/* ------------------------------------------------------------------ medição no navegador */

function measurePage(): Measure {
  const W = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const sel = (el: Element) => {
    const h = el as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (h.dataset?.testid) return `${tag}[data-testid=${h.dataset.testid.replace(uuid, "…")}]`;
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    const txt = (h.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    return `${tag}${cls ? "." + cls : ""}${txt ? ` «${txt}»` : ""}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && !el.closest("[aria-hidden=true]");
  };
  // dentro de um contêiner com rolagem/corte que cabe na tela (tabela, carrossel, grade semanal)
  const clipped = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  const all = Array.from(document.querySelectorAll("body *")).filter(visible);

  const off = all.filter((el) => {
    const r = el.getBoundingClientRect();
    return (r.right > W + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed" && !clipped(el);
  });
  const offscreen = off
    .filter((el) => !off.includes(el.parentElement as Element))
    .slice(0, 6)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${sel(el)} (x ${Math.round(r.left)}→${Math.round(r.right)}, largura ${Math.round(r.width)})`;
    });

  const cut: string[] = [];
  for (const el of all) {
    if (cut.length >= 6) break;
    const h = el as HTMLElement;
    const s = getComputedStyle(el);
    if (s.display.startsWith("inline") && !s.display.includes("block") && !s.display.includes("flex")) continue;
    if (s.textOverflow === "ellipsis" || clipped(el)) continue;
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim());
    if (hasText && !el.classList.contains("tap-target") && s.overflowX === "visible" && h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 1) {
      cut.push(`${sel(el)} (texto ${h.scrollWidth} px em caixa de ${h.clientWidth} px)`);
      continue;
    }
    // filho que passa da borda direita do pai (sem margem negativa intencional)
    if (s.overflowX !== "visible" || ["fixed", "absolute"].includes(s.position)) continue;
    const pr = el.getBoundingClientRect();
    for (const c of Array.from(el.children)) {
      const cs = getComputedStyle(c);
      if (!visible(c) || ["fixed", "absolute"].includes(cs.position)) continue;
      if (parseFloat(cs.marginLeft) < 0 || parseFloat(cs.marginRight) < 0) continue;
      const cr = c.getBoundingClientRect();
      if (cr.right > pr.right + 2 && pr.width > 0) {
        cut.push(`${sel(c)} passa ${Math.round(cr.right - pr.right)} px de ${sel(el)}`);
        break;
      }
    }
  }

  const small: string[] = [];
  const seen = new Set<string>();
  const targets = document.querySelectorAll(
    "a[href],button,input:not([type=hidden]),select,textarea,[role=tab],[role=checkbox],[role=switch],[role=combobox],[role=radio]"
  );
  for (const el of Array.from(targets)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue; // select nativo escondido do Radix
    if ((el as HTMLElement).closest("p, li p, dd") && el.tagName === "A") continue; // link dentro de texto
    const after = getComputedStyle(el, "::after");
    const aw = after.content !== "none" && after.position === "absolute" ? parseFloat(after.width) || 0 : 0;
    const ah = after.content !== "none" && after.position === "absolute" ? parseFloat(after.height) || 0 : 0;
    const label = el.closest("label")?.getBoundingClientRect();
    const w = Math.max(r.width, aw, label?.width ?? 0);
    const hgt = Math.max(r.height, ah, label?.height ?? 0);
    if (w >= 43.5 && hgt >= 43.5) continue;
    const key = sel(el);
    if (seen.has(key)) continue;
    seen.add(key);
    small.push(`${key} ${Math.round(w)}×${Math.round(hgt)}`);
  }
  return { W, sw, hscroll: sw > W, offscreen, cut, small: small.slice(0, 15) };
}

function measureDialog() {
  const d = Array.from(document.querySelectorAll("[role=dialog]")).pop() as HTMLElement | undefined;
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const s = getComputedStyle(d);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const problems: string[] = [];
  if (r.left < -1 || r.right > W + 1) problems.push(`diálogo não cabe na largura (x ${Math.round(r.left)}→${Math.round(r.right)} de ${W})`);
  if (r.top < -1 || r.bottom > H + 1) problems.push(`diálogo não cabe na altura (${Math.round(r.height)} px de ${H})`);
  if (d.scrollHeight > d.clientHeight + 1 && !/(auto|scroll)/.test(s.overflowY)) problems.push("conteúdo mais alto que o diálogo sem rolagem interna");
  if (W < 768 && r.left < 4 && r.right > W - 4) problems.push(`diálogo encosta na borda (largura ${Math.round(r.width)} de ${W})`);
  if (d.scrollWidth > d.clientWidth + 1) problems.push(`rolagem lateral dentro do diálogo (${d.scrollWidth}/${d.clientWidth})`);
  const small: string[] = [];
  for (const el of Array.from(d.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=tab],[role=checkbox],[role=switch],[role=combobox]"))) {
    const q = el.getBoundingClientRect();
    if (q.width <= 2 || q.height <= 2) continue;
    const after = getComputedStyle(el, "::after");
    const abs = after.content !== "none" && after.position === "absolute";
    const label = el.closest("label")?.getBoundingClientRect();
    const w = Math.max(q.width, abs ? parseFloat(after.width) || 0 : 0, label?.width ?? 0);
    const h = Math.max(q.height, abs ? parseFloat(after.height) || 0 : 0, label?.height ?? 0);
    if (w >= 43.5 && h >= 43.5) continue;
    const aria = el.getAttribute("aria-label") ?? "";
    const name = / de \d{4}/.test(aria)
      ? "dia do calendário"
      : (el as HTMLElement).dataset.testid?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "…") ||
        aria ||
        (el as HTMLElement).innerText?.trim().slice(0, 20) ||
        el.tagName.toLowerCase();
    const item = `${name} ${Math.round(w)}×${Math.round(h)}`;
    if (!small.some((x) => x.startsWith(name + " "))) small.push(item);
  }
  if (small.length) problems.push(`alvo pequeno: ${small.slice(0, 8).join(", ")}${small.length > 8 ? ` (+${small.length - 8})` : ""}`);
  return { title: d.querySelector("h2")?.textContent?.trim() ?? "", problems };
}

/* ------------------------------------------------------------------ apoio */

async function guard(context: BrowserContext) {
  // só leitura: aborta escritas diretas no banco (PostgREST); RPCs de leitura e o login seguem
  await context.route("**/rest/v1/**", (route) => {
    const req = route.request();
    if (["PATCH", "PUT", "DELETE"].includes(req.method()) || (req.method() === "POST" && !req.url().includes("/rpc/")))
      return route.abort();
    return route.continue();
  });
}

function pathOf(url: string) {
  const u = new URL(url);
  return u.pathname.replace(/\/$/, "") || "/";
}

// "networkidle" pode não chegar nunca (conexões abertas do Supabase): carrega o DOM e espera a rede no máximo 5 s
async function gotoFast(page: Page, url: string) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  return resp;
}

async function auditRoute(page: Page, name: string, url: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const resp = await gotoFast(page, url);
  const finalPath = pathOf(page.url());
  const wanted = pathOf(new URL(url, page.url()).toString());
  if (!resp || resp.status() >= 400 || finalPath !== wanted) {
    const why = !resp ? "não carregou" : resp.status() >= 400 ? `HTTP ${resp.status()}` : `redirecionou para ${finalPath}`;
    rows.push({ kind: "rota", name, width, status: `não auditado (${why})`, problems: [] });
    return;
  }
  const m = await page.evaluate(measurePage);
  const problems: string[] = [];
  if (m.hscroll) problems.push(`ROLAGEM LATERAL: página com ${m.sw} px em ${m.W} px`);
  for (const o of m.offscreen) problems.push(`passa da tela: ${o}`);
  for (const c of m.cut) problems.push(`cortado/desalinhado: ${c}`);
  if (m.small.length) problems.push(`alvo pequeno: ${m.small.join(", ")}`);
  rows.push({ kind: "rota", name, width, status: m.hscroll ? "ROLAGEM LATERAL" : problems.length ? "ajustes" : "ok", problems });
  // print de página inteira só quando há problema de layout (rolagem, fora da tela, cortado)
  if (m.hscroll || m.offscreen.length || m.cut.length) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${slug(name)}-${width}.png`), fullPage: true });
  }
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

/** Espera curta: se o gatilho/diálogo não aparecer, a medição vira “sem dados” e o teste segue. */
const WAIT = 12_000;

async function closeDialogs(page: Page) {
  for (let i = 0; i < 3 && (await page.locator("[role=dialog]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

async function auditDialog(page: Page, name: string, width: number, open: () => Promise<void>) {
  await closeDialogs(page);
  try {
    await open();
    await page.locator("[role=dialog]").last().waitFor({ state: "visible", timeout: WAIT });
    await page.waitForTimeout(500);
    const d = await page.evaluate(measureDialog);
    if (!d) throw new Error("diálogo não abriu");
    const layout = d.problems.some((p) => !p.startsWith("alvo"));
    rows.push({ kind: "dialogo", name, width, status: layout ? "NÃO CABE" : d.problems.length ? "ajustes" : "ok", problems: d.problems });
    if (layout) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `dialogo-${slug(name)}-${width}.png`) });
    }
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0];
    const why = /Timeout|waiting for/i.test(msg) ? "sem dados: o gatilho ou o diálogo não apareceu em 12 s" : msg.slice(0, 80);
    rows.push({ kind: "dialogo", name, width, status: `não auditado (${why})`, problems: [] });
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/* ------------------------------------------------------------------ relatório */

// cada teste grava a sua parte em disco: se um teste falhar, o relatório final ainda junta tudo
const PARTS = path.join(OUT, "partes", LABEL);
function flush(part: string) {
  fs.mkdirSync(PARTS, { recursive: true });
  fs.writeFileSync(path.join(PARTS, `${part}.json`), JSON.stringify(rows.splice(0), null, 2));
}

/** A meta de 44 px vale para o celular (< 768 px): no tablet/desktop o alvo pequeno não entra no relatório. */
function touchRuleOnlyOnPhone(r: Row): Row {
  if (r.width < 768 || !r.problems.some((p) => p.startsWith("alvo pequeno"))) return r;
  const problems = r.problems.filter((p) => !p.startsWith("alvo pequeno"));
  const status = r.status === "ajustes" && !problems.length ? "ok" : r.status;
  return { ...r, problems, status };
}

function writeReport() {
  if (!fs.existsSync(PARTS)) return;
  const all: Row[] = fs
    .readdirSync(PARTS)
    .sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(PARTS, f), "utf8")) as Row[])
    .map(touchRuleOnlyOnPhone);
  fs.writeFileSync(path.join(OUT, `relatorio-${LABEL}.json`), JSON.stringify(all, null, 2));
  const routes = all.filter((r) => r.kind === "rota");
  const dialogs = all.filter((r) => r.kind === "dialogo");
  const names = Array.from(new Set(routes.map((r) => r.name)));
  const cell = (r?: Row) =>
    !r ? "—" : r.status === "ok" ? "ok" : r.status === "ROLAGEM LATERAL" ? "**rolagem**" : r.status === "NÃO CABE" ? "**não cabe**" : r.status;
  const lines = [
    `# Auditoria de responsividade — ${LABEL}`,
    "",
    `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
    "",
    `- Rolagem lateral: **${routes.filter((r) => r.status === "ROLAGEM LATERAL").length}** de ${routes.filter((r) => !r.status.startsWith("não")).length} medições de rota.`,
    `- Diálogos que não cabem: **${dialogs.filter((r) => r.status === "NÃO CABE").length}** de ${dialogs.filter((r) => !r.status.startsWith("não")).length}.`,
    `- “ajustes” = sem rolagem lateral, mas com alvo < 44 px ou texto/elemento cortado (ver detalhes).`,
    "",
    `| Rota | ${WIDTHS.join(" | ")} |`,
    `|---|${WIDTHS.map(() => "---").join("|")}|`,
    ...names.map((n) => `| ${n} | ${WIDTHS.map((w) => cell(routes.find((r) => r.name === n && r.width === w))).join(" | ")} |`),
    "",
    "## Diálogos",
    "",
    `| Diálogo | ${DIALOG_SIZES.map((s) => s.width).join(" | ")} |`,
    `|---|${DIALOG_SIZES.map(() => "---").join("|")}|`,
    ...Array.from(new Set(dialogs.map((r) => r.name))).map(
      (n) => `| ${n} | ${DIALOG_SIZES.map((s) => cell(dialogs.find((r) => r.name === n && r.width === s.width))).join(" | ")} |`
    ),
    "",
    "## Detalhes (rota · largura · problema)",
    "",
    "| Rota | Largura | Problema |",
    "|---|---|---|",
    ...all.flatMap((r) => r.problems.map((p) => `| ${r.kind === "dialogo" ? "diálogo: " : ""}${r.name} | ${r.width} | ${p.replace(/\|/g, "\\|")} |`)),
    "",
  ];
  fs.writeFileSync(path.join(OUT, `relatorio-${LABEL}.md`), lines.join("\n"));
}

/* ------------------------------------------------------------------ testes */
// Um test() por rota × largura e por diálogo × tamanho: o reporter "line" mostra o progresso e uma falha não segura as outras.
// RESPONSIVO_ROTAS=agenda,ficha,/espacos roda só o que contém um desses trechos (no nome ou na URL).

const STATE = path.join(OUT, `demo-${LABEL}.json`);
const META = path.join(OUT, `meta-${LABEL}.json`);
type Meta = { ficha: string | null; bookingDay: string | null };

const ONLY = (process.env.RESPONSIVO_ROTAS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const wanted = (...keys: string[]) => !ONLY.length || ONLY.some((o) => keys.some((k) => k.toLowerCase().includes(o)));
const readMeta = (): Meta => (fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, "utf8")) : { ficha: null, bookingDay: null });

test.afterAll(writeReport);

test("preparar · login da demo e dados", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  if (!ONLY.length && !ONLY_WIDTHS.length) {
    fs.rmSync(PARTS, { recursive: true, force: true });
    fs.rmSync(SHOTS, { recursive: true, force: true });
  }
  const context = await browser.newContext();
  await guard(context);
  const page = await context.newPage();
  await gotoFast(page, "/demo");
  if (!pathOf(page.url()).startsWith("/admin")) throw new Error(`login da demo falhou (${page.url()})`);
  await context.storageState({ path: STATE });

  await gotoFast(page, "/admin/clientes");
  const ficha = await page.locator("a[href^='/admin/clientes/']").first().getAttribute("href", { timeout: WAIT }).catch(() => null);
  // um dia com agendamento para Editar / Concluir / Remarcar (±30 dias, de 6 em 6)
  let bookingDay: string | null = null;
  const offsets = [0, ...Array.from({ length: 30 }, (_, i) => [i + 1, -(i + 1)]).flat()];
  for (let i = 0; i < offsets.length && !bookingDay; i += 6) {
    const days = offsets.slice(i, i + 6).map(addDays);
    const htmls = await Promise.all(
      days.map((d) => page.request.get(`/admin/agenda?visao=dia&data=${d}&status=all`).then((r) => r.text()).catch(() => ""))
    );
    const idx = htmls.findIndex((h) => /btn-concluir-[0-9a-f-]{36}/.test(h) && /btn-remarcar-[0-9a-f-]{36}/.test(h));
    if (idx >= 0) bookingDay = days[idx];
  }
  fs.writeFileSync(META, JSON.stringify({ ficha, bookingDay } satisfies Meta));
  console.log(`  ficha: ${ficha ?? "nenhuma"} · dia com agendamento: ${bookingDay ?? "nenhum em ±30 dias"}`);
  await context.close();
});

/* ---------- rotas públicas (sem login) ---------- */

const PUBLIC_ROUTES: [string, string][] = [
  ["/ (landing)", "/"], // nome filtrável: RESPONSIVO_ROTAS=landing
  ["/espacos", "/espacos"],
  ["/para/[nicho]", "/para/salao"],
  ["/explorar/[nicho]", "/explorar/salao"],
  ["/v/[slug]", "/v/luminabelle"],
  ["/cadastro", "/cadastro"],
  ["/admin/login", "/admin/login"],
  ["/esqueci-senha", "/esqueci-senha"],
  ["/termos", "/termos"],
  ["/privacidade", "/privacidade"],
];
if (process.env.RESPONSIVO_AVALIAR_URL) PUBLIC_ROUTES.push(["/v/[slug]/avaliar/[id]", process.env.RESPONSIVO_AVALIAR_URL]);

for (const [i, [name, url]] of Array.from(PUBLIC_ROUTES.entries())) {
  for (const w of WIDTHS.filter(runWidth)) {
    if (!wanted(name, url)) continue;
    test(`rota · ${name} · ${w} px`, async ({ browser }) => {
      const context = await browser.newContext();
      await guard(context);
      await auditRoute(await context.newPage(), name, url, w);
      await context.close();
      flush(`1-${String(i).padStart(2, "0")}-${String(w).padStart(4, "0")}`);
    });
  }
}
if (!process.env.RESPONSIVO_AVALIAR_URL && wanted("avaliar")) {
  test("rota · /v/[slug]/avaliar/[id]", async () => {
    rows.push({ kind: "rota", name: "/v/[slug]/avaliar/[id]", width: 360, status: "não auditado (defina RESPONSIVO_AVALIAR_URL)", problems: [] });
    flush("1-avaliar");
  });
}

/* ---------- assistente de agendamento da vitrine (até “Seus dados”, nunca confirma) ---------- */

for (const size of DIALOG_SIZES.filter((s) => runWidth(s.width))) {
  if (!wanted("vitrine", "assistente", "wizard", "turnstile")) continue;
  test(`vitrine · assistente passo a passo · ${size.width} px`, async ({ browser }) => {
    const context = await browser.newContext();
    await guard(context);
    const page = await context.newPage();
    await page.setViewportSize(size);
    await gotoFast(page, "/v/luminabelle");
    const first = page.locator("[data-testid^=btn-agendar-servico-]").first();
    await auditDialog(page, "Vitrine 1 · Profissional", size.width, () => first.click());
    const pro = page.locator("[role=dialog] [data-testid^=wizard-profissional-]").first();
    await auditDialog(page, "Vitrine 2 · Data e horário", size.width, async () => {
      await first.click();
      if (await pro.isVisible({ timeout: 3000 }).catch(() => false)) await pro.click();
    });
    // primeiro dia com horário livre
    let gotSlot = false;
    const days = page.locator("[role=dialog] [data-testid=wizard-calendario] button[data-day]:not([disabled])");
    const dayCount = await days.count();
    for (let i = 0; i < Math.min(dayCount, 20) && !gotSlot; i++) {
      await days.nth(i).click();
      await page.waitForTimeout(1200);
      const slot = page.locator("[role=dialog] button").filter({ hasText: /^\d{2}:\d{2}$/ }).first();
      if (await slot.count()) {
        await slot.click();
        gotSlot = true;
      }
    }
    const name3 = "Vitrine 3 · Seus dados (+ Turnstile)";
    if (!gotSlot) {
      rows.push({ kind: "dialogo", name: name3, width: size.width, status: `não auditado (sem dados: nenhum horário livre em ${dayCount} dias)`, problems: [] });
    } else {
      await page.locator("[role=dialog] [data-testid=btn-continuar-horario]").click();
      const form = await page
        .locator("[role=dialog] [data-testid=input-nome-cliente]")
        .waitFor({ timeout: WAIT })
        .then(() => true)
        .catch(() => false);
      if (!form) {
        rows.push({ kind: "dialogo", name: name3, width: size.width, status: "não auditado (sem dados: etapa “Seus dados” não abriu em 12 s)", problems: [] });
      } else {
        // Turnstile real (chave de teste): espera o widget montar e mede se cabe inteiro
        await page
          .waitForFunction(
            () => {
              const el = document.querySelector("[role=dialog] [data-testid=turnstile-widget]");
              return !!el && Array.from(el.querySelectorAll("*")).some((c) => c.getBoundingClientRect().width >= 140);
            },
            undefined,
            { timeout: 15_000 }
          )
          .catch(() => null);
        const ts = await page.locator("[role=dialog] [data-testid=turnstile-widget]").evaluate((el) => {
          const dlg = el.closest("[role=dialog]") as HTMLElement;
          const dr = dlg.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(dlg).paddingRight) || 0;
          const kids = Array.from(el.querySelectorAll("*")).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
          const right = Math.max(el.getBoundingClientRect().right, ...kids.map((r) => r.right));
          const width = Math.max(0, ...kids.map((r) => r.width));
          return { mounted: kids.length > 0, width: Math.round(width), right: Math.round(right), limit: Math.round(dr.right - pad), dialogRight: Math.round(dr.right) };
        });
        await page.waitForTimeout(300);
        const d = await page.evaluate(measureDialog);
        const problems = d?.problems ?? ["diálogo não encontrado"];
        if (!ts.mounted) problems.unshift("Turnstile não montou (sem rede/chave?) — não foi possível medir");
        else if (ts.right > ts.dialogRight + 1) problems.unshift(`Turnstile não cabe: ${ts.width} px, termina em x ${ts.right} e o diálogo em ${ts.dialogRight}`);
        else if (ts.right > ts.limit + 1) problems.push(`Turnstile invade o respiro lateral (${ts.width} px, termina em x ${ts.right}, limite ${ts.limit})`);
        const layout = problems.some((p) => !p.startsWith("alvo") && !p.startsWith("Turnstile invade"));
        rows.push({
          kind: "dialogo",
          name: name3,
          width: size.width,
          status: layout ? "NÃO CABE" : problems.length ? "ajustes" : "ok",
          problems: ts.mounted ? [`Turnstile medido: ${ts.width} px (fim em x ${ts.right}; diálogo termina em ${ts.dialogRight})`, ...problems] : problems,
        });
        if (layout) await page.screenshot({ path: path.join(SHOTS, `dialogo-vitrine-seus-dados-${size.width}.png`) });
      }
    }
    await context.close();
    flush(`2-vitrine-${size.width}`);
  });
}

/* ---------- painel pela demo ---------- */

const prevMonth = (() => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return iso(d).slice(0, 7);
})();
// último dia do mês anterior (Caixa: atalho "Mês passado" = ?de=<mês>-01&ate=<último dia>)
const prevMonthEnd = (() => {
  const d = new Date();
  d.setUTCDate(0);
  return iso(d);
})();

const PANEL_ROUTES: [string, (m: Meta) => string | null][] = [
  ["Início", () => "/admin"],
  ["Agenda · Dia (outro dia)", () => `/admin/agenda?visao=dia&data=${addDays(7)}`],
  ["Agenda · Dia com atendimentos", (m) => m.bookingDay && `/admin/agenda?visao=dia&data=${m.bookingDay}&status=all`],
  ["Agenda · Semana", () => `/admin/agenda?visao=semana&data=${addDays(7)}`],
  ["Agenda · Mês", () => `/admin/agenda?visao=mes&data=${addDays(35)}`],
  ["Agenda · Calendário do celular", () => `/admin/agenda?visao=dia&calendario=${addDays(0).slice(0, 7)}`],
  ["Clientes", () => "/admin/clientes"],
  ["Clientes · ficha", (m) => m.ficha],
  ["Lembretes · Amanhã", () => "/admin/lembretes"],
  ["Lembretes · Hoje", () => "/admin/lembretes?dia=hoje"],
  ["Lembretes · Retornos", () => "/admin/lembretes?dia=retornos"],
  ["Bloqueios", () => "/admin/bloqueios"],
  ["Serviços (+ Combos, Pacotes)", () => "/admin/servicos"],
  ["Equipe", () => "/admin/profissionais"],
  ["Financeiro · Caixa (mês anterior)", () => `/admin/financeiro?de=${prevMonth}-01&ate=${prevMonthEnd}`],
  ["Financeiro · Faturamento", () => "/admin/financeiro/faturamento"],
  ["Financeiro · Contador", () => "/admin/financeiro/contador"],
  ["Assinatura", () => "/admin/assinatura"],
  ["Configurações", () => "/admin/configuracoes"],
  ["Meus ganhos", () => `/admin/ganhos?mes=${prevMonth}`],
  ["/genix", () => "/genix"],
];

async function panelPage(browser: Browser) {
  if (!fs.existsSync(STATE)) throw new Error("sem sessão da demo (o teste “preparar” falhou)");
  const context = await browser.newContext({ storageState: STATE });
  await guard(context);
  return { context, page: await context.newPage() };
}

for (const [i, [name, urlOf]] of Array.from(PANEL_ROUTES.entries())) {
  for (const w of WIDTHS.filter(runWidth)) {
    if (!wanted(name, urlOf({ ficha: "/admin/clientes/ficha", bookingDay: "agenda" }) ?? "")) continue;
    test(`painel · ${name} · ${w} px`, async ({ browser }) => {
      const url = urlOf(readMeta());
      if (!url) {
        rows.push({ kind: "rota", name, width: w, status: "não auditado (sem dados na demo)", problems: [] });
      } else {
        const { context, page } = await panelPage(browser);
        await auditRoute(page, name, url, w);
        await context.close();
      }
      flush(`3-${String(i).padStart(2, "0")}-${String(w).padStart(4, "0")}`);
    });
  }
}

/* ---------- diálogos do painel ---------- */

type DialogCase = { name: string; url: (m: Meta) => string | null; open: (page: Page) => Promise<void>; onlyMobile?: boolean };
const DIALOGS: DialogCase[] = [
  { name: "Novo agendamento", url: () => `/admin/agenda?visao=dia&data=${addDays(7)}`, open: (p) => p.getByTestId("btn-novo-agendamento").first().click() },
  {
    name: "Novo agendamento (recorrência)",
    url: () => `/admin/agenda?visao=dia&data=${addDays(7)}`,
    open: async (p) => {
      await p.getByTestId("btn-novo-agendamento").first().click();
      await p.locator("[role=dialog] [data-testid=check-repetir]").click();
    },
  },
  { name: "Editar agendamento", url: (m) => m.bookingDay && `/admin/agenda?visao=dia&data=${m.bookingDay}&status=all`, open: (p) => p.locator("[data-testid^=btn-editar-]").first().click() },
  { name: "Concluir", url: (m) => m.bookingDay && `/admin/agenda?visao=dia&data=${m.bookingDay}&status=all`, open: (p) => p.locator("[data-testid^=btn-concluir-]").first().click() },
  { name: "Remarcar", url: (m) => m.bookingDay && `/admin/agenda?visao=dia&data=${m.bookingDay}&status=all`, open: (p) => p.locator("[data-testid^=btn-remarcar-]").first().click() },
  { name: "Novo bloqueio", url: () => "/admin/bloqueios", open: (p) => p.getByTestId("btn-novo-bloqueio").click() },
  { name: "Serviço", url: () => "/admin/servicos", open: (p) => p.getByTestId("btn-novo-servico").click() },
  { name: "Combo", url: () => "/admin/servicos", open: (p) => p.getByTestId("btn-novo-combo").click() },
  { name: "Pacote", url: () => "/admin/servicos", open: (p) => p.getByTestId("btn-novo-pacote").click() },
  { name: "Cliente (editar; o “novo” é o mesmo diálogo e a demo não tem o botão)", url: (m) => m.ficha, open: (p) => p.getByTestId("btn-editar-cliente").click() },
  { name: "Ficha técnica", url: (m) => m.ficha, open: (p) => p.getByTestId("btn-editar-ficha").click() },
  { name: "Profissional", url: () => "/admin/profissionais", open: (p) => p.getByTestId("btn-novo-profissional").click() },
  { name: "Lançamento do caixa", url: () => "/admin/financeiro", open: (p) => p.getByTestId("btn-novo-lancamento").click() },
  { name: "Menu do celular", url: () => "/admin", open: (p) => p.getByTestId("btn-menu-mobile").click(), onlyMobile: true },
];

for (const [i, dc] of Array.from(DIALOGS.entries())) {
  for (const size of DIALOG_SIZES.filter((s) => runWidth(s.width))) {
    if (dc.onlyMobile && size.width >= 768) continue;
    if (!wanted(dc.name, "dialogo", "diálogo")) continue;
    test(`diálogo · ${dc.name} · ${size.width} px`, async ({ browser }) => {
      const url = dc.url(readMeta());
      if (!url) {
        rows.push({ kind: "dialogo", name: dc.name, width: size.width, status: "não auditado (sem dados na demo)", problems: [] });
      } else {
        const { context, page } = await panelPage(browser);
        await page.setViewportSize(size);
        await gotoFast(page, url);
        await auditDialog(page, dc.name, size.width, () => dc.open(page));
        await context.close();
      }
      flush(`4-${String(i).padStart(2, "0")}-${String(size.width).padStart(4, "0")}`);
    });
  }
}
