const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const normalizeDatabaseUrl = (value: string) => {
  const url = new URL(value);
  const sslmode = url.searchParams.get("sslmode");
  const sslrootcert = url.searchParams.get("sslrootcert");

  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");

  return {
    databaseUrl: url.toString(),
    useSsl:
      sslmode === "require" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full" ||
      Boolean(sslrootcert),
  };
};

const parseIdList = (value: string | undefined) => {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
};

const normalizedDatabaseConfig = normalizeDatabaseUrl(requireEnv("DATABASE_URL"));

export const config = {
  databaseUrl: normalizedDatabaseConfig.databaseUrl,
  databaseUsesSsl: normalizedDatabaseConfig.useSsl,
  databaseMaxConnections: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 5),
  port: Number(process.env.PORT ?? 8787),
  clerkSecretKey: requireEnv("CLERK_SECRET_KEY"),
  clerkPublishableKey: requireEnv("CLERK_PUBLISHABLE_KEY"),
  clerkJwtKey: process.env.CLERK_JWT_KEY ?? null,
  /**
   * Clerk user ids allowed to read premade decks (comma-separated). Premade
   * decks can hold textbook-derived lists, so restrict them to the accounts
   * that uploaded them. Unset: any signed-in user.
   */
  premadeDeckUserIds: parseIdList(process.env.PREMADE_DECK_USER_IDS),
};
