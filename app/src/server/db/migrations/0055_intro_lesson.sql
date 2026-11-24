-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #338: a request's hidden card for the intro lesson, and «Итог вводного». Nullable columns.
ALTER TABLE "client_request" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "client_request" ADD COLUMN "intro_level" text;--> statement-breakpoint
ALTER TABLE "client_request" ADD COLUMN "intro_notes" text;--> statement-breakpoint
-- NOT VALID: the column is new and empty, so there is nothing to scan; new rows are checked all the same.
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "client_request" ADD CONSTRAINT "client_request_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- The table is a few requests per teacher, so the index builds at once.
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "client_request_student_id_key" ON "client_request" USING btree ("student_id");
