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

export const organizationMemberRole = pgEnum("organization_member_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const organizationMemberStatus = pgEnum("organization_member_status", [
  "active",
  "invited",
  "removed",
]);

export const sitePackageInterval = pgEnum("site_package_interval", [
  "one_time",
  "monthly",
  "yearly",
]);

export const billingProvider = pgEnum("billing_provider", [
  "stripe",
  "paddle",
  "manual",
]);

export const billingSubscriptionStatus = pgEnum("billing_subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
]);

export const billingInvoiceStatus = pgEnum("billing_invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);

export const siteStatus = pgEnum("site_status", [
  "draft",
  "building",
  "live",
  "paused",
  "archived",
  "failed",
]);

export const siteVisibility = pgEnum("site_visibility", [
  "public",
  "unlisted",
  "private",
]);

export const siteRole = pgEnum("site_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

export const siteDomainStatus = pgEnum("site_domain_status", [
  "pending",
  "verifying",
  "active",
  "failed",
]);

export const siteDomainProvider = pgEnum("site_domain_provider", [
  "manual",
  "cloudflare",
  "vercel",
  "gitea",
  "other",
]);

export const domainVerificationMethod = pgEnum(
  "domain_verification_method",
  ["dns", "http"],
);

export const dnsRecordType = pgEnum("dns_record_type", [
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "CAA",
]);

export const dnsRecordStatus = pgEnum("dns_record_status", [
  "pending",
  "active",
  "failed",
]);

export const certificateStatus = pgEnum("certificate_status", [
  "pending",
  "issued",
  "renewing",
  "expired",
  "failed",
]);

export const certificateProvider = pgEnum("certificate_provider", [
  "letsencrypt",
  "cloudflare",
  "custom",
]);

export const siteBuildStatus = pgEnum("site_build_status", [
  "queued",
  "running",
  "success",
  "failed",
  "canceled",
]);

export const siteDeploymentStatus = pgEnum("site_deployment_status", [
  "queued",
  "building",
  "deployed",
  "failed",
  "canceled",
]);

export const siteDeploymentEnvironment = pgEnum(
  "site_deployment_environment",
  ["production", "preview", "staging"],
);

export const siteAssetType = pgEnum("site_asset_type", [
  "resume_pdf",
  "resume_docx",
  "resume_md",
  "resume_txt",
  "resume_zip",
  "headshot",
  "theme",
  "other",
]);

export const siteAssetProvider = pgEnum("site_asset_provider", [
  "local",
  "s3",
  "gitea",
  "url",
]);

export const siteRevisionSource = pgEnum("site_revision_source", [
  "manual",
  "ai",
  "import",
  "publish",
  "system",
]);

export const sitePresenceStatus = pgEnum("site_presence_status", [
  "viewing",
  "editing",
]);

export const aiRunStatus = pgEnum("ai_run_status", [
  "running",
  "success",
  "error",
  "canceled",
]);

export const siteIntentStatus = pgEnum("site_intent_status", [
  "new",
  "converted",
  "abandoned",
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
    targetRole: d.varchar({ length: 256 }),
    jobField: d.varchar({ length: 128 }),
    jobType: d.varchar({ length: 64 }),
    email: d.varchar({ length: 256 }),
    phone: d.varchar({ length: 64 }),
    location: d.varchar({ length: 128 }),
    website: d.varchar({ length: 256 }),
    headshotUrl: d.varchar({ length: 1024 }),
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

export const resumeProjects = createTable(
  "resume_project",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 256 }).notNull(),
    role: d.varchar({ length: 128 }),
    description: d.text(),
    startDate: d.date(),
    endDate: d.date(),
    url: d.varchar({ length: 512 }),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_project_resume_idx").on(t.resumeId),
    index("resume_project_sort_idx").on(t.sortOrder),
  ],
);

export const resumeCertifications = createTable(
  "resume_certification",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 256 }).notNull(),
    issuer: d.varchar({ length: 256 }),
    issueDate: d.date(),
    expirationDate: d.date(),
    credentialId: d.varchar({ length: 128 }),
    credentialUrl: d.varchar({ length: 512 }),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_certification_resume_idx").on(t.resumeId),
    index("resume_certification_sort_idx").on(t.sortOrder),
  ],
);

