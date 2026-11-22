-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #269: a report's recordings «было» and «стало». Nullable columns.
ALTER TABLE "report" ADD COLUMN "recording_before" uuid;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "recording_after" uuid;--> statement-breakpoint
-- NOT VALID: the columns are new and empty, so there is nothing to scan; new rows are checked all the same.
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "report" ADD CONSTRAINT "report_recording_before_blob_id_fk" FOREIGN KEY ("recording_before") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "report" ADD CONSTRAINT "report_recording_after_blob_id_fk" FOREIGN KEY ("recording_after") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action NOT VALID;
