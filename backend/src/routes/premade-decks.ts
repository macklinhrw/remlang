import { Hono } from "hono";
import { premadeListQuerySchema, premadePullQuerySchema } from "../premade/schema";
import { listPremadeDecks, pullPremadeContent } from "../premade/service";

export const premadeDeckRoutes = new Hono();

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
