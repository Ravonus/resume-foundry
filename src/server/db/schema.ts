import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("created_by_idx").on(t.createdById),
    index("name_idx").on(t.name),
  ],
);

export const resumeStatus = pgEnum("resume_status", [
  "draft",
  "ready",
  "archived",
]);

export const resumeSource = pgEnum("resume_source", [
  "manual",
  "linkedin",
  "import",
]);

export const resumeInputSource = pgEnum("resume_input_source", [
  "user",
  "linkedin",
  "inferred",
]);

export const resumes = createTable(
  "resume",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: d.varchar({ length: 256 }).notNull().default("Resume"),
    status: resumeStatus("status").notNull().default("draft"),
    source: resumeSource("source").notNull().default("manual"),
    rawLinkedIn: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("resume_user_idx").on(t.userId),
    index("resume_status_idx").on(t.status),
  ],
);

export const resumeProfiles = createTable(
  "resume_profile",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    fullName: d.varchar({ length: 256 }).notNull(),
    headline: d.varchar({ length: 256 }),
    jobField: d.varchar({ length: 128 }),
    email: d.varchar({ length: 256 }),
    phone: d.varchar({ length: 64 }),
    location: d.varchar({ length: 128 }),
    website: d.varchar({ length: 256 }),
    summary: d.text(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("resume_profile_resume_idx").on(t.resumeId),
    uniqueIndex("resume_profile_resume_unique").on(t.resumeId),
  ],
);

export const resumeExperiences = createTable(
  "resume_experience",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    roleTitle: d.varchar({ length: 256 }).notNull(),
    company: d.varchar({ length: 256 }).notNull(),
    location: d.varchar({ length: 128 }),
    startDate: d.date(),
    endDate: d.date(),
    isCurrent: d.boolean().notNull().default(false),
    summary: d.text(),
    highlights: d.jsonb(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_experience_resume_idx").on(t.resumeId),
    index("resume_experience_sort_idx").on(t.sortOrder),
  ],
);

export const resumeEducation = createTable(
  "resume_education",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    school: d.varchar({ length: 256 }).notNull(),
    degree: d.varchar({ length: 128 }),
    field: d.varchar({ length: 128 }),
    startDate: d.date(),
    endDate: d.date(),
    gpa: d.varchar({ length: 32 }),
    notes: d.text(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_education_resume_idx").on(t.resumeId),
    index("resume_education_sort_idx").on(t.sortOrder),
  ],
);

export const resumeSkills = createTable(
  "resume_skill",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 128 }).notNull(),
    category: d.varchar({ length: 128 }),
    proficiency: d.varchar({ length: 64 }),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_skill_resume_idx").on(t.resumeId),
    index("resume_skill_name_idx").on(t.name),
  ],
);

export const resumeLinks = createTable(
  "resume_link",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    label: d.varchar({ length: 128 }).notNull(),
    url: d.varchar({ length: 512 }).notNull(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_link_resume_idx").on(t.resumeId),
    index("resume_link_label_idx").on(t.label),
  ],
);

export const resumeInputs = createTable(
  "resume_input",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    key: d.varchar({ length: 128 }).notNull(),
    value: d.jsonb().notNull(),
    source: resumeInputSource("source").notNull().default("user"),
    confidence: d.integer(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("resume_input_resume_idx").on(t.resumeId),
    index("resume_input_key_idx").on(t.key),
  ],
);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
  resumes: many(resumes),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const resumeRelations = relations(resumes, ({ many, one }) => ({
  user: one(user, { fields: [resumes.userId], references: [user.id] }),
  profile: many(resumeProfiles),
  experiences: many(resumeExperiences),
  education: many(resumeEducation),
  skills: many(resumeSkills),
  links: many(resumeLinks),
  inputs: many(resumeInputs),
}));

export const resumeProfileRelations = relations(resumeProfiles, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeProfiles.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeExperienceRelations = relations(
  resumeExperiences,
  ({ one }) => ({
    resume: one(resumes, {
      fields: [resumeExperiences.resumeId],
      references: [resumes.id],
    }),
  }),
);

export const resumeEducationRelations = relations(resumeEducation, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeEducation.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeSkillRelations = relations(resumeSkills, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeSkills.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeLinkRelations = relations(resumeLinks, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeLinks.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeInputRelations = relations(resumeInputs, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeInputs.resumeId],
    references: [resumes.id],
  }),
}));