export const resumeHonors = createTable(
  "resume_honor",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    title: d.varchar({ length: 256 }).notNull(),
    issuer: d.varchar({ length: 256 }),
    date: d.varchar({ length: 64 }),
    description: d.text(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_honor_resume_idx").on(t.resumeId),
    index("resume_honor_sort_idx").on(t.sortOrder),
  ],
);

export const resumeVolunteering = createTable(
  "resume_volunteering",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    role: d.varchar({ length: 256 }).notNull(),
    organization: d.varchar({ length: 256 }),
    cause: d.varchar({ length: 256 }),
    startDate: d.date(),
    endDate: d.date(),
    summary: d.text(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_volunteering_resume_idx").on(t.resumeId),
    index("resume_volunteering_sort_idx").on(t.sortOrder),
  ],
);

export const resumeServices = createTable(
  "resume_service",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    resumeId: d
      .uuid()
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 256 }).notNull(),
    description: d.text(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [
    index("resume_service_resume_idx").on(t.resumeId),
    index("resume_service_sort_idx").on(t.sortOrder),
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

export const organizations = createTable(
  "organization",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    name: d.varchar({ length: 256 }).notNull(),
    slug: d.varchar({ length: 128 }).notNull(),
    ownerUserId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    billingEmail: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("organization_owner_idx").on(t.ownerUserId),
    uniqueIndex("organization_slug_unique").on(t.slug),
  ],
);

export const organizationMembers = createTable(
  "organization_member",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: organizationMemberRole("role").notNull().default("member"),
    status: organizationMemberStatus("status").notNull().default("active"),
    invitedById: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("organization_member_org_idx").on(t.organizationId),
    index("organization_member_user_idx").on(t.userId),
    uniqueIndex("organization_member_unique").on(t.organizationId, t.userId),
  ],
);

export const sitePackages = createTable(
  "site_package",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    key: d.varchar({ length: 64 }).notNull(),
    name: d.varchar({ length: 128 }).notNull(),
    description: d.text(),
    priceCents: d.integer().notNull().default(0),
    currency: d.varchar({ length: 8 }).notNull().default("USD"),
    billingInterval: sitePackageInterval("billingInterval")
      .notNull()
      .default("one_time"),
    isActive: d.boolean().notNull().default(true),
    features: d.jsonb(),
    sortOrder: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex("site_package_key_unique").on(t.key),
    index("site_package_active_idx").on(t.isActive),
  ],
);

export const billingCustomers = createTable(
  "billing_customer",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    organizationId: d
      .uuid()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "cascade" }),
    provider: billingProvider("provider").notNull(),
    providerCustomerId: d.varchar({ length: 256 }).notNull(),
    email: d.varchar({ length: 256 }),
    metadata: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("billing_customer_org_idx").on(t.organizationId),
    index("billing_customer_user_idx").on(t.userId),
    uniqueIndex("billing_customer_provider_unique").on(
      t.provider,
      t.providerCustomerId,
    ),
  ],
);

export const billingSubscriptions = createTable(
  "billing_subscription",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    organizationId: d
      .uuid()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: d
      .uuid()
      .notNull()
      .references(() => billingCustomers.id, { onDelete: "cascade" }),
    packageId: d
      .uuid()
      .references(() => sitePackages.id, { onDelete: "set null" }),
    provider: billingProvider("provider").notNull(),
    providerSubscriptionId: d.varchar({ length: 256 }).notNull(),
    status: billingSubscriptionStatus("status").notNull().default("active"),
    currentPeriodStart: d.timestamp({ withTimezone: true }),
    currentPeriodEnd: d.timestamp({ withTimezone: true }),
    cancelAt: d.timestamp({ withTimezone: true }),
    canceledAt: d.timestamp({ withTimezone: true }),
    endedAt: d.timestamp({ withTimezone: true }),
    cancelAtPeriodEnd: d.boolean().notNull().default(false),
    metadata: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("billing_subscription_org_idx").on(t.organizationId),
    index("billing_subscription_customer_idx").on(t.customerId),
    index("billing_subscription_status_idx").on(t.status),
    uniqueIndex("billing_subscription_provider_unique").on(
      t.provider,
      t.providerSubscriptionId,
    ),
  ],
);

