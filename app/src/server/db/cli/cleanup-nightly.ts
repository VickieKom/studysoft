// The nightly cleanups in one command, for the scheduler on the server to
// run before the backup (#165): the old values of payments (#101), then the
// files nothing refers to (#73). One entry point, so a cleanup added later
// needs no change on the server. Prints only counts; a failure stops it with
// a non-zero exit, so the scheduler reports it.
import { removeUnreferencedBlobs } from "../../blob/store";
import { removeOldPaymentRevisions } from "../../crm/payments";
import { closeDb, db } from "../client";

try {
  const revisions = await removeOldPaymentRevisions(db());
  console.log(`payment revisions removed: ${revisions}`);
  const { removed, bytes } = await removeUnreferencedBlobs(db());
  console.log(`blobs removed: ${removed}, bytes: ${bytes}`);
} finally {
  await closeDb();
}
