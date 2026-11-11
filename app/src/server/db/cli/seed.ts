import { env } from "../../env";
import { closeDb, db } from "../client";
import { seed } from "../seed";

env();
await seed(db());
await closeDb();
console.log("seed data loaded");