export const billingInvoices = createTable(
  "billing_invoice",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    subscriptionId: d
      .uuid()
      .references(() => billingSubscriptions.id, { onDelete: "set null" }),
    customerId: d
      .uuid()
      .notNull()
      .references(() => billingCustomers.id, { onDelete: "cascade" }),
    provider: billingProvider("provider").notNull(),
    providerInvoiceId: d.varchar({ length: 256 }).notNull(),
    status: billingInvoiceStatus("status").notNull().default("open"),
    currency: d.varchar({ length: 8 }).notNull().default("USD"),
    amountDueCents: d.integer(),
    amountPaidCents: d.integer(),
    hostedInvoiceUrl: d.text(),
    invoicePdfUrl: d.text(),
    dueAt: d.timestamp({ withTimezone: true }),
    paidAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("billing_invoice_subscription_idx").on(t.subscriptionId),
    index("billing_invoice_customer_idx").on(t.customerId),
    index("billing_invoice_status_idx").on(t.status),
    uniqueIndex("billing_invoice_provider_unique").on(
      t.provider,
      t.providerInvoiceId,
    ),
  ],
);

export const sites = createTable(
  "site",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    organizationId: d
      .uuid()
      .references(() => organizations.id, { onDelete: "set null" }),
    ownerUserId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    packageId: d
      .uuid()
      .references(() => sitePackages.id, { onDelete: "set null" }),
    resumeId: d.uuid().references(() => resumes.id, { onDelete: "set null" }),
    status: siteStatus("status").notNull().default("draft"),
    visibility: siteVisibility("visibility").notNull().default("public"),
    slug: d.varchar({ length: 128 }).notNull(),
    title: d.varchar({ length: 256 }),
    description: d.text(),
    primaryDomain: d.varchar({ length: 255 }),
    themeConfig: d.jsonb(),
    resumeSnapshot: d.jsonb(),
    lastPublishedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_org_idx").on(t.organizationId),
    index("site_owner_idx").on(t.ownerUserId),
    index("site_status_idx").on(t.status),
    uniqueIndex("site_slug_unique").on(t.slug),
  ],
);

export const siteMembers = createTable(
  "site_member",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: siteRole("role").notNull().default("editor"),
    invitedById: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_member_site_idx").on(t.siteId),
    index("site_member_user_idx").on(t.userId),
    uniqueIndex("site_member_unique").on(t.siteId, t.userId),
  ],
);

export const siteDomains = createTable(
  "site_domain",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    hostname: d.varchar({ length: 255 }).notNull(),
    status: siteDomainStatus("status").notNull().default("pending"),
    provider: siteDomainProvider("provider").notNull().default("manual"),
    verificationMethod: domainVerificationMethod("verificationMethod")
      .notNull()
      .default("dns"),
    verificationToken: d.text(),
    isPrimary: d.boolean().notNull().default(false),
    lastError: d.text(),
    verifiedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_domain_site_idx").on(t.siteId),
    index("site_domain_status_idx").on(t.status),
    uniqueIndex("site_domain_hostname_unique").on(t.hostname),
  ],
);

export const siteDnsRecords = createTable(
  "site_dns_record",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    domainId: d
      .uuid()
      .notNull()
      .references(() => siteDomains.id, { onDelete: "cascade" }),
    type: dnsRecordType("type").notNull(),
    name: d.varchar({ length: 255 }).notNull(),
    value: d.text().notNull(),
    ttl: d.integer().notNull().default(3600),
    status: dnsRecordStatus("status").notNull().default("pending"),
    lastCheckedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_dns_record_domain_idx").on(t.domainId),
    index("site_dns_record_type_idx").on(t.type),
    index("site_dns_record_status_idx").on(t.status),
  ],
);

