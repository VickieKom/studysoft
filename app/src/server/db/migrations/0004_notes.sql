-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #42: notes on the student card.
CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_student_id_created_at_idx" ON "note" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "note_teacher_id_idx" ON "note" USING btree ("teacher_id");
