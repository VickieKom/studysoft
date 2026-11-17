// Removes the old values of edited and deleted payments once they are older
// than the keeping period (#101). Meant to run nightly, with the blob
// cleanup (#73). Prints only how many went.
import { removeOldPaymentRevisions } from "../../crm/payments";
import { closeDb, db } from "../client";

const removed = await removeOldPaymentRevisions(db());
await closeDb();
console.log(`payment revisions removed: ${removed}`);
