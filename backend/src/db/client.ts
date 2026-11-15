import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "../config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl, {
  max: Math.max(1, config.databaseMaxConnections),
  idle_timeout: 20,
  connect_timeout: 15,
  prepare: false,
  ssl: config.databaseUsesSsl ? "require" : false,
});

export const db = drizzle(client, { schema });
