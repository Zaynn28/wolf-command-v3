/**
 * Local development accounts only.
 * These Wolf passwords are not email-provider passwords and are not for production.
 * The seed script refuses NODE_ENV=production and any target other than 127.0.0.1:5433/wolf_command.
 */

export const devAccounts = [
  {
    email: "staff.dev@wolf-command.test",
    password: "local-wolf-staff-password",
    role: "staff",
    companyId: "dev-company",
    departmentId: "dev-finance",
    ownerPrivate: false,
  },
  {
    email: "admin.dev@wolf-command.test",
    password: "local-wolf-admin-password",
    role: "administrator",
    companyId: "dev-company",
    departmentId: null,
    ownerPrivate: false,
  },
  {
    email: "owner-grant.dev@wolf-command.test",
    password: "local-wolf-owner-password",
    role: "owner",
    companyId: "dev-company",
    departmentId: null,
    ownerPrivate: true,
  },
] as const;
