// Database schema. Every table except shared reference data carries
// `teacher_id`, and every query filters by it (docs/architecture.md, 5.4).
//
// The teacher, session, account and verification tables belong to the
// authentication library; their shape follows what it expects.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, date, doublePrecision, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const teacher = pgTable("teacher", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // The teacher's own time zone for the schedule (#80): her time of every
  // lesson is shown in it. Changed in «Настройки»; the product owner works
  // from Bangkok.
  timeZone: text("time_zone").notNull().default("Asia/Bangkok"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_teacher_id_idx").on(t.teacherId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_teacher_id_idx").on(t.teacherId)],
);

// Short-lived values of the authentication library (for example reset codes).
// Shared by design: it is keyed by an identifier, not by a teacher.
export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// The student card (#18). Level, status and time zone hold values from
// src/domain/student.ts; the router validates them. The last name is optional
// and teacher-only: student, parent and agent procedures never select it.
export const student = pgTable(
  "student",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    level: text("level").notNull().default("A1"),
    timeZone: text("time_zone").notNull().default("Europe/Moscow"),
    status: text("status").notNull().default("discussion"),
    // Profile for the teacher and the assistant's context (#41): plain text,
    // teacher-only like the last name.
    age: text("age"),
    schoolYear: text("school_year"),
    interests: text("interests"),
    whatWorks: text("what_works"),
    gaps: text("gaps"),
    textbook: text("textbook"),
    currentUnit: text("current_unit"),
    // The student's textbook among the uploaded ones (#151), and the lesson of
    // it the teacher marked as passed, with when: the plan of a later held
    // lesson moves it on.
    textbookId: uuid("textbook_id").references((): AnyPgColumn => textbook.id),
    passedLessonId: text("passed_lesson_id"),
    passedLessonSetAt: timestamp("passed_lesson_set_at", { withTimezone: true }),
    // The family's goal and a personal measure of the teacher's own (#266): a
    // name and a unit, counted when a lesson is marked. Teacher only, like the
    // profile; the assistant does not see them yet.
    familyGoal: text("family_goal"),
    measureName: text("measure_name"),
    measureUnit: text("measure_unit"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("student_teacher_id_idx").on(t.teacherId),
    // Target of composite foreign keys that keep rows inside one teacher.
    unique("student_id_teacher_id_key").on(t.id, t.teacherId),
  ],
);

// Groups exist from the first migration because they are expensive to add
// later; their interface arrives in stage 3.
export const group = pgTable(
  "group",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("group_teacher_id_idx").on(t.teacherId),
    unique("group_id_teacher_id_key").on(t.id, t.teacherId),
  ],
);

// The composite foreign keys make the database refuse a member row that links
// one teacher's group with another teacher's student.
export const groupMember = pgTable(
  "group_member",
  {
    groupId: uuid("group_id").notNull(),
    studentId: uuid("student_id").notNull(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.studentId] }),
    foreignKey({
      name: "group_member_group_teacher_fk",
      columns: [t.groupId, t.teacherId],
      foreignColumns: [group.id, group.teacherId],
    }),
    foreignKey({
      name: "group_member_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("group_member_student_id_idx").on(t.studentId),
    index("group_member_teacher_id_idx").on(t.teacherId),
  ],
);

// Notes of the teacher (#42; architecture 5.4). Attached to a student now; a
// lesson reference arrives with the schedule. The composite key keeps a note
// inside the teacher who owns the student.
export const note = pgTable(
  "note",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "note_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("note_student_id_created_at_idx").on(t.studentId, t.createdAt),
    index("note_teacher_id_idx").on(t.teacherId),
  ],
);

// Access links (#19; architecture 8.1). One row per student and role; the
// token itself is never stored: it is derived from the row (HMAC with the
// LINK_KEY secret over id, role and generation), and only its hash is kept for
// the lookup on exchange. A reissue (#21) bumps the generation.
export const accessLink = pgTable(
  "access_link",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    role: text("role").notNull(),
    generation: bigint("generation", { mode: "number" }).notNull().default(1),
    tokenHash: text("token_hash").notNull().unique(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "access_link_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    unique("access_link_student_id_role_key").on(t.studentId, t.role),
    index("access_link_teacher_id_idx").on(t.teacherId),
  ],
);

