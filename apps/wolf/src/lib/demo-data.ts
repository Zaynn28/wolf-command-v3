import type { ModuleHref } from "@/lib/navigation";

export type DemoWorkItem = {
  id: string;
  title: string;
  module: string;
  note: string;
};

export type ConnectionCheck = {
  id: string;
  name: string;
  detail: string;
  state: "not-connected";
};

export type UnavailableSetting = {
  id: string;
  name: string;
  value: string;
  note: string;
};

export const demoWorkQueue: readonly DemoWorkItem[] = [
  {
    id: "demo-finance-review",
    title: "Sample invoice review",
    module: "Finance",
    note: "Illustrative task. No invoice exists.",
  },
  {
    id: "demo-hr-onboarding",
    title: "Sample onboarding checklist",
    module: "HR",
    note: "Illustrative task. No employee exists.",
  },
  {
    id: "demo-academy-outline",
    title: "Sample lesson outline",
    module: "Academy",
    note: "Illustrative task. No course exists.",
  },
  {
    id: "demo-content-draft",
    title: "Sample content draft",
    module: "Content Machine",
    note: "Illustrative task. No draft exists.",
  },
];

export const connectionChecks: readonly ConnectionCheck[] = [
  {
    id: "finance",
    name: "Finance integration",
    detail: "Local draft journals can be stored. Posting and external ledgers are not connected.",
    state: "not-connected",
  },
  {
    id: "hr",
    name: "HR records",
    detail: "No people system is linked.",
    state: "not-connected",
  },
  {
    id: "academy",
    name: "Academy content",
    detail: "No training source is linked.",
    state: "not-connected",
  },
  {
    id: "content",
    name: "Content publishing",
    detail: "No publishing channel is linked.",
    state: "not-connected",
  },
];

export const moduleConnectionNotes: Record<ModuleHref, string> = {
  "/finance": "No ledger, balance, or invoice source is linked.",
  "/hr": "No employee or staffing source is linked.",
  "/academy": "No course or enrolment source is linked.",
  "/content-machine": "No draft or publishing source is linked.",
};

export const unavailableSettings: readonly UnavailableSetting[] = [
  {
    id: "display",
    name: "Display",
    value: "Dark graphite",
    note: "Fixed in this shell. No preference is stored.",
  },
  {
    id: "notifications",
    name: "Notifications",
    value: "Not connected",
    note: "No notification service is linked.",
  },
  {
    id: "integrations",
    name: "Integrations",
    value: "Not connected",
    note: "No external accounts are linked.",
  },
];
