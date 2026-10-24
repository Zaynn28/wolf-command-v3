import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailNormalized: text("email_normalized").notNull(),
    status: text("status").notNull(),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("users_email_normalized_key").on(table.emailNormalized),
    check("users_status_check", sql`${table.status} in ('active', 'disabled')`),
    check(
      "users_email_normalized_check",
      sql`${table.emailNormalized} = lower(${table.emailNormalized}) and length(${table.emailNormalized}) between 3 and 254`,
    ),
    check(
      "users_password_hash_check",
      sql`${table.passwordHash} is null or (${table.passwordHash} like '$argon2id$%' and length(${table.passwordHash}) between 50 and 512)`,
    ),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check("companies_id_check", sql`length(btrim(${table.id})) > 0`),
    check("companies_status_check", sql`${table.status} in ('active', 'disabled')`),
  ],
);

export const departments = pgTable(
  "departments",
  {
    companyId: text("company_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.id] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "departments_company_id_fkey",
    }).onDelete("restrict"),
    check("departments_id_check", sql`length(btrim(${table.id})) > 0`),
    check("departments_status_check", sql`${table.status} in ('active', 'disabled')`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id"),
    role: text("role").notNull(),
    status: text("status").notNull(),
    origin: text("origin").notNull().default("provisioned"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    policyVersionId: uuid("policy_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "memberships_user_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "memberships_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "memberships_department_fk",
    }).onDelete("restrict"),
    uniqueIndex("memberships_user_company_department")
      .on(table.userId, table.companyId, sql`coalesce(${table.departmentId}, '')`)
      .where(sql`${table.status} = 'active'`),
    index("memberships_company").on(table.companyId),
    check("memberships_role_check", sql`${table.role} in ('staff', 'administrator', 'owner')`),
    check("memberships_status_check", sql`${table.status} in ('active', 'disabled')`),
    check("memberships_origin_check", sql`${table.origin} in ('provisioned', 'policy')`),
    check("memberships_company_check", sql`length(trim(${table.companyId})) > 0`),
  ],
);

export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    grantType: text("grant_type").notNull(),
    companyId: text("company_id").notNull(),
    scope: text("scope"),
    departmentId: text("department_id"),
    origin: text("origin").notNull().default("provisioned"),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    policyVersionId: uuid("policy_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "grants_user_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "grants_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "grants_department_fk",
    }).onDelete("restrict"),
    uniqueIndex("grants_owner_private_once")
      .on(table.userId, table.companyId)
      .where(sql`${table.grantType} = 'owner_private' and ${table.status} = 'active'`),
    uniqueIndex("grants_approve_once")
      .on(table.userId, table.companyId, table.scope, sql`coalesce(${table.departmentId}, '')`)
      .where(sql`${table.grantType} = 'approve' and ${table.status} = 'active'`),
    index("grants_company").on(table.companyId),
    check("grants_origin_check", sql`${table.origin} in ('provisioned', 'policy')`),
    check("grants_status_check", sql`${table.status} in ('active', 'disabled')`),
    check(
      "grants_shape_check",
      sql`(
        (${table.grantType} = 'owner_private' and ${table.scope} is null and ${table.departmentId} is null and length(trim(${table.companyId})) > 0)
        or (${table.grantType} = 'approve' and ${table.scope} in ('company', 'owner_private') and ${table.departmentId} is null and length(trim(${table.companyId})) > 0)
        or (${table.grantType} = 'approve' and ${table.scope} = 'department' and ${table.departmentId} is not null and length(trim(${table.departmentId})) > 0 and length(trim(${table.companyId})) > 0)
      )`,
    ),
  ],
);

