// @ts-ignore Bun test types live in the backend workspace, outside the app tsconfig.
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { SyncHonoEnv } from "../hono-env";
import { requirePremadeDeckAccess } from "../middleware/premade-access";

// config.ts reads these at import time. Nothing here talks to Postgres or Clerk:
// requests without a session token are rejected before any network call.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.CLERK_SECRET_KEY ??= "sk_test_unit";
process.env.CLERK_PUBLISHABLE_KEY ??= `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;

let server: { fetch: (request: Request) => Response | Promise<Response> };

beforeAll(async () => {
  server = (await import("../index")).default;
});

describe("premade deck routes", () => {
  for (const path of ["/api/v1/premade-decks", "/api/v1/premade-decks/pull"]) {
    test(`GET ${path} without a session is 401`, async () => {
      const response = await server.fetch(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false });
    });
  }

  test("GET with an invalid bearer token is 401", async () => {
    const response = await server.fetch(
      new Request("http://localhost/api/v1/premade-decks", {
        headers: { Authorization: "Bearer not-a-jwt" },
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("requirePremadeDeckAccess", () => {
  const appFor = (allowed: ReadonlySet<string> | null, userId: string) => {
    const app = new Hono<SyncHonoEnv>();
    app.use("*", async (c, next) => {
      c.set("clerkUserId", userId);
      await next();
    });
    app.use("*", requirePremadeDeckAccess(allowed));
    app.get("/", (c) => c.text("ok"));
    app.onError((error) => new Response(error.message, { status: "status" in error ? (error.status as number) : 500 }));
    return app;
  };

  test("allows any signed-in user when no allowlist is set", async () => {
    expect((await appFor(null, "user_a").request("/")).status).toBe(200);
  });

  test("only allows listed users when an allowlist is set", async () => {
    const allowed = new Set(["user_a"]);
    expect((await appFor(allowed, "user_a").request("/")).status).toBe(200);
    expect((await appFor(allowed, "user_b").request("/")).status).toBe(403);
  });
});
