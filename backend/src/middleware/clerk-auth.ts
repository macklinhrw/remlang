import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { clerkClient } from "../clerk";
import { config } from "../config";
import type { SyncHonoEnv } from "../hono-env";

export const requireClerkSession: MiddlewareHandler<SyncHonoEnv> = async (
  c,
  next,
) => {
  const authState = await clerkClient.authenticateRequest(c.req.raw, {
    jwtKey: config.clerkJwtKey ?? undefined,
  });

  if (!authState.isAuthenticated) {
    throw new HTTPException(401, {
      message: authState.message ?? "Unauthorized",
    });
  }

  const auth = authState.toAuth();
  if (!auth.userId) {
    throw new HTTPException(401, {
      message: "Missing Clerk user identity.",
    });
  }

  c.set("clerkUserId", auth.userId);
  await next();
};
