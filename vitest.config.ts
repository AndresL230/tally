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