// Sessions opened from an access link. The cookie holds a random value; only
// its hash is stored. A session belongs to one generation of its link, so a
// reissue ends every session opened from the old link.
export const linkSession = pgTable(
  "link_session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    linkId: uuid("link_id")
      .notNull()
      .references(() => accessLink.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("link_session_link_id_idx").on(t.linkId)],
);

// Homework (#32; architecture 5.4). The whole document in the homework
// format (docs/homework-format.md) is kept as it was imported; a published
// homework never changes. Statuses: draft, published, submitted ("сдана",
// #34), missed ("не сдана"). At most one published homework per
// student, kept by the database.
export const homework = pgTable(
  "homework",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    title: text("title").notNull(),
    document: jsonb("document").notNull(),
    status: text("status").notNull().default("draft"),
    dueDate: date("due_date"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // The attempt the student is on; «Открыть заново для ученика» moves it on (#36).
    attempt: bigint("attempt", { mode: "number" }).notNull().default(1),
    // The teacher's one comment on the homework (#36).
    reviewComment: text("review_comment"),
    // «Мини-вопрос после домашки» (#331): ticked in the draft, off by default.
    askFeedback: boolean("ask_feedback").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "homework_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("homework_student_id_idx").on(t.studentId),
    index("homework_teacher_id_idx").on(t.teacherId),
    uniqueIndex("homework_one_published_per_student")
      .on(t.studentId)
      .where(sql`${t.status} = 'published'`),
  ],
);

// Answers to a homework (#34): one row per task, saved after each task while
// the homework is published. On submission every task gets a row, with its
// correctness and the task's topic and skill: the dashboard and the teacher's
// gaps list read them. The key never leaves the server.
export const homeworkAnswer = pgTable(
  "homework_answer",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id),
    // The attempt the answer belongs to: a reopened homework starts a new one (#36).
    attempt: bigint("attempt", { mode: "number" }).notNull().default(1),
    taskIndex: bigint("task_index", { mode: "number" }).notNull(),
    answer: jsonb("answer"),
    // Set by the platform on submission for auto-checked tasks; null for the
    // tasks the teacher checks.
    correct: boolean("correct"),
    // The teacher's mark (#36): wins over `correct` when set.
    teacherMark: boolean("teacher_mark"),
    // An order task of several sentences (#161): each sentence's result and the
    // teacher's mark on it, [{ correct, mark }], one point each. Null for any
    // other task; `correct` then says whether every sentence is right.
    sentenceVerdicts: jsonb("sentence_verdicts"),
    topic: text("topic"),
    skill: text("skill"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("homework_answer_attempt_task_key").on(t.homeworkId, t.attempt, t.taskIndex)],
);

// Submissions of a homework, one per attempt (#34, #36). Exactly one is
// current per homework (and so per student), kept by a partial unique index; reopening
// closes the current one, which stays in the history as it was. A repeated
// request with the same idempotency key gets the same result back.
export const homeworkSubmission = pgTable(
  "homework_submission",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id),
    attempt: bigint("attempt", { mode: "number" }).notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    idempotencyKey: text("idempotency_key").notNull(),
    correctCount: bigint("correct_count", { mode: "number" }).notNull(),
    wrongCount: bigint("wrong_count", { mode: "number" }).notNull(),
    // Tasks the teacher has not marked yet; with `openedAt`, what «ждёт проверки» means.
    pendingCount: bigint("pending_count", { mode: "number" }).notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    // When the teacher first opened it in «Проверка домашек».
    openedAt: timestamp("opened_at", { withTimezone: true }),
  },
  (t) => [
    unique("homework_submission_homework_id_attempt_key").on(t.homeworkId, t.attempt),
    // A homework belongs to one student, so one current submission per homework
    // is one per homework and student.
    uniqueIndex("homework_submission_one_current")
      .on(t.homeworkId)
      .where(sql`${t.isCurrent}`),
  ],
);

