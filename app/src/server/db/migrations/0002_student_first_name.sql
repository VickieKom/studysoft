-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #18: second step after 0001. No environment runs code that reads
-- display_name: the column only existed in the skeleton, with synthetic data.
-- The table holds a handful of rows; the scan is instant.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "student" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint
-- Nothing deployed reads display_name (see above).
-- squawk-ignore ban-drop-column
ALTER TABLE "student" DROP COLUMN "display_name";
