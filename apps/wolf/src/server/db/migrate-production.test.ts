import assert from "node:assert/strict";
import { test } from "node:test";
import { runProductionMigrationCommand } from "./migrate-production";

const secret = "production-migrate-secret";
const socket = "/cloudsql/wolf-intel-jakarta:asia-southeast2:wolf-command";
const socketUrl = `postgresql://wolf:${secret}@${encodeURIComponent(socket)}/wolf_command`;

test("production migration stays closed unless production mode and the opt-in are both set", async () => {
  let opened = false;
  const reports: string[] = [];
  const refused = await runProductionMigrationCommand(
    { NODE_ENV: "production", DATABASE_URL: socketUrl },
    () => {
      opened = true;
      throw new Error("opened");
    },
    (message) => reports.push(message),
  );
  assert.equal(refused, 1);
  assert.equal(opened, false);
  assert.deepEqual(reports, ["Refusing database command. Production migration is not enabled."]);
  assert.equal(reports.join("\n").includes(secret), false);
});

test("production migration accepts a Cloud SQL socket and does not report the URL", async () => {
  const reports: string[] = [];
  let seen = "";
  const code = await runProductionMigrationCommand(
    { NODE_ENV: "production", WOLF_ALLOW_PRODUCTION_MIGRATE: "1", DATABASE_URL: socketUrl },
    (databaseUrl) => {
      seen = databaseUrl;
      return {
        async begin() {},
        async end() {},
      };
    },
    (message) => reports.push(message),
  );
  assert.equal(code, 0);
  assert.equal(seen, socketUrl);
  assert.deepEqual(reports, []);
});
