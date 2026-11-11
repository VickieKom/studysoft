import { env } from "../../env";
import { runMigrations } from "../migrate";

await runMigrations(env().DATABASE_URL);
console.log("migrations applied");