export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailNormalized: text("email_normalized").notNull(),
    ip: text("ip"),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check("auth_attempts_kind_check", sql`${table.kind} in ('send', 'verify', 'login')`),
    index("auth_attempts_email_kind_created").on(table.kind, table.emailNormalized, table.createdAt),
    index("auth_attempts_ip_kind_created").on(table.kind, table.ip, table.createdAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_fkey",
    }).onDelete("cascade"),
    unique("sessions_token_hash_key").on(table.tokenHash),
    check("sessions_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    index("sessions_user_id").on(table.userId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    companyId: text("company_id"),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    emailFingerprint: text("email_fingerprint"),
    ip: text("ip"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "audit_events_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "audit_events_company_fk",
    }).onDelete("restrict"),
    check(
      "audit_events_type_check",
      sql`${table.eventType} in (
        'sign_in_code_issued',
        'sign_in_suppressed',
        'sign_in_rate_limited',
        'verify_rate_limited',
        'email_failed',
        'otp_rejected_mismatch',
        'otp_rejected_expired',
        'otp_rejected_attempts',
        'otp_rejected_used',
        'otp_verified',
        'session_created',
        'session_revoked',
        'authorization_allowed',
        'authorization_denied',
        'login_succeeded',
        'login_rejected',
        'login_rate_limited',
        'password_changed',
        'password_reset_by_admin',
        'account_provisioned'
      )`,
    ),
    check(
      "audit_events_resource_check",
      sql`(
        (${table.resourceType} is null and ${table.resourceId} is null)
        or (
          ${table.resourceType} is not null
          and length(btrim(${table.resourceType})) > 0
          and ${table.resourceId} is not null
          and length(btrim(${table.resourceId})) > 0
        )
      )`,
    ),
    index("audit_events_created").on(table.createdAt),
    index("audit_events_user").on(table.userId),
    index("audit_events_company_created").on(table.companyId, table.createdAt),
  ],
);

export const platformOperators = pgTable("platform_operators", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const financeSettings = pgTable(
  "finance_settings",
  {
    companyId: text("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "restrict" }),
    currencyCode: text("currency_code").notNull(),
    minorScale: integer("minor_scale").notNull(),
    workspaceKind: text("workspace_kind").notNull().default("shared"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check("finance_settings_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check("finance_settings_scale_check", sql`${table.minorScale} between 0 and 4`),
    check("finance_settings_workspace_check", sql`${table.workspaceKind} in ('shared', 'amg')`),
  ],
);

export const financeModules = pgTable(
  "finance_modules",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    moduleId: text("module_id").notNull(),
    enabled: text("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.moduleId] }),
    check("finance_modules_enabled_check", sql`${table.enabled} in ('Y', 'N')`),
    check(
      "finance_modules_id_check",
      sql`${table.moduleId} in ('dashboard', 'accounting-core', 'reports', 'settings', 'atrium-workflows', 'inventory', 'service-charges', 'owner-pool', 'petty-cash', 'tax', 'hotel-operations', 'procurement')`,
    ),
  ],
);

export const financeMappingConfigurations = pgTable(
  "finance_mapping_configurations",
  {
    companyId: text("company_id").notNull(),
    revenueDefaultDebitAccount: text("revenue_default_debit_account").notNull(),
    spendingProcurementCreditAccount: text("spending_procurement_credit_account").notNull(),
    spendingPayrollCreditAccount: text("spending_payroll_credit_account").notNull(),
    spendingOtherCreditAccount: text("spending_other_credit_account").notNull(),
    confirmedByController: boolean("confirmed_by_controller").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_mapping_configurations_company_fk",
    }).onDelete("restrict"),
    check(
      "finance_mapping_configurations_accounts_check",
      sql`${table.revenueDefaultDebitAccount} ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' and ${table.spendingProcurementCreditAccount} ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' and ${table.spendingPayrollCreditAccount} ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' and ${table.spendingOtherCreditAccount} ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'`,
    ),
  ],
);

export const financeOperatingDepartments = pgTable(
  "finance_operating_departments",
  {
    companyId: text("company_id").notNull(),
    departmentCode: text("department_code").notNull(),
    departmentName: text("department_name").notNull(),
    active: text("active").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.departmentCode] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_operating_departments_company_fk",
    }).onDelete("restrict"),
    check("finance_operating_departments_code_check", sql`${table.departmentCode} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'`),
    check("finance_operating_departments_name_check", sql`length(btrim(${table.departmentName})) between 1 and 120`),
    check("finance_operating_departments_active_check", sql`${table.active} in ('Y', 'N')`),
  ],
);

export const financeChartAccounts = pgTable(
  "finance_chart_accounts",
  {
    companyId: text("company_id").notNull(),
    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    accountType: text("account_type").notNull(),
    normalBalance: text("normal_balance").notNull(),
    statutoryLine: text("statutory_line").notNull(),
    usaliLine: text("usali_line").notNull(),
    active: text("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.accountCode] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_chart_accounts_company_fk",
    }).onDelete("restrict"),
    check("finance_chart_accounts_code_check", sql`${table.accountCode} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'`),
    check("finance_chart_accounts_name_check", sql`length(btrim(${table.accountName})) between 1 and 200`),
    check("finance_chart_accounts_type_check", sql`${table.accountType} in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')`),
    check("finance_chart_accounts_balance_check", sql`${table.normalBalance} in ('Debit', 'Credit')`),
    check("finance_chart_accounts_statutory_check", sql`length(${table.statutoryLine}) <= 200`),
    check("finance_chart_accounts_usali_check", sql`length(${table.usaliLine}) <= 200`),
    check("finance_chart_accounts_active_check", sql`${table.active} in ('Y', 'N')`),
  ],
);

export const atriumDraftJournals = pgTable(
  "atrium_draft_journals",
  {
    companyId: text("company_id").notNull(),
    journalId: text("journal_id").notNull(),
    journalDate: date("journal_date", { mode: "string" }).notNull(),
    period: text("period").notNull(),
    status: text("status").notNull(),
    sourceType: text("source_type").notNull(),
    sourceReference: text("source_reference").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.journalId] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "atrium_draft_journals_company_fk",
    }).onDelete("restrict"),
    check("atrium_draft_journals_id_check", sql`${table.journalId} ~ '^jrn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
    check("atrium_draft_journals_period_check", sql`${table.period} ~ '^[0-9]{4}-[0-9]{2}$' and ${table.period} = to_char(${table.journalDate}, 'YYYY-MM')`),
    check("atrium_draft_journals_status_check", sql`${table.status} = 'DRAFT'`),
    check("atrium_draft_journals_source_check", sql`${table.sourceType} in ('MANUAL', 'REVENUE', 'SPENDING')`),
    check("atrium_draft_journals_reference_check", sql`length(${table.sourceReference}) <= 200`),
    check("atrium_draft_journals_created_by_check", sql`length(btrim(${table.createdBy})) between 1 and 200`),
  ],
);

export const atriumDraftJournalLines = pgTable(
  "atrium_draft_journal_lines",
  {
    companyId: text("company_id").notNull(),
    journalId: text("journal_id").notNull(),
    lineNo: integer("line_no").notNull(),
    accountCode: text("account_code").notNull(),
    departmentCode: text("department_code"),
    debit: numeric("debit").notNull(),
    credit: numeric("credit").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.journalId, table.lineNo] }),
    foreignKey({
      columns: [table.companyId, table.journalId],
      foreignColumns: [atriumDraftJournals.companyId, atriumDraftJournals.journalId],
      name: "atrium_draft_journal_lines_journal_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId, table.accountCode],
      foreignColumns: [financeChartAccounts.companyId, financeChartAccounts.accountCode],
      name: "atrium_draft_journal_lines_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentCode],
      foreignColumns: [financeOperatingDepartments.companyId, financeOperatingDepartments.departmentCode],
      name: "atrium_draft_journal_lines_department_fk",
    }).onDelete("restrict"),
    check("atrium_draft_journal_lines_no_check", sql`${table.lineNo} between 1 and 40`),
    check("atrium_draft_journal_lines_description_check", sql`length(${table.description}) <= 500`),
    check(
      "atrium_draft_journal_lines_amount_check",
      sql`${table.debit} >= 0 and ${table.credit} >= 0 and scale(${table.debit}) <= 2 and scale(${table.credit}) <= 2 and ((${table.debit} = 0 and ${table.credit} > 0) or (${table.credit} = 0 and ${table.debit} > 0))`,
    ),
  ],
);

export const atriumRevenueDocuments = pgTable(
  "atrium_revenue_documents",
  {
    companyId: text("company_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    journalId: text("journal_id").notNull(),
    documentDate: date("document_date", { mode: "string" }).notNull(),
    source: text("source").notNull(),
    departmentCode: text("department_code").notNull(),
    accountCode: text("account_code").notNull(),
    amount: numeric("amount").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.transactionId] }),
    unique("atrium_revenue_documents_journal_key").on(table.companyId, table.journalId),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "atrium_revenue_documents_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.journalId],
      foreignColumns: [atriumDraftJournals.companyId, atriumDraftJournals.journalId],
      name: "atrium_revenue_documents_journal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.accountCode],
      foreignColumns: [financeChartAccounts.companyId, financeChartAccounts.accountCode],
      name: "atrium_revenue_documents_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentCode],
      foreignColumns: [financeOperatingDepartments.companyId, financeOperatingDepartments.departmentCode],
      name: "atrium_revenue_documents_department_fk",
    }).onDelete("restrict"),
    check("atrium_revenue_documents_id_check", sql`${table.transactionId} ~ '^rev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
    check("atrium_revenue_documents_source_check", sql`${table.source} in ('Manual', 'PMS')`),
    check("atrium_revenue_documents_description_check", sql`length(${table.description}) <= 500`),
    check("atrium_revenue_documents_amount_check", sql`${table.amount} > 0 and scale(${table.amount}) <= 2`),
  ],
);

