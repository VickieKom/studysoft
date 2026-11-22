-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #291: a game linked to a lesson of the teacher's textbook. Nullable columns.
ALTER TABLE "library_material" ADD COLUMN "textbook_id" uuid;--> statement-breakpoint
ALTER TABLE "library_material" ADD COLUMN "textbook_lesson_id" uuid;--> statement-breakpoint
-- The column is new and empty: there is nothing to validate, so NOT VALID skips the scan without leaving rows unchecked.
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "library_material" ADD CONSTRAINT "library_material_textbook_id_textbook_id_fk" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbook"("id") ON DELETE set null ON UPDATE no action NOT VALID;
