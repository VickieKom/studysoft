// Removes the stored files nothing refers to (#73). Meant to run with the
// nightly backup, before it, so removed pictures do not land in it. Prints
// how many files went and their size: no names, no content.
import { removeUnreferencedBlobs } from "../../blob/store";
import { closeDb, db } from "../client";

const { removed, bytes } = await removeUnreferencedBlobs(db());
await closeDb();
console.log(`blobs removed: ${removed}, bytes: ${bytes}`);