export const siteCertificates = createTable(
  "site_certificate",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    domainId: d
      .uuid()
      .notNull()
      .references(() => siteDomains.id, { onDelete: "cascade" }),
    status: certificateStatus("status").notNull().default("pending"),
    provider: certificateProvider("provider").notNull().default("letsencrypt"),
    issuedAt: d.timestamp({ withTimezone: true }),
    expiresAt: d.timestamp({ withTimezone: true }),
    lastError: d.text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_certificate_domain_idx").on(t.domainId),
    index("site_certificate_status_idx").on(t.status),
  ],
);

export const siteBuilds = createTable(
  "site_build",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    status: siteBuildStatus("status").notNull().default("queued"),
    jobId: d.varchar({ length: 128 }),
    provider: d.varchar({ length: 64 }),
    prompt: d.text(),
    payload: d.jsonb(),
    output: d.jsonb(),
    createdById: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    startedAt: d.timestamp({ withTimezone: true }),
    completedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_build_site_idx").on(t.siteId),
    index("site_build_status_idx").on(t.status),
    index("site_build_job_idx").on(t.jobId),
  ],
);

export const siteDeployments = createTable(
  "site_deployment",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    buildId: d
      .uuid()
      .references(() => siteBuilds.id, { onDelete: "set null" }),
    status: siteDeploymentStatus("status").notNull().default("queued"),
    environment: siteDeploymentEnvironment("environment")
      .notNull()
      .default("production"),
    repoProvider: d.varchar({ length: 64 }),
    repoName: d.varchar({ length: 256 }),
    defaultBranch: d.varchar({ length: 64 }),
    commitSha: d.varchar({ length: 64 }),
    url: d.text(),
    startedAt: d.timestamp({ withTimezone: true }),
    completedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_deployment_site_idx").on(t.siteId),
    index("site_deployment_status_idx").on(t.status),
    index("site_deployment_build_idx").on(t.buildId),
  ],
);

export const siteAssets = createTable(
  "site_asset",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: siteAssetType("type").notNull(),
    provider: siteAssetProvider("provider").notNull().default("local"),
    storageKey: d.text().notNull(),
    filename: d.text(),
    contentType: d.varchar({ length: 128 }),
    sizeBytes: d.integer(),
    checksum: d.varchar({ length: 128 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("site_asset_site_idx").on(t.siteId),
    index("site_asset_type_idx").on(t.type),
  ],
);

export const siteRevisions = createTable(
  "site_revision",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    createdById: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    source: siteRevisionSource("source").notNull().default("manual"),
    summary: d.text(),
    resumeData: d.jsonb(),
    themeData: d.jsonb(),
    metadata: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("site_revision_site_idx").on(t.siteId),
    index("site_revision_created_idx").on(t.createdAt),
  ],
);

export const sitePresence = createTable(
  "site_presence",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    sessionId: d.varchar({ length: 128 }).notNull(),
    status: sitePresenceStatus("status").notNull().default("viewing"),
    lastSeenAt: d.timestamp({ withTimezone: true }),
    metadata: d.jsonb(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_presence_site_idx").on(t.siteId),
    index("site_presence_user_idx").on(t.userId),
    index("site_presence_session_idx").on(t.sessionId),
  ],
);

export const siteAiRuns = createTable(
  "site_ai_run",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    siteId: d
      .uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    operation: d.varchar({ length: 128 }).notNull(),
    provider: d.varchar({ length: 64 }),
    model: d.varchar({ length: 128 }),
    status: aiRunStatus("status").notNull().default("running"),
    prompt: d.text(),
    response: d.text(),
    tokens: d.integer(),
    costCents: d.integer(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_ai_run_site_idx").on(t.siteId),
    index("site_ai_run_operation_idx").on(t.operation),
    index("site_ai_run_status_idx").on(t.status),
  ],
);

