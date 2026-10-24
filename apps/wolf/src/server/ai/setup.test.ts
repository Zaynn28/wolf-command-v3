import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "@wolf/shared";
import { auditEvents, platformOperators, users } from "../db/schema";
import { withDb } from "../test/harness";
import { clearAssistantSetup, openAssistantProvider, readAssistantSetup, saveAssistantSetup } from "./setup";

const now = new Date("2030-01-15T00:00:00.000Z");
const portalKey = "xai-portal-key-000000000001";
const environmentKey = "xai-environment-key-00000001";

test("an operator configures the assistant from the portal without exposing the key", async () => {
  await withDb(async (db) => {
    const operator = await addUser(db, "assistant-operator@wolf-command.test", true);
    const staff = await addUser(db, "assistant-staff@wolf-command.test", false);
    const empty = await readAssistantSetup(db, operator.actor, {});
    assert.equal(empty.ready, false);
    assert.equal(empty.source, "none");
    assert.equal(empty.canConfigure, true);
    assert.equal(JSON.stringify(empty).includes("xai-"), false);

    assert.equal((await saveAssistantSetup(db, staff.actor, { model: "grok-4", apiKey: portalKey }, {}, now)).status, "denied");
    assert.equal((await readAssistantSetup(db, operator.actor, {})).source, "none");
    const denied = await db.select().from(auditEvents);
    assert.equal(denied.some((event) => event.eventType === "authorization_denied"), true);
    assert.equal(JSON.stringify(denied).includes(portalKey), false);

    assert.equal((await saveAssistantSetup(db, operator.actor, { model: "not-a-model", apiKey: portalKey }, {}, now)).status, "invalid");
    assert.equal((await saveAssistantSetup(db, operator.actor, { model: "grok-4", apiKey: "short key" }, {}, now)).status, "invalid");
    assert.equal((await saveAssistantSetup(db, operator.actor, { model: "grok-4", apiKey: portalKey }, {}, now)).status, "ok");
    const saved = await readAssistantSetup(db, operator.actor, { XAI_API_KEY: environmentKey });
    assert.equal(saved.ready, true);
    assert.equal(saved.source, "portal");
    assert.equal(saved.model, "grok-4");
    assert.equal(JSON.stringify(saved).includes(portalKey), false);

    let seen = "";
    const provider = await openAssistantProvider(db, { XAI_API_KEY: environmentKey }, async (_url, init) => {
      seen = String((init?.headers as { authorization?: string } | undefined)?.authorization ?? "");
      const body = JSON.parse(String(init?.body)) as { model?: string };
      assert.equal(body.model, "grok-4");
      return new Response(JSON.stringify({ choices: [{ message: { content: `ok ${portalKey}` } }] }), { status: 200 });
    });
    assert.equal(provider.availability().state, "ready");
    const completion = await provider.complete({ messages: [], tools: [] }, new AbortController().signal);
    assert.equal(seen, `Bearer ${portalKey}`);
    assert.equal(completion.text.includes(portalKey), false);
    assert.match(completion.text, /\[redacted\]/);

    assert.equal((await saveAssistantSetup(db, operator.actor, { model: "grok-3", apiKey: "" }, {}, now)).status, "ok");
    const renamed = await openAssistantProvider(db, {}, async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      assert.equal(body.model, "grok-3");
      return new Response(JSON.stringify({ choices: [{ message: { content: "kept" } }] }), { status: 200 });
    });
    await renamed.complete({ messages: [], tools: [] }, new AbortController().signal);

    assert.equal((await clearAssistantSetup(db, staff.actor, now)).status, "denied");
    assert.equal((await clearAssistantSetup(db, operator.actor, now)).status, "ok");
    const cleared = await readAssistantSetup(db, operator.actor, { XAI_API_KEY: environmentKey });
    assert.equal(cleared.source, "environment");
    assert.equal(cleared.ready, true);
    const fallback = await openAssistantProvider(db, { XAI_API_KEY: environmentKey }, async (_url, init) => {
      seen = String((init?.headers as { authorization?: string } | undefined)?.authorization ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "env" } }] }), { status: 200 });
    });
    await fallback.complete({ messages: [], tools: [] }, new AbortController().signal);
    assert.equal(seen, `Bearer ${environmentKey}`);
  });
});

async function addUser(db: Parameters<Parameters<typeof withDb>[0]>[0], email: string, operator: boolean) {
  const user = (await db.insert(users).values({ emailNormalized: email, status: "active" }).returning())[0];
  if (!user) throw new Error("missing user");
  if (operator) await db.insert(platformOperators).values({ userId: user.id, createdAt: now });
  const actor: Actor = { userId: user.id, memberships: [], grants: [] };
  return { actor };
}
