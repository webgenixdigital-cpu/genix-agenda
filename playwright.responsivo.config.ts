import { defineConfig } from "@playwright/test";

/**
 * Auditoria de responsividade (npm run test:responsivo).
 * Sem BASE_URL, sobe o build de produção local (next start) na porta 3100;
 * com BASE_URL=http://localhost:3000, reaproveita um servidor já rodando.
 */
const PORT = 3100;
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/responsivo",
  outputDir: "responsivo-report/test-results",
  workers: 1,
  fullyParallel: false,
  // um teste por rota/diálogo: limite curto por teste e por espera; o reporter "line" mostra o progresso ao vivo
  timeout: 90_000,
  reporter: [["line"]],
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    browserName: "chromium",
    actionTimeout: 12_000,
    navigationTimeout: 30_000,
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: `npx next start -p ${PORT}`, url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
