// Integration tests run against a throwaway PostgreSQL database that is
// recreated, migrated and seeded once per run.
import { closeDb, db } from "../db/client";
import { recreateDatabase } from "../db/migrate";
import { seed } from "../db/seed";
import { env } from "../env";

export default async function setup() {
  await recreateDatabase(env().DATABASE_URL);
  await seed(db());
  await closeDb();
}
