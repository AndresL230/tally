import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../src/worker/env";

declare global {
  namespace Cloudflare {
    // Merged into the `env` exposed by cloudflare:test.
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      ACCESS_JWKS: string;
    }
  }
}

export {};
