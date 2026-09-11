export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  /** The one owner: admin routes, always allowed to sign in. Plain var. */
  ADMIN_EMAIL?: string;
  /** "Tally <sign-in@tally.andresl.dev>"; plain var. */
  MAIL_FROM?: string;
  /** Worker secret. Absent in local dev => codes print to the console. */
  RESEND_API_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** Worker secret. The client never sees or calls the model directly. */
  ANTHROPIC_API_KEY?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { email: string };
};
