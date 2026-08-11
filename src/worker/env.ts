export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Test-only override: a JWKS JSON string used instead of the remote team JWKS. */
  ACCESS_JWKS?: string;
  /**
   * Local-dev-only identity bypass, set via .dev.vars, honored only for
   * localhost requests. NEVER set this on a deployed Worker.
   */
  DEV_ALLOW_USER?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** Worker secret. The client never sees or calls the model directly. */
  ANTHROPIC_API_KEY?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { email: string };
};
