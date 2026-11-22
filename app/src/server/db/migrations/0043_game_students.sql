-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #292: the students a game is made for. A new, empty table: its keys check nothing yet.
CREATE TABLE "library_material_student" (
	"material_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	CONSTRAINT "library_material_student_material_id_student_id_pk" PRIMARY KEY("material_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "library_material_student" ADD CONSTRAINT "library_material_student_material_id_library_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."library_material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_material_student" ADD CONSTRAINT "library_material_student_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_material_student" ADD CONSTRAINT "library_material_student_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_material_student_student_id_idx" ON "library_material_student" USING btree ("student_id");