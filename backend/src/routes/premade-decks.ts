import { Hono } from "hono";
import { config } from "../config";
import type { SyncHonoEnv } from "../hono-env";
import { requireClerkSession } from "../middleware/clerk-auth";
import { requirePremadeDeckAccess } from "../middleware/premade-access";
import { premadeListQuerySchema, premadePullQuerySchema } from "../premade/schema";
import { listPremadeDecks, pullPremadeContent } from "../premade/service";

export const premadeDeckRoutes = new Hono<SyncHonoEnv>();

// Premade decks can contain textbook-derived vocabulary: never serve them anonymously.
premadeDeckRoutes.use("*", requireClerkSession, requirePremadeDeckAccess(config.premadeDeckUserIds));

premadeDeckRoutes.get("/", async (c) => {
  const query = premadeListQuerySchema.parse(c.req.query());
  const decks = await listPremadeDecks(query);
  return c.json({
    ok: true,
    premadeDecks: decks,
  });
});

premadeDeckRoutes.get("/pull", async (c) => {
  const query = premadePullQuerySchema.parse(c.req.query());
  const result = await pullPremadeContent(query);
  return c.json({
    ok: true,
    ...result,
  });
});