export const atriumSpendingDocuments = pgTable(
  "atrium_spending_documents",
  {
    companyId: text("company_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    journalId: text("journal_id").notNull(),
    documentDate: date("document_date", { mode: "string" }).notNull(),
    spendingType: text("spending_type").notNull(),
    vendorOrEmployee: text("vendor_or_employee").notNull(),
    departmentCode: text("department_code").notNull(),
    accountCode: text("account_code").notNull(),
    amount: numeric("amount").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.transactionId] }),
    unique("atrium_spending_documents_journal_key").on(table.companyId, table.journalId),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "atrium_spending_documents_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.journalId],
      foreignColumns: [atriumDraftJournals.companyId, atriumDraftJournals.journalId],
      name: "atrium_spending_documents_journal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.accountCode],
      foreignColumns: [financeChartAccounts.companyId, financeChartAccounts.accountCode],
      name: "atrium_spending_documents_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentCode],
      foreignColumns: [financeOperatingDepartments.companyId, financeOperatingDepartments.departmentCode],
      name: "atrium_spending_documents_department_fk",
    }).onDelete("restrict"),
    check("atrium_spending_documents_id_check", sql`${table.transactionId} ~ '^spd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
    check("atrium_spending_documents_type_check", sql`${table.spendingType} in ('Procurement', 'Payroll', 'Other')`),
    check("atrium_spending_documents_vendor_check", sql`length(btrim(${table.vendorOrEmployee})) between 1 and 200`),
    check("atrium_spending_documents_description_check", sql`length(${table.description}) <= 500`),
    check("atrium_spending_documents_amount_check", sql`${table.amount} > 0 and scale(${table.amount}) <= 2`),
  ],
);

export const financePeriods = pgTable(
  "finance_periods",
  {
    companyId: text("company_id").notNull(),
    periodKey: text("period_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.periodKey] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_periods_company_fk",
    }).onDelete("restrict"),
    check("finance_periods_key_check", sql`${table.periodKey} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

export const financeAccounts = pgTable(
  "finance_accounts",
  {
    companyId: text("company_id").notNull(),
    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    active: text("active").notNull().default("Y"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.accountCode] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_accounts_company_fk",
    }).onDelete("restrict"),
    check("finance_accounts_code_check", sql`length(btrim(${table.accountCode})) > 0`),
    check("finance_accounts_active_check", sql`${table.active} in ('Y', 'N')`),
  ],
);

export const financeJournals = pgTable(
  "finance_journals",
  {
    companyId: text("company_id").notNull(),
    id: text("id").notNull(),
    periodKey: text("period_key").notNull(),
    memo: text("memo").notNull().default(""),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.id] }),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "finance_journals_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "finance_journals_created_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.periodKey],
      foreignColumns: [financePeriods.companyId, financePeriods.periodKey],
      name: "finance_journals_period_fk",
    }).onDelete("restrict"),
    check("finance_journals_status_check", sql`${table.status} = 'draft'`),
  ],
);

