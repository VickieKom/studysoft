-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #339: the teacher's brief template and the briefs filled in on requests. New tables.
CREATE TABLE "client_request_brief" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"teacher_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"convenient_time" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intro_brief_template" (
	"teacher_id" uuid PRIMARY KEY NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_request_brief" ADD CONSTRAINT "client_request_brief_request_id_client_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."client_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_request_brief" ADD CONSTRAINT "client_request_brief_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_brief_template" ADD CONSTRAINT "intro_brief_template_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;