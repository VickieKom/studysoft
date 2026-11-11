// Database schema. Every table except shared reference data carries
// `teacher_id`, and every query filters by it (docs/architecture.md, 5.4).
//
// The teacher, session, account and verification tables belong to the
// authentication library; their shape follows what it expects.
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

// The student card grows in the next slices (#18). The skeleton needs the
// table so the student list reads real rows and the groups can refer to it.
export const student = pgTable(
  "student",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacher.id),
    displayName: text("display_name").notNull(),
    createdAt: createdAt(),
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