// Past submissions imported from the teacher's old tool (#38): history to
// read, never reviewed, reopened or counted as waiting. One per student, date
// and homework title, so importing the same file again adds nothing.
export const importedSubmission = pgTable(
  "imported_submission",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    title: text("title").notNull(),
    submittedOn: date("submitted_on").notNull(),
    correctCount: bigint("correct_count", { mode: "number" }).notNull(),
    wrongCount: bigint("wrong_count", { mode: "number" }).notNull(),
    // Answers without a result: not checked in the old tool.
    uncheckedCount: bigint("unchecked_count", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "imported_submission_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    unique("imported_submission_once").on(t.teacherId, t.studentId, t.submittedOn, t.title),
    index("imported_submission_student_id_idx").on(t.studentId),
  ],
);

// One answer of an imported submission, as the history file gave it (#38):
// the task's text, type and topic, the answer, the key and right or wrong.
export const importedAnswer = pgTable(
  "imported_answer",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => importedSubmission.id),
    taskNumber: bigint("task_number", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    correctAnswer: text("correct_answer"),
    // Null when the old tool did not check it.
    correct: boolean("correct"),
    topic: text("topic"),
  },
  (t) => [unique("imported_answer_task_key").on(t.submissionId, t.taskNumber)],
);

// The assistant's personal token (#3; architecture 8.1). One active token per
// teacher; creating a new one revokes the old. Only the hash is stored; the
// token is shown to the teacher once.
export const agentToken = pgTable(
  "agent_token",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_token_one_active_per_teacher")
      .on(t.teacherId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// Files kept by the blob store (#33; architecture, decision 8). The bytes are
// in the store under the row's id; the row says whose file it is and what it
// is. There are no direct links: every file is served after a permission check.
export const blob = pgTable(
  "blob",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("blob_teacher_id_idx").on(t.teacherId)],
);

// The teacher's library (#115): games now, warm-ups and videos next. A game
// is one HTML file in the blob store; the tags are what the filters read.
export const libraryMaterial = pgTable(
  "library_material",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    level: text("level").notNull(),
    // Free text, as in the homework format; the filter offers the ones in use.
    // shortcut: the single topic before #290, copied into `topics` and no longer read or written; dropped once every environment runs #290 (#299)
    topic: text("topic"),
    // Its topics (#290), as typed, a repeat in another case kept once; the filter offers every one in use.
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    ageGroup: text("age_group").notNull(),
    // A game's HTML, a picture warm-up's picture (#116) or an own video (#117); a questions warm-up and a video link have no file.
    blobId: uuid("blob_id").references(() => blob.id),
    // A questions warm-up's conversation questions, in order (#116).
    questions: text("questions").array(),
    // A game the teacher also uses as a warm-up: listed under both (#116).
    warmup: boolean("warmup").notNull().default(false),
    // A game template (#282): when it opens, the platform sends it the words of a student.
    vocabulary: boolean("vocabulary").notNull().default(false),
    // A game linked to one lesson of the teacher's textbook (#291): the lesson's id inside
    // `textbook.structure`. A lesson no longer in the confirmed structure is no link.
    textbookId: uuid("textbook_id").references(() => textbook.id, { onDelete: "set null" }),
    textbookLessonId: uuid("textbook_lesson_id"),
    // A video link, http or https (#117).
    url: text("url"),
    // A video's transcript (#326), typed in «Расшифровка» by the teacher so
    // that the assistant drafts the video's tasks from its text.
    transcript: text("transcript"),
    // A game or warm-up the assistant saved (#120): not in the library until
    // the teacher adds it. The assistant replaces its draft while
    // `teacher_edited_at` is empty; after her edit it makes a new one.
    draft: boolean("draft").notNull().default(false),
    teacherEditedAt: timestamp("teacher_edited_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("library_material_teacher_id_idx").on(t.teacherId)],
);

// A game made for students (#292): the students a game is marked for. The
// game stays in the library for everyone; the mark only finds it. A deleted
// student's mark is not read; an archived student keeps it.
export const libraryMaterialStudent = pgTable(
  "library_material_student",
  {
    materialId: uuid("material_id")
      .notNull()
      .references(() => libraryMaterial.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
  },
  (t) => [primaryKey({ columns: [t.materialId, t.studentId] }), index("library_material_student_student_id_idx").on(t.studentId)],
);

// A textbook set (#156): the books (PDF) and the folder of tracks the
// teacher uploads to «Библиотека». Its files are the teacher's only
// (architecture, section 3): no student, parent or link ever reaches them.
export const textbook = pgTable(
  "textbook",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    title: text("title").notNull(),
    level: text("level").notNull(),
    // Units and lessons (#150, domain/textbook-structure.ts): the confirmed
    // structure lessons use, and a draft — the assistant's or the teacher's
    // own unconfirmed edits — that confirming replaces it with.
    structure: jsonb("structure"),
    structureDraft: jsonb("structure_draft"),
    structureDraftBy: text("structure_draft_by"),
    createdAt: createdAt(),
  },
  (t) => [index("textbook_teacher_id_idx").on(t.teacherId)],
);

// A file of a textbook set (#156): the student's book or the workbook (a PDF
// whose pages are rendered to images in the background), or a track. A
// book's render status is "queued", "rendering", "done" or "failed";
// `render_boot` is the server process that queued or took it, so one left by
// a process that has since stopped reads as failed and can be tried again.
export const textbookFile = pgTable(
  "textbook_file",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    textbookId: uuid("textbook_id")
      .notNull()
      .references(() => textbook.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    blobId: uuid("blob_id")
      .notNull()
      .references(() => blob.id),
    position: bigint("position", { mode: "number" }).notNull(),
    pageCount: bigint("page_count", { mode: "number" }),
    renderStatus: text("render_status"),
    renderBoot: text("render_boot"),
    createdAt: createdAt(),
  },
  (t) => [index("textbook_file_textbook_id_idx").on(t.textbookId)],
);

// A rendered page of a book (#156), numbered from 1, kept as an image.
export const textbookPage = pgTable(
  "textbook_page",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => textbookFile.id),
    number: bigint("number", { mode: "number" }).notNull(),
    blobId: uuid("blob_id")
      .notNull()
      .references(() => blob.id),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.number] })],
);

