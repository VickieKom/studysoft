-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #82: marking a lesson held or missed, with the charge, the unit and a note.
ALTER TABLE "lesson" ADD COLUMN "charged" boolean;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "note" text;
