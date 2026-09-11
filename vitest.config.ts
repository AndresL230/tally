import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const root = import.meta.dirname;
  const migrations = await readD1Migrations(path.join(root, "migrations"));
  // The wrangler config declares an assets directory; make sure it exists so
  // the config loads even before the first client build.
  fs.mkdirSync(path.join(root, "dist/client"), { recursive: true });
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Extraction tests mock the gateway with fetchMock; these two
            // route the URL. ANTHROPIC_API_KEY is deliberately NOT bound —
            // tests set it via env mutation so the key-absent 503 path is
            // the default, as on a fresh deployment.
            AI_GATEWAY_ACCOUNT_ID: "test-account",
            AI_GATEWAY_ID: "test-gw",
            // Own auth. RESEND_API_KEY is deliberately NOT bound: the mailer
            // then logs instead of fetching, so no suite touches the network.
            // Auth tests set it via env mutation and patch fetch (helpers/mail).
            ADMIN_EMAIL: "admin@example.com",
            MAIL_FROM: "Tally <sign-in@tally.test>",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      // Test files share one D1 instance; run them one at a time so the
      // between-test table resets can't race across files.
      fileParallelism: false,
    },
  };
});
