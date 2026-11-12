-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #34: answers to homework and the one submission per homework.
CREATE TABLE "homework_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"homework_id" uuid NOT NULL,
	"task_index" bigint NOT NULL,
	"answer" jsonb,
	"correct" boolean,
	"topic" text,
	"skill" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_answer_homework_id_task_index_key" UNIQUE("homework_id","task_index")
);
--> statement-breakpoint
CREATE TABLE "homework_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"homework_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"correct_count" bigint NOT NULL,
	"wrong_count" bigint NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_submission_homework_id_unique" UNIQUE("homework_id")
);
--> statement-breakpoint
ALTER TABLE "homework_answer" ADD CONSTRAINT "homework_answer_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD CONSTRAINT "homework_submission_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE no action ON UPDATE no action;