// The workbook task bank (#224): the tasks of one lesson of a textbook's
// structure, in the homework format, each with its source. `tasks` and
// `skipped` are the confirmed lesson; `draft` and `draft_skipped` the
// assistant's latest save, which replaces them only when the teacher
// confirms. `lesson_id` is a lesson's id inside `textbook.structure`, not a
// foreign key. The teacher's only: no student, parent or link reaches it.
export const textbookLessonTasks = pgTable(
  "textbook_lesson_tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    textbookId: uuid("textbook_id")
      .notNull()
      .references(() => textbook.id),
    lessonId: uuid("lesson_id").notNull(),
    tasks: jsonb("tasks"),
    skipped: jsonb("skipped"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    draft: jsonb("draft"),
    draftSkipped: jsonb("draft_skipped"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("textbook_lesson_tasks_lesson_key").on(t.textbookId, t.lessonId)],
);

// A student's weekly slot (#80; architecture 8.6): a weekday and a local time
// in the student's time zone, so a lesson stays "Tuesday at 17:00" for the
// student when clocks change. Lessons are created from it ahead of time.
export const scheduleSlot = pgTable(
  "schedule_slot",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    // 0 Sunday … 6 Saturday, as JavaScript's getUTCDay().
    weekday: bigint("weekday", { mode: "number" }).notNull(),
    startTime: text("start_time").notNull(),
    timeZone: text("time_zone").notNull(),
    durationMinutes: bigint("duration_minutes", { mode: "number" }).notNull(),
    validFrom: date("valid_from").notNull(),
    validUntil: date("valid_until"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "schedule_slot_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("schedule_slot_teacher_id_idx").on(t.teacherId),
    index("schedule_slot_student_id_idx").on(t.studentId),
  ],
);

// A lesson (#80): a moment in UTC and a duration. One from a slot carries the
// slot and the student's date it was made for, so topping up never makes it
// twice and a lesson moved by hand keeps its place in the series.
export const lesson = pgTable(
  "lesson",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    slotId: uuid("slot_id").references(() => scheduleSlot.id),
    slotDate: date("slot_date"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: bigint("duration_minutes", { mode: "number" }).notNull(),
    // "regular" or "intro" (вводный, free).
    kind: text("kind").notNull().default("regular"),
    // "scheduled" until marked; "held" or "missed" (#82); "cancelled" (#81).
    status: text("status").notNull().default("scheduled"),
    // Charged to the balance (#83): set when the lesson is marked or cancelled (#81).
    charged: boolean("charged"),
    // What the teacher wrote when marking it: the unit covered and a note.
    // Teacher only; kept on the lesson so it never joins the notes the
    // assistant reads.
    unit: text("unit"),
    note: text("note"),
    // The student's personal measure for this lesson, entered when marking it (#266).
    measure: doublePrecision("measure"),
    // When the lesson was first planned, if it has been moved since (#81):
    // the week says «перенесён с …», and a slot change leaves it alone.
    movedFrom: timestamp("moved_from", { withTimezone: true }),
    // The video call of this lesson (#81): the service gives no permanent
    // rooms, so every lesson has its own, pasted by the teacher.
    meetingLink: text("meeting_link"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "lesson_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("lesson_slot_date_key").on(t.slotId, t.slotDate),
    index("lesson_teacher_id_starts_at_idx").on(t.teacherId, t.startsAt),
    index("lesson_student_id_idx").on(t.studentId),
  ],
);

// Where a draft came from (#43; architecture 5.4): drafts the assistant saved
// carry a snapshot of the student context they were built on. While the
// teacher has not edited such a draft by hand, the assistant's next save
// replaces it; after her edit, the next save makes a new draft.
export const draftOrigin = pgTable("draft_origin", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  homeworkId: uuid("homework_id")
    .notNull()
    .unique()
    .references(() => homework.id),
  createdBy: text("created_by").notNull(),
  context: jsonb("context").notNull(),
  teacherEditedAt: timestamp("teacher_edited_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// The parent's and the student's contacts (#84; architecture 5.4): all
// optional, one row per student, for the teacher only. Never selected by a
// student, parent or agent procedure (architecture 6.3, AGENTS.md rule 4).
export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull().unique(),
    parentName: text("parent_name"),
    parentEmail: text("parent_email"),
    parentMessenger: text("parent_messenger"),
    studentEmail: text("student_email"),
    studentMessenger: text("student_messenger"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "contact_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("contact_teacher_id_idx").on(t.teacherId),
  ],
);

// The terms a student is taught on (#83): the payment format, the price of a
// lesson and its currency, in force from a date (the student's). A new row
// starts new terms; earlier lessons keep the price of their date.
export const priceTerms = pgTable(
  "price_terms",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    // "prepaid", "postpaid" or "free".
    format: text("format").notNull(),
    // In minor units (kopecks, cents, satang); 0 when free.
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    validFrom: date("valid_from").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "price_terms_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    unique("price_terms_student_id_valid_from_key").on(t.studentId, t.validFrom),
    index("price_terms_teacher_id_idx").on(t.teacherId),
  ],
);

// A payment the teacher received from a student (#83). The balance is
// computed from payments and charged lessons, never stored.
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    paidOn: date("paid_on").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "payment_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("payment_student_id_idx").on(t.studentId),
    index("payment_teacher_id_idx").on(t.teacherId),
  ],
);

