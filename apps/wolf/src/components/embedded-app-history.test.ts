import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canGoBack,
  canGoForward,
  emptyVisits,
  isInAppUrl,
  moveBack,
  moveForward,
  recordVisit,
  replaceLatestVisit,
  type EmbeddedHistoryView,
} from "./embedded-app-history";

const command: EmbeddedHistoryView = { key: "finance:nav-pillar-command-centre:", finance: { pillarId: "nav-pillar-command-centre" } };
const operations: EmbeddedHistoryView = {
  key: "finance:nav-pillar-operations:Revenue Cycle (Sales & AR)",
  finance: { pillarId: "nav-pillar-operations", subLabel: "Revenue Cycle (Sales & AR)" },
};
const reports: EmbeddedHistoryView = {
  key: "finance:nav-pillar-reports:Balance Sheet & P&L",
  finance: { pillarId: "nav-pillar-reports", subLabel: "Balance Sheet & P&L" },
};

test("the opening view has nowhere to go back to", () => {
  const state = recordVisit(emptyVisits(), command, "settle");
  assert.equal(canGoBack(state), false);
  assert.equal(canGoForward(state), false);
  assert.equal(moveBack(state), state);
  assert.equal(moveForward(state), state);
});

test("a script settling the opening screen does not add a step", () => {
  const opened = recordVisit(emptyVisits(), command, "settle");
  const settled = recordVisit(opened, operations, "settle");
  assert.equal(settled.entries.length, 1);
  assert.equal(settled.index, 0);
  assert.equal(settled.entries[0]?.key, operations.key);
});

test("user moves can be revisited and a new move drops the forward stack", () => {
  let state = recordVisit(emptyVisits(), command, "settle");
  state = recordVisit(state, operations, "user");
  state = recordVisit(state, reports, "user");
  assert.equal(canGoBack(state), true);
  assert.equal(canGoForward(state), false);
  state = moveBack(state);
  assert.equal(state.entries[state.index]?.key, operations.key);
  assert.equal(canGoForward(state), true);
  state = moveForward(state);
  assert.equal(state.entries[state.index]?.key, reports.key);
  state = moveBack(state);
  state = recordVisit(state, command, "user");
  assert.equal(canGoForward(state), false);
  assert.deepEqual(state.entries.map((entry) => entry.key), [command.key, operations.key, command.key]);
});

test("repeating the current view does not add a step", () => {
  const opened = recordVisit(emptyVisits(), command, "settle");
  const repeated = recordVisit(opened, command, "user");
  assert.equal(repeated, opened);
});

test("a script follow-up replaces only the latest step", () => {
  let state = recordVisit(emptyVisits(), command, "settle");
  state = recordVisit(state, { key: "finance:nav-pillar-reports:USALI 12 Statements" }, "user");
  state = replaceLatestVisit(state, reports);
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[1]?.key, reports.key);
  assert.equal(canGoBack(state), true);
  assert.equal(canGoForward(state), false);
});

test("settling after the user has moved does not rewrite history", () => {
  let state = recordVisit(emptyVisits(), command, "settle");
  state = recordVisit(state, operations, "user");
  assert.equal(recordVisit(state, reports, "settle"), state);
});

test("in-app urls stay under the embedded runtime and do not return to the portal", () => {
  const frame = "http://localhost:3015/finance/amg/runtime/";
  assert.equal(isInAppUrl(frame, "http://localhost:3015/finance/amg/runtime/"), true);
  assert.equal(isInAppUrl(frame, "http://localhost:3015/finance/amg/runtime/src/main.tsx"), true);
  assert.equal(isInAppUrl(frame, "http://localhost:3015/"), false);
  assert.equal(isInAppUrl(frame, "http://localhost:3015/finance/bzg/runtime/"), false);
  assert.equal(isInAppUrl(frame, "http://127.0.0.1:3099/"), false);
});
