import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

function connect(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

export type Database = ReturnType<typeof connect>["db"];

// One pool per process. Development reloads modules, so the pool is kept on
// globalThis instead of being recreated on every reload.
const holder = globalThis as unknown as { studysoftDb?: ReturnType<typeof connect> };

export function db(): Database {
  holder.studysoftDb ??= connect(env().DATABASE_URL);
  return holder.studysoftDb.db;
}

export async function closeDb(): Promise<void> {
  await holder.studysoftDb?.client.end();
  holder.studysoftDb = undefined;
}

export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await db().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
