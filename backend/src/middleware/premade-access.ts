import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { SyncHonoEnv } from "../hono-env";

/**
 * Runs after requireClerkSession. When an allowlist is configured, only those
 * Clerk users may read premade decks; everyone else gets 403.
 */
export const requirePremadeDeckAccess =
  (allowedUserIds: ReadonlySet<string> | null): MiddlewareHandler<SyncHonoEnv> =>
  async (c, next) => {
    if (allowedUserIds && !allowedUserIds.has(c.get("clerkUserId"))) {
      throw new HTTPException(403, { message: "Premade decks are not available for this account." });
    }
    await next();
  };