export const siteIntents = createTable(
  "site_intent",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    status: siteIntentStatus("status").notNull().default("new"),
    email: d.varchar({ length: 256 }),
    slug: d.varchar({ length: 128 }),
    packageId: d
      .uuid()
      .references(() => sitePackages.id, { onDelete: "set null" }),
    prompt: d.text(),
    resumeMarkdown: d.text(),
    resumeText: d.text(),
    resumeData: d.jsonb(),
    headshotBase64: d.text(),
    userId: d
      .varchar({ length: 255 })
      .references(() => user.id, { onDelete: "set null" }),
    ipAddress: d.varchar({ length: 64 }),
    userAgent: d.text(),
    convertedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("site_intent_status_idx").on(t.status),
    index("site_intent_slug_idx").on(t.slug),
    index("site_intent_email_idx").on(t.email),
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
  organizationsOwned: many(organizations),
  organizationMemberships: many(organizationMembers),
  sitesOwned: many(sites),
  siteMemberships: many(siteMembers),
  sitePresence: many(sitePresence),
  siteAiRuns: many(siteAiRuns),
  siteRevisions: many(siteRevisions),
  siteBuilds: many(siteBuilds),
  siteIntents: many(siteIntents),
  billingCustomers: many(billingCustomers),
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
  projects: many(resumeProjects),
  certifications: many(resumeCertifications),
  honors: many(resumeHonors),
  volunteering: many(resumeVolunteering),
  services: many(resumeServices),
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

export const resumeProjectRelations = relations(resumeProjects, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeProjects.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeCertificationRelations = relations(
  resumeCertifications,
  ({ one }) => ({
    resume: one(resumes, {
      fields: [resumeCertifications.resumeId],
      references: [resumes.id],
    }),
  }),
);

export const resumeHonorRelations = relations(resumeHonors, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeHonors.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeVolunteeringRelations = relations(
  resumeVolunteering,
  ({ one }) => ({
    resume: one(resumes, {
      fields: [resumeVolunteering.resumeId],
      references: [resumes.id],
    }),
  }),
);

export const resumeServiceRelations = relations(resumeServices, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeServices.resumeId],
    references: [resumes.id],
  }),
}));

export const resumeInputRelations = relations(resumeInputs, ({ one }) => ({
  resume: one(resumes, {
    fields: [resumeInputs.resumeId],
    references: [resumes.id],
  }),
}));

export const organizationRelations = relations(
  organizations,
  ({ many, one }) => ({
    owner: one(user, {
      fields: [organizations.ownerUserId],
      references: [user.id],
    }),
    members: many(organizationMembers),
    sites: many(sites),
    billingCustomers: many(billingCustomers),
    subscriptions: many(billingSubscriptions),
  }),
);

export const organizationMemberRelations = relations(
  organizationMembers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),
    user: one(user, {
      fields: [organizationMembers.userId],
      references: [user.id],
    }),
    invitedBy: one(user, {
      fields: [organizationMembers.invitedById],
      references: [user.id],
    }),
  }),
);

export const sitePackageRelations = relations(sitePackages, ({ many }) => ({
  sites: many(sites),
  subscriptions: many(billingSubscriptions),
  intents: many(siteIntents),
}));

export const billingCustomerRelations = relations(
  billingCustomers,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [billingCustomers.organizationId],
      references: [organizations.id],
    }),
    user: one(user, {
      fields: [billingCustomers.userId],
      references: [user.id],
    }),
    subscriptions: many(billingSubscriptions),
    invoices: many(billingInvoices),
  }),
);

export const billingSubscriptionRelations = relations(
  billingSubscriptions,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [billingSubscriptions.organizationId],
      references: [organizations.id],
    }),
    customer: one(billingCustomers, {
      fields: [billingSubscriptions.customerId],
      references: [billingCustomers.id],
    }),
    package: one(sitePackages, {
      fields: [billingSubscriptions.packageId],
      references: [sitePackages.id],
    }),
    invoices: many(billingInvoices),
  }),
);

