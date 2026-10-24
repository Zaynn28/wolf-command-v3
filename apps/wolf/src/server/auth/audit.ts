import { auditEvents } from "../db/schema";
import type { AuthDatabase } from "../db/types";

export const auditEventTypes = [
  "login_succeeded",
  "login_rejected",
  "login_rate_limited",
  "password_changed",
  "password_reset_by_admin",
  "account_provisioned",
  "session_created",
  "session_revoked",
  "authorization_allowed",
  "authorization_denied",
] as const;

export type AuditEventType = (typeof auditEventTypes)[number];

const blockedMetadataKey = /code|otp|token|pepper|password|secret|cookie|hash|body|payload|salary|private/i;
const blockedMetadataValue = /\$argon2|^[0-9a-f]{32,}$/i;

export function sanitizeAuditMetadata(
  metadata: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blockedMetadataKey.test(key)) {
      throw new Error("Refusing to store a credential in the audit log.");
    }
    if (typeof value === "string" && blockedMetadataValue.test(value)) {
      throw new Error("Refusing to store a credential in the audit log.");
    }
    clean[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return clean;
}

export async function writeAudit(
  db: AuthDatabase,
  event: {
    eventType: AuditEventType;
    userId: string | null;
    companyId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    emailFingerprint: string | null;
    ip: string | null;
    metadata: Record<string, string | number | boolean | null>;
    createdAt: Date;
  },
): Promise<void> {
  const resourceType = event.resourceType ?? null;
  const resourceId = event.resourceId ?? null;
  if ((resourceType === null) !== (resourceId === null)) {
    throw new Error("Audit resource type and identifier must be stored together.");
  }
  await db.insert(auditEvents).values({
    eventType: event.eventType,
    userId: event.userId,
    companyId: event.companyId ?? null,
    resourceType,
    resourceId,
    emailFingerprint: event.emailFingerprint,
    ip: event.ip,
    metadata: sanitizeAuditMetadata(event.metadata),
    createdAt: event.createdAt,
  });
}
