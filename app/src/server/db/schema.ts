// Database schema. Every table except shared reference data carries
// `teacher_id`, and every query filters by it (docs/architecture.md, 5.4).
//
// The teacher, session, account and verification tables belong to the
// authentication library; their shape follows what it expects.
import { sql } from "drizzle-orm";
import { bigint, boolean, date, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