// A payment's values before an edit or a delete (#101). Not shown anywhere:
// kept for about a month in case a correction was itself a mistake, then
// removed by `npm run payments:cleanup -w app`. The payment it was may be
// gone, so there is no reference to it.
export const paymentRevision = pgTable(
  "payment_revision",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid("payment_id").notNull(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    paidOn: date("paid_on").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    comment: text("comment"),
    // "edited" or "deleted".
    change: text("change").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("payment_revision_teacher_id_idx").on(t.teacherId), index("payment_revision_created_at_idx").on(t.createdAt)],
);

// A game the teacher opened to a student during a lesson (#118): the student
// plays it behind their link until `until`, one hour after that lesson's end.
// Opening it again in a later lesson moves `until`; a game deleted from the
// library takes its access with it.
export const gameAccess = pgTable(
  "game_access",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => libraryMaterial.id, { onDelete: "cascade" }),
    // A lesson removed from the schedule takes the access it gave with it.
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    until: timestamp("until", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "game_access_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("game_access_material_student_idx").on(t.materialId, t.studentId),
    index("game_access_student_id_idx").on(t.studentId),
  ],
);

// A result a game posted while the student played it behind their link
// (#119, docs/game-result-format.md): the answers as the format has them,
// with the game's title at that moment. Kept only while the game is open to
// the student (`game_access`); `lesson_id` is the lesson that access came
// from, so the latest result per game and lesson is the one that counts.
// No foreign keys to the game and the lesson: a result is the student's
// work and outlives a game deleted from the library or a lesson removed
// from the schedule. A game the teacher runs herself on her page during a
// lesson keeps its result for the student of that lesson (#147),
// `played_with_teacher`.
export const gameResult = pgTable(
  "game_result",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    materialId: uuid("material_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    title: text("title").notNull(),
    answers: jsonb("answers").notNull(),
    playedWithTeacher: boolean("played_with_teacher").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "game_result_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("game_result_student_created_idx").on(t.studentId, t.createdAt),
  ],
);

