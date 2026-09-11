// App-wide switches in the `settings` key/value table.

export type SignupMode = "invite" | "open";

/** 'invite' unless the owner has explicitly opened sign-up. */
export async function getSignupMode(db: D1Database): Promise<SignupMode> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'signup_mode'")
    .first<{ value: string }>();
  return row?.value === "open" ? "open" : "invite";
}

export async function setSignupMode(db: D1Database, mode: SignupMode): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('signup_mode', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?1`,
    )
    .bind(mode)
    .run();
}
