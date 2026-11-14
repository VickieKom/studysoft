-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #80: the teacher's time zone, weekly slots and lessons.
CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"slot_id" uuid,
	"slot_date" date,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" bigint NOT NULL,
	"kind" text DEFAULT 'regular' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"weekday" bigint NOT NULL,
	"start_time" text NOT NULL,
	"time_zone" text NOT NULL,
	"duration_minutes" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teacher" ADD COLUMN "time_zone" text DEFAULT 'Asia/Bangkok' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_slot_id_schedule_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_slot_date_key" ON "lesson" USING btree ("slot_id","slot_date");--> statement-breakpoint
CREATE INDEX "lesson_teacher_id_starts_at_idx" ON "lesson" USING btree ("teacher_id","starts_at");--> statement-breakpoint
CREATE INDEX "lesson_student_id_idx" ON "lesson" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "schedule_slot_teacher_id_idx" ON "schedule_slot" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "schedule_slot_student_id_idx" ON "schedule_slot" USING btree ("student_id");
