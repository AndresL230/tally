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
  const jwks = fs.readFileSync(
    path.join(root, "test/keys/jwks-public.json"),
    "utf8",
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Real signature verification in tests: the middleware verifies
            // against this JWKS; tests sign with the matching private key.
            ACCESS_JWKS: jwks,
            ACCESS_AUD: "test-aud",
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            // Explicit value so a developer's gitignored .dev.vars can never
            // leak into test outcomes. The bypass only fires for
            // localhost-host requests; regular tests use https://tally.test,
            // so both guard branches are covered deliberately in auth tests.
            DEV_ALLOW_USER: "devuser@example.com",
            // Extraction tests mock the gateway with fetchMock; these two
            // route the URL. ANTHROPIC_API_KEY is deliberately NOT bound —
            // tests set it via env mutation so the key-absent 503 path is
            // the default, as on a fresh deployment.
            AI_GATEWAY_ACCOUNT_ID: "test-account",
            AI_GATEWAY_ID: "test-gw",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      // jose's negative verification paths (unknown kid, bad signature)
      // reject inside workerd in a way vitest double-reports even though
      // src/worker/auth.ts awaits and catches them (requests still get their
      // 401 — asserted in auth tests). Swallow exactly that family; anything
      // else stays fatal.
      onUnhandledError(err: unknown) {
        const code = (err as { code?: string })?.code ?? "";
        if (typeof code === "string" && (code.startsWith("ERR_JWKS_") || code.startsWith("ERR_JWS_"))) {
          return false;
        }
      },
      // Test files share one D1 instance; run them one at a time so the
      // between-test table resets can't race across files.
      fileParallelism: false,
    },
  };
});