// The preparation of a lesson (#151, domain/lesson-plan.ts): the approved
// plan by stages — the lesson is «подготовлен» once it has one — and a draft
// the assistant saved for the teacher to approve; the homework draft prepared
// for it, published later by «Завершить урок».
/**
 * A textbook video opened to a student from a lesson's preparation (#329):
 * at once, until an hour after that lesson's end (product owner,
 * 2026-11-23), with the tasks of the lesson's bank the plan's video stage
 * picked, copied as they were when opened. Opening it again moves `until` and
 * the tasks on. The answers go to `video_answer` as a library video's do,
 * under the file's id.
 */
export const textbookVideoAccess = pgTable(
  "textbook_video_access",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => textbookFile.id),
    // A lesson removed from the schedule takes the access it gave with it.
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    tasks: jsonb("tasks").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "textbook_video_access_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("textbook_video_access_lesson_file_key").on(t.lessonId, t.fileId),
    index("textbook_video_access_student_id_idx").on(t.studentId),
  ],
);

export const lessonPlan = pgTable("lesson_plan", {
  lessonId: uuid("lesson_id")
    .primaryKey()
    .references(() => lesson.id),
  teacherId: uuid("teacher_id")
    .notNull()
    .references(() => teacher.id),
  plan: jsonb("plan"),
  draft: jsonb("draft"),
  homeworkId: uuid("homework_id").references(() => homework.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// The lesson mode's state (#152, architecture decision 9): one document of
// what is on the stage — the stages, the current one, the book's page and
// layout, the track — saved by the panel every few seconds, so a stage
// closed or a browser lost mid-lesson comes back where it was. `revision`
// is the panel's own counter: an older save arriving late never replaces a
// newer one. The note is the teacher's only and never reaches the stage.
export const lessonState = pgTable("lesson_state", {
  lessonId: uuid("lesson_id")
    .primaryKey()
    .references(() => lesson.id),
  teacherId: uuid("teacher_id")
    .notNull()
    .references(() => teacher.id),
  state: jsonb("state").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// The student's vocabulary (#154): words added when a lesson is finished —
// those of the book lesson covered and those the teacher noted on the panel.
// One row per word and student regardless of case; a later lesson fills in a
// missing translation. Teacher and assistant only: the student does not see
// it yet. A lesson removed from the schedule leaves its words.
export const vocabularyWord = pgTable(
  "vocabulary_word",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    word: text("word").notNull(),
    translation: text("translation"),
    // A sentence that uses the word (#236), written by the teacher; the student sees it under the word.
    example: text("example"),
    // The assistant's proposal (#237): a translation and an example the student does not see until the teacher confirms them.
    draftTranslation: text("draft_translation"),
    draftExample: text("draft_example"),
    // The lesson the word came from.
    lessonId: uuid("lesson_id").references(() => lesson.id, { onDelete: "set null" }),
    // The daily training (#238, domain/word-training.ts): how many right answers
    // in a row, on different days; the student's date it is due again (none:
    // new, due now); the answers so far; the last one.
    trainStep: bigint("train_step", { mode: "number" }).notNull().default(0),
    dueOn: date("due_on"),
    rightCount: bigint("right_count", { mode: "number" }).notNull().default(0),
    wrongCount: bigint("wrong_count", { mode: "number" }).notNull().default(0),
    trainedAt: timestamp("trained_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "vocabulary_word_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("vocabulary_word_student_word_key").on(t.studentId, sql`lower(${t.word})`),
  ],
);

// A result of an assessment by skill (#255): a percent on a date, entered by
// the teacher on the card until the monthly assessment's format is decided;
// the assessment will write the same rows (#252–#254). One per skill and
// date. The teacher's and the parent's dashboard read it; never a student.
export const skillResult = pgTable(
  "skill_result",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    skill: text("skill").notNull(),
    percent: bigint("percent", { mode: "number" }).notNull(),
    measuredOn: date("measured_on").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "skill_result_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("skill_result_student_skill_date_key").on(t.studentId, t.skill, t.measuredOn),
  ],
);

// A parent's report (#267): the period it covers in the student's dates, the
// teacher's blocks of text — a title and a text each, in her order — and
// whether the messenger text carries the balance line. A draft's numbers are
// counted when it is shown; publishing (#268) freezes them in `numbers`. At
// most one draft per student, kept by the database. The teacher's only until
// published; never a student's.
export const report = pgTable(
  "report",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    status: text("status").notNull().default("draft"),
    blocks: jsonb("blocks").notNull(),
    showPayments: boolean("show_payments").notNull().default(false),
    numbers: jsonb("numbers"),
    // The recordings «было» and «стало» the teacher uploaded (#269): blobs, served by
    // /api/files/reports to her and, once published, to the parent of the student.
    recordingBefore: uuid("recording_before").references(() => blob.id),
    recordingAfter: uuid("recording_after").references(() => blob.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "report_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("report_student_id_idx").on(t.studentId),
    uniqueIndex("report_one_draft_per_student")
      .on(t.studentId)
      .where(sql`${t.status} = 'draft'`),
  ],
);

// The monthly skills assessment (#252): the document in the assessment format
// (`docs/assessment-format.md`) with its keys, the teacher's recording for
// «Аудирование» and picture for «Говорение» as blobs, and the status: a draft
// the teacher corrects, or approved and fixed. The teacher's only; a student
// never receives its keys.
export const assessment = pgTable(
  "assessment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    title: text("title").notNull(),
    document: jsonb("document").notNull(),
    status: text("status").notNull().default("draft"),
    listeningRecording: uuid("listening_recording").references(() => blob.id),
    speakingPicture: uuid("speaking_picture").references(() => blob.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Who made the draft (#313): "teacher" by import, "agent" by the
    // assistant, with the period it was drafted from (`assessmentPeriod` of
    // the student context, nothing else of it). While the teacher
    // has done nothing to the assistant's draft, its next save replaces it;
    // her first action (a removal, the recording, the picture) sets
    // `teacherEditedAt`, and the next save makes a new draft.
    createdBy: text("created_by").notNull().default("teacher"),
    context: jsonb("context"),
    teacherEditedAt: timestamp("teacher_edited_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "assessment_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    index("assessment_student_id_idx").on(t.studentId),
  ],
);

/**
 * A library video's tasks (#326), in the homework format: the confirmed ones
 * a student gets (#327), and beside them the assistant's draft. The
 * assistant's save replaces its draft while the teacher has done nothing to
 * it (`draft_edited_at` empty); «Убрать» sets it; «Подтвердить» makes the
 * draft the confirmed tasks. One row per video, gone with it.
 */
export const videoTasks = pgTable(
  "video_tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => libraryMaterial.id, { onDelete: "cascade" }),
    tasks: jsonb("tasks"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    draft: jsonb("draft"),
    draftEditedAt: timestamp("draft_edited_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("video_tasks_material_key").on(t.materialId)],
);

/**
 * The child's answer to «Какое задание было самым интересным?» after a
 * homework's first «Сдать» (#331): a kind of the homework's tasks, "all" for
 * «Все классные», or null for «Пропустить». One per homework. Counts for
 * nothing; the teacher's only — no student or parent procedure returns it.
 */
export const homeworkFeedback = pgTable(
  "homework_feedback",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    answer: text("answer"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "homework_feedback_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("homework_feedback_homework_key").on(t.homeworkId),
    index("homework_feedback_student_id_idx").on(t.studentId),
  ],
);

/**
 * A request of a family that may become a student (#337), in «Привлечение
 * клиентов»: the child's first name, age and school year, the parent's
 * contact, the source and the date, and the stage the teacher moved it to;
 * «Отказ» keeps its reason and comment. «Удалить заявку» erases everything
 * personal and keeps the row as an anonymous count of its stage, source and
 * reason for the metrics (#341): `deleted_at` set, the personal fields null.
 */
export const clientRequest = pgTable(
  "client_request",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    firstName: text("first_name"),
    age: bigint("age", { mode: "number" }),
    schoolYear: text("school_year"),
    contact: text("contact"),
    source: text("source").notNull(),
    requestedOn: date("requested_on").notNull(),
    stage: text("stage").notNull().default("request"),
    declineReason: text("decline_reason"),
    declineComment: text("decline_comment"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_request_teacher_id_idx").on(t.teacherId)],
);

/**
 * The survey about the lessons sent with a homework (#332), when the teacher
 * ticks «Опрос по урокам» in its draft: its questions, gathered from the
 * lessons held in its period and edited in the draft; the child's answers.
 * A draft's survey is `draft`; «Опубликовать» opens it, «Снять с публикации»
 * takes an unanswered one back to `draft`; the child answers or skips it.
 * Counts for nothing; the teacher's only — the child gets the questions, never
 * an answer back, and the parent nothing.
 */
export const homeworkSurvey = pgTable(
  "homework_survey",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    homeworkId: uuid("homework_id")
      .notNull()
      .references(() => homework.id, { onDelete: "cascade" }),
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    questions: jsonb("questions").notNull(),
    answers: jsonb("answers"),
    status: text("status").notNull().default("draft"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "homework_survey_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("homework_survey_homework_key").on(t.homeworkId),
    index("homework_survey_student_id_idx").on(t.studentId),
  ],
);

/** «Бриф вводного» in «Настройки» (#339): the teacher's questions; none saved means the platform's starting set. */
export const introBriefTemplate = pgTable("intro_brief_template", {
  teacherId: uuid("teacher_id")
    .primaryKey()
    .references(() => teacher.id),
  questions: jsonb("questions").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * The brief filled in on a request during the intro (#339): the template's
 * questions as they were when it was first saved, so a later change of the
 * template leaves it as it was; the answers, quick choices and notes; and
 * «Удобное время» in the family's time zone. Erased with the request's
 * personal data by «Удалить заявку».
 */
export const clientRequestBrief = pgTable("client_request_brief", {
  requestId: uuid("request_id")
    .primaryKey()
    .references(() => clientRequest.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id")
    .notNull()
    .references(() => teacher.id),
  questions: jsonb("questions").notNull(),
  answers: jsonb("answers").notNull(),
  convenientTime: jsonb("convenient_time").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A student's answers to a library video's tasks (#327), given once per
 * video and lesson under the video behind their link: the confirmed tasks as
 * they were answered, keys included, the answers and the server's verdicts
 * (null for a task the teacher checks). No foreign key to the video or the
 * lesson: the student's mistakes outlive a video deleted from the library,
 * as a game's do (#119). Never sent back to the student.
 */
export const videoAnswer = pgTable(
  "video_answer",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    studentId: uuid("student_id").notNull(),
    materialId: uuid("material_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    title: text("title").notNull(),
    tasks: jsonb("tasks").notNull(),
    answers: jsonb("answers").notNull(),
    verdicts: jsonb("verdicts").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "video_answer_student_teacher_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [student.id, student.teacherId],
    }),
    uniqueIndex("video_answer_once_key").on(t.materialId, t.studentId, t.lessonId),
    index("video_answer_student_id_idx").on(t.studentId),
  ],
);
