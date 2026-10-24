import type { Action } from "@wolf/shared";
import type { AuthDatabase } from "../db/types";
import { openModule, type ModuleQuery, type ModuleView, type OperationalRecord } from "./open-module";
import { isModuleId, type ModuleId } from "./matrix";

const actions = new Set<Action>(["read", "create", "update", "delete", "approve"]);

export type RecordsResponse = {
  status: number;
  body: {
    state: ModuleView["state"] | "validation";
    reason?: string;
    module?: ModuleId;
    companyId?: string | null;
    records?: OperationalRecord[];
    canAdminister?: boolean;
    persisted?: false;
  };
};

export async function handleRecordsRequest(
  db: AuthDatabase,
  token: string | null,
  now: Date,
  input: { module: string | null; action: string | null; query: ModuleQuery },
  source: readonly OperationalRecord[] = [],
): Promise<RecordsResponse> {
  if (!input.module || !isModuleId(input.module)) {
    return { status: 400, body: { state: "validation", reason: "module" } };
  }
  const action = input.action ?? "read";
  if (!actions.has(action as Action)) {
    return { status: 400, body: { state: "validation", reason: "action" } };
  }

  const opened = await openModule(db, token, now, input.module, action as Action, input.query, source);
  if (opened.state === "signed_out") return { status: 401, body: { state: "signed_out" } };
  if (opened.state === "password_change_required") {
    return { status: 403, body: { state: "password_change_required" } };
  }
  if (opened.state === "denied") {
    return { status: 403, body: { state: "denied", reason: opened.reason } };
  }
  return {
    status: 200,
    body: {
      state: "allowed",
      module: opened.module,
      companyId: opened.companyId,
      records: opened.records,
      canAdminister: opened.canAdminister,
      persisted: false,
    },
  };
}