export const financeJournalLines = pgTable(
  "finance_journal_lines",
  {
    companyId: text("company_id").notNull(),
    journalId: text("journal_id").notNull(),
    lineNo: integer("line_no").notNull(),
    accountCode: text("account_code").notNull(),
    debit: numeric("debit", { precision: 20, scale: 4 }).notNull(),
    credit: numeric("credit", { precision: 20, scale: 4 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.journalId, table.lineNo] }),
    foreignKey({
      columns: [table.companyId, table.journalId],
      foreignColumns: [financeJournals.companyId, financeJournals.id],
      name: "finance_journal_lines_journal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.accountCode],
      foreignColumns: [financeAccounts.companyId, financeAccounts.accountCode],
      name: "finance_journal_lines_account_fk",
    }).onDelete("restrict"),
    check(
      "finance_journal_lines_sides_check",
      sql`${table.debit} >= 0 and ${table.credit} >= 0 and ((${table.debit} = 0 and ${table.credit} > 0) or (${table.credit} = 0 and ${table.debit} > 0))`,
    ),
  ],
);

export const orgPeople = pgTable(
  "org_people",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    employmentStatus: text("employment_status").notNull(),
    isDemo: boolean("is_demo").notNull(),
    linkedUserId: uuid("linked_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.linkedUserId],
      foreignColumns: [users.id],
      name: "org_people_linked_user_fk",
    }).onDelete("set null"),
    check("org_people_demo_check", sql`${table.isDemo} = true and ${table.id} ~ '^demo-[a-z0-9-]{1,48}$'`),
    check("org_people_status_check", sql`${table.employmentStatus} in ('active', 'leave', 'inactive')`),
    check("org_people_name_check", sql`length(btrim(${table.displayName})) between 1 and 120`),
  ],
);

export const orgPositions = pgTable(
  "org_positions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id").notNull(),
    title: text("title").notNull(),
    isDemo: boolean("is_demo").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "org_positions_department_fk",
    }).onDelete("restrict"),
    check("org_positions_demo_check", sql`${table.isDemo} = true and ${table.id} ~ '^demo-pos-[a-z0-9-]{1,40}$'`),
    check("org_positions_title_check", sql`length(btrim(${table.title})) between 1 and 120`),
  ],
);

export const orgAssignments = pgTable(
  "org_assignments",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    positionId: text("position_id").notNull(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id").notNull(),
    managerPersonId: text("manager_person_id"),
    isDemo: boolean("is_demo").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.personId],
      foreignColumns: [orgPeople.id],
      name: "org_assignments_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.positionId],
      foreignColumns: [orgPositions.id],
      name: "org_assignments_position_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "org_assignments_department_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.managerPersonId],
      foreignColumns: [orgPeople.id],
      name: "org_assignments_manager_fk",
    }).onDelete("restrict"),
    unique("org_assignments_person_company").on(table.personId, table.companyId),
    check("org_assignments_demo_check", sql`${table.isDemo} = true and ${table.id} ~ '^demo-asg-[a-z0-9-]{1,40}$'`),
  ],
);

export const orgTasks = pgTable(
  "org_tasks",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: text("priority").notNull(),
    dueOn: date("due_on").notNull(),
    completionCriteria: text("completion_criteria").notNull(),
    reviewRequired: boolean("review_required").notNull(),
    status: text("status").notNull(),
    assigneePersonId: text("assignee_person_id"),
    teamDepartmentId: text("team_department_id"),
    evidenceUrl: text("evidence_url"),
    createdByUserId: uuid("created_by_user_id"),
    submittedByUserId: uuid("submitted_by_user_id"),
    isDemo: boolean("is_demo").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "org_tasks_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.assigneePersonId],
      foreignColumns: [orgPeople.id],
      name: "org_tasks_assignee_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "org_tasks_created_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.submittedByUserId],
      foreignColumns: [users.id],
      name: "org_tasks_submitted_by_fk",
    }).onDelete("restrict"),
    index("org_tasks_company_status").on(table.companyId, table.status),
    check("org_tasks_demo_check", sql`${table.isDemo} = true and ${table.id} ~ '^demo-task-[a-z0-9-]{1,40}$'`),
    check("org_tasks_priority_check", sql`${table.priority} in ('low', 'normal', 'high')`),
    check("org_tasks_status_check", sql`${table.status} in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED')`),
    check("org_tasks_assignment_check", sql`${table.assigneePersonId} is not null or ${table.teamDepartmentId} is not null`),
    check("org_tasks_title_check", sql`length(btrim(${table.title})) between 1 and 160`),
    check("org_tasks_evidence_check", sql`${table.evidenceUrl} is null or ${table.evidenceUrl} ~ '^https://.{1,280}$'`),
  ],
);

