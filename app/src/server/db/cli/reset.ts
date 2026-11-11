import { env } from "../../env";
import { recreateDatabase } from "../migrate";

await recreateDatabase(env().DATABASE_URL);
console.log("database recreated and migrated");
