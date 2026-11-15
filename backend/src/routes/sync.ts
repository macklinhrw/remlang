import { Hono } from "hono";
import { z } from "zod";
import type { SyncHonoEnv } from "../hono-env";
import { requireClerkSession } from "../middleware/clerk-auth";
import {
  pullSyncData,
  pushSyncData,
  registerDevice,
} from "../sync/service";
import {
  registerDeviceSchema,
  syncPullSchema,
  syncPushSchema,
} from "../sync/schema";

const parseBody = async <T>(
  request: Request,
  schema: z.ZodType<T>,
) => {
  const body = await request.json();
  return schema.parse(body);
};

export const syncRoutes = new Hono<SyncHonoEnv>();

syncRoutes.use("*", requireClerkSession);

syncRoutes.post("/register", async (c) => {
  const payload = await parseBody(c.req.raw, registerDeviceSchema);
  const result = await registerDevice(c.get("clerkUserId"), payload);
  return c.json(result);
});

syncRoutes.post("/push", async (c) => {
  const payload = await parseBody(c.req.raw, syncPushSchema);
  const result = await pushSyncData(c.get("clerkUserId"), payload);
  return c.json(result);
});

syncRoutes.post("/pull", async (c) => {
  const payload = await parseBody(c.req.raw, syncPullSchema);
  const result = await pullSyncData(c.get("clerkUserId"), payload);
  return c.json(result);
});