export const orgTaskEvents = pgTable(
  "org_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorSource: text("actor_source").notNull(),
    previousStatus: text("previous_status"),
    nextStatus: text("next_status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [orgTasks.id],
      name: "org_task_events_task_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "org_task_events_actor_fk",
    }).onDelete("restrict"),
    index("org_task_events_task_created").on(table.taskId, table.createdAt),
    check("org_task_events_actor_check", sql`(${table.actorSource} = 'user' and ${table.actorUserId} is not null) or (${table.actorSource} = 'demo-seed' and ${table.actorUserId} is null)`),
    check("org_task_events_status_check", sql`${table.nextStatus} in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED')`),
  ],
);

const accessCapabilityIds = [
  "membership.company.staff",
  "membership.company.administrator",
  "membership.company.owner",
  "membership.department.finance.staff",
  "membership.department.finance.administrator",
  "membership.department.hr.staff",
  "membership.department.hr.administrator",
  "membership.department.content.staff",
  "membership.department.content.administrator",
  "membership.department.procurement.staff",
  "membership.department.procurement.administrator",
  "grant.owner_private",
  "grant.approve.company",
  "grant.approve.owner_private",
  "grant.approve.department.finance",
  "grant.approve.department.hr",
  "grant.approve.department.content",
  "grant.approve.department.procurement",
] as const;

const accessCapabilityCheck = sql.raw(
  `capability_id in (${accessCapabilityIds.map((id) => `'${id}'`).join(", ")})`,
);

export const accessRoles = pgTable(
  "access_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "access_roles_created_by_fk",
    }).onDelete("restrict"),
    uniqueIndex("access_roles_active_name").on(sql`lower(${table.name})`).where(sql`${table.status} = 'active'`),
    check("access_roles_status_check", sql`${table.status} in ('active', 'inactive')`),
    check("access_roles_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
  ],
);

export const accessRoleCapabilities = pgTable(
  "access_role_capabilities",
  {
    roleId: uuid("role_id").notNull(),
    capabilityId: text("capability_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.capabilityId] }),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [accessRoles.id],
      name: "access_role_capabilities_role_fk",
    }).onDelete("restrict"),
    check("access_role_capabilities_id_check", accessCapabilityCheck),
  ],
);

export const accessPositions = pgTable(
  "access_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    reportsToId: uuid("reports_to_id"),
    suggestedRoleId: uuid("suggested_role_id"),
    status: text("status").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "access_positions_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "access_positions_department_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.reportsToId],
      foreignColumns: [table.id],
      name: "access_positions_reports_to_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.suggestedRoleId],
      foreignColumns: [accessRoles.id],
      name: "access_positions_role_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "access_positions_created_by_fk",
    }).onDelete("restrict"),
    uniqueIndex("access_positions_active_name")
      .on(table.companyId, sql`lower(${table.name})`)
      .where(sql`${table.status} = 'active'`),
    check("access_positions_status_check", sql`${table.status} in ('active', 'inactive')`),
    check("access_positions_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
  ],
);

export const accessPositionHolders = pgTable(
  "access_position_holders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id").notNull(),
    userId: uuid("user_id").notNull(),
    status: text("status").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.positionId],
      foreignColumns: [accessPositions.id],
      name: "access_position_holders_position_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "access_position_holders_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "access_position_holders_created_by_fk",
    }).onDelete("restrict"),
    uniqueIndex("access_position_holders_once").on(table.positionId, table.userId),
    check("access_position_holders_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const accessPolicyVersions = pgTable(
  "access_policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    basedOnVersionId: uuid("based_on_version_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "access_policy_versions_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "access_policy_versions_created_by_fk",
    }).onDelete("restrict"),
    unique("access_policy_versions_number").on(table.companyId, table.versionNumber),
    uniqueIndex("access_policy_one_draft").on(table.companyId).where(sql`${table.status} = 'draft'`),
    uniqueIndex("access_policy_one_published").on(table.companyId).where(sql`${table.status} = 'published'`),
    check("access_policy_versions_status_check", sql`${table.status} in ('draft', 'published', 'superseded')`),
    check("access_policy_versions_reason_check", sql`length(btrim(${table.reason})) between 1 and 400`),
  ],
);

