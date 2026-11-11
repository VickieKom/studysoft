import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Applies pending migrations. Migrations only go forward. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

// Throwaway databases only: tests and acceptance runs recreate theirs from
// scratch. The suffix check keeps this away from a database that matters.
const THROWAWAY_SUFFIXES = ["_test", "_e2e"];

/** Drops and recreates the database named in the URL, then migrates it. */
export async function recreateDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !THROWAWAY_SUFFIXES.some((s) => name.endsWith(s))) {
    throw new Error(`Refusing to recreate "${name}": only *_test and *_e2e databases`);
  }
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(databaseUrl);
}
