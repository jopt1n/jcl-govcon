import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create postgres client — single connection for serverless, pool for server
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
export const postgresClient = client;

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