export const accessPolicyAssignments = pgTable(
  "access_policy_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull(),
    userId: uuid("user_id").notNull(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id"),
    roleId: uuid("role_id"),
    kind: text("kind").notNull(),
    effect: text("effect").notNull(),
    capabilityId: text("capability_id"),
    justification: text("justification"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [table.versionId],
      foreignColumns: [accessPolicyVersions.id],
      name: "access_policy_assignments_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "access_policy_assignments_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "access_policy_assignments_company_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
      name: "access_policy_assignments_department_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [accessRoles.id],
      name: "access_policy_assignments_role_fk",
    }).onDelete("restrict"),
    uniqueIndex("access_policy_assignment_user")
      .on(table.versionId, table.userId)
      .where(sql`${table.kind} = 'assignment'`),
    uniqueIndex("access_policy_exception_once")
      .on(table.versionId, table.userId, table.capabilityId)
      .where(sql`${table.kind} = 'exception'`),
    check("access_policy_assignments_kind_check", sql`${table.kind} in ('assignment', 'exception')`),
    check("access_policy_assignments_effect_check", sql`${table.effect} in ('allow', 'deny')`),
  ],
);

export const accessPolicySnapshots = pgTable(
  "access_policy_snapshots",
  {
    versionId: uuid("version_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    userId: uuid("user_id").notNull(),
    companyId: text("company_id").notNull(),
    departmentId: text("department_id"),
    capabilityId: text("capability_id").notNull(),
    effect: text("effect").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.assignmentId, table.capabilityId] }),
    foreignKey({
      columns: [table.versionId],
      foreignColumns: [accessPolicyVersions.id],
      name: "access_policy_snapshots_version_fk",
    }).onDelete("restrict"),
    check("access_policy_snapshots_effect_check", sql`${table.effect} in ('allow', 'deny')`),
    check("access_policy_snapshots_capability_check", accessCapabilityCheck),
  ],
);

export const accessPolicyChanges = pgTable(
  "access_policy_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull(),
    userId: uuid("user_id").notNull(),
    companyId: text("company_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    changeKind: text("change_kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.versionId],
      foreignColumns: [accessPolicyVersions.id],
      name: "access_policy_changes_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "access_policy_changes_user_fk",
    }).onDelete("restrict"),
    index("access_policy_changes_version").on(table.versionId),
    check("access_policy_changes_kind_check", sql`${table.changeKind} in ('granted', 'revoked')`),
    check("access_policy_changes_capability_check", accessCapabilityCheck),
  ],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    companyId: text("company_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "ai_conversations_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: "ai_conversations_company_fk",
    }).onDelete("restrict"),
    index("ai_conversations_user_updated").on(table.userId, table.updatedAt),
    check("ai_conversations_title_check", sql`length(btrim(${table.title})) between 1 and 120`),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolName: text("tool_name"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId],
      foreignColumns: [aiConversations.id],
      name: "ai_messages_conversation_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "ai_messages_user_fk",
    }).onDelete("cascade"),
    index("ai_messages_conversation_created").on(table.conversationId, table.createdAt),
    check("ai_messages_role_check", sql`${table.role} in ('user', 'assistant', 'tool')`),
    check("ai_messages_content_check", sql`length(${table.content}) between 1 and 20000`),
    check(
      "ai_messages_tool_check",
      sql`(
        (${table.role} = 'tool' and ${table.toolName} is not null and length(${table.toolName}) between 1 and 80)
        or (${table.role} <> 'tool' and ${table.toolName} is null)
      )`,
    ),
  ],
);

export const aiProviderSettings = pgTable(
  "ai_provider_settings",
  {
    id: text("id").primaryKey(),
    model: text("model").notNull(),
    apiKey: text("api_key"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_provider_settings_id_check", sql`${table.id} = 'grok'`),
    check("ai_provider_settings_model_check", sql`${table.model} ~ '^grok-[a-z0-9][a-z0-9.-]{0,40}$'`),
    check("ai_provider_settings_key_check", sql`${table.apiKey} is null or length(${table.apiKey}) between 20 and 300`),
  ],
);

export const aiRequests = pgTable(
  "ai_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "ai_requests_user_fk",
    }).onDelete("cascade"),
    index("ai_requests_user_created").on(table.userId, table.createdAt),
  ],
);