export const billingInvoiceRelations = relations(
  billingInvoices,
  ({ one }) => ({
    customer: one(billingCustomers, {
      fields: [billingInvoices.customerId],
      references: [billingCustomers.id],
    }),
    subscription: one(billingSubscriptions, {
      fields: [billingInvoices.subscriptionId],
      references: [billingSubscriptions.id],
    }),
  }),
);

export const siteRelations = relations(sites, ({ many, one }) => ({
  organization: one(organizations, {
    fields: [sites.organizationId],
    references: [organizations.id],
  }),
  owner: one(user, {
    fields: [sites.ownerUserId],
    references: [user.id],
  }),
  package: one(sitePackages, {
    fields: [sites.packageId],
    references: [sitePackages.id],
  }),
  resume: one(resumes, { fields: [sites.resumeId], references: [resumes.id] }),
  members: many(siteMembers),
  domains: many(siteDomains),
  builds: many(siteBuilds),
  deployments: many(siteDeployments),
  assets: many(siteAssets),
  revisions: many(siteRevisions),
  presence: many(sitePresence),
  aiRuns: many(siteAiRuns),
}));

export const siteMemberRelations = relations(siteMembers, ({ one }) => ({
  site: one(sites, {
    fields: [siteMembers.siteId],
    references: [sites.id],
  }),
  user: one(user, { fields: [siteMembers.userId], references: [user.id] }),
  invitedBy: one(user, {
    fields: [siteMembers.invitedById],
    references: [user.id],
  }),
}));

export const siteDomainRelations = relations(siteDomains, ({ many, one }) => ({
  site: one(sites, { fields: [siteDomains.siteId], references: [sites.id] }),
  dnsRecords: many(siteDnsRecords),
  certificates: many(siteCertificates),
}));

export const siteDnsRecordRelations = relations(siteDnsRecords, ({ one }) => ({
  domain: one(siteDomains, {
    fields: [siteDnsRecords.domainId],
    references: [siteDomains.id],
  }),
}));

export const siteCertificateRelations = relations(
  siteCertificates,
  ({ one }) => ({
    domain: one(siteDomains, {
      fields: [siteCertificates.domainId],
      references: [siteDomains.id],
    }),
  }),
);

export const siteBuildRelations = relations(siteBuilds, ({ many, one }) => ({
  site: one(sites, { fields: [siteBuilds.siteId], references: [sites.id] }),
  createdBy: one(user, {
    fields: [siteBuilds.createdById],
    references: [user.id],
  }),
  deployments: many(siteDeployments),
}));

export const siteDeploymentRelations = relations(
  siteDeployments,
  ({ one }) => ({
    site: one(sites, {
      fields: [siteDeployments.siteId],
      references: [sites.id],
    }),
    build: one(siteBuilds, {
      fields: [siteDeployments.buildId],
      references: [siteBuilds.id],
    }),
  }),
);

export const siteAssetRelations = relations(siteAssets, ({ one }) => ({
  site: one(sites, { fields: [siteAssets.siteId], references: [sites.id] }),
}));

export const siteRevisionRelations = relations(siteRevisions, ({ one }) => ({
  site: one(sites, {
    fields: [siteRevisions.siteId],
    references: [sites.id],
  }),
  createdBy: one(user, {
    fields: [siteRevisions.createdById],
    references: [user.id],
  }),
}));

export const sitePresenceRelations = relations(sitePresence, ({ one }) => ({
  site: one(sites, {
    fields: [sitePresence.siteId],
    references: [sites.id],
  }),
  user: one(user, {
    fields: [sitePresence.userId],
    references: [user.id],
  }),
}));

export const siteAiRunRelations = relations(siteAiRuns, ({ one }) => ({
  site: one(sites, { fields: [siteAiRuns.siteId], references: [sites.id] }),
  user: one(user, { fields: [siteAiRuns.userId], references: [user.id] }),
}));

export const siteIntentRelations = relations(siteIntents, ({ one }) => ({
  user: one(user, { fields: [siteIntents.userId], references: [user.id] }),
  package: one(sitePackages, {
    fields: [siteIntents.packageId],
    references: [sitePackages.id],
  }),
}));
