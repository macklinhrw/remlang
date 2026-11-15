import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { config } from "./config";
import { db } from "./db/client";
import { premadeDeckRoutes } from "./routes/premade-decks";
import { syncRoutes } from "./routes/sync";

const app = new Hono();

app.get("/health", async (c) => {
  await db.execute(sql`select 1`);
  return c.json({
    ok: true,
    service: "remlang-sync-backend",
    auth: "clerk",
    serverTime: new Date().toISOString(),
  });
});

app.route("/api/v1/sync", syncRoutes);
app.route("/api/v1/premade-decks", premadeDeckRoutes);

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        details: error.flatten(),
      },
      400,
    );
  }

  if (error instanceof HTTPException) {
    return c.json(
      {
        ok: false,
        error: error.message,
      },
      error.status,
    );
  }

  console.error(error);

  return c.json(
    {
      ok: false,
      error: "internal_error",
    },
    500,
  );
});

export default {
  port: config.port,
  fetch: app.fetch,
};
