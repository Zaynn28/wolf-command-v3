import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemaDirectory = dirname(fileURLToPath(import.meta.url));

export function statementsFrom(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    const dollar = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      const next = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(index, next);
      index = next;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    const quote = sql[index];
    if (quote === "'" || quote === "\"") {
      let next = index + 1;
      while (next < sql.length) {
        if (sql[next] === quote && sql[next + 1] === quote) {
          next += 2;
          continue;
        }
        next += 1;
        if (sql[next - 1] === quote) break;
      }
      current += sql.slice(index, next);
      index = next;
      continue;
    }

    if (sql[index] === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      index += 1;
      continue;
    }

    current += sql[index];
    index += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function migrationFiles(): string[] {
  return readdirSync(join(schemaDirectory, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function schemaStatements(): string[] {
  const historical = readFileSync(join(schemaDirectory, "schema.sql"), "utf8");
  const forward = migrationFiles().map((file) => readFileSync(join(schemaDirectory, "migrations", file), "utf8"));
  return [historical, ...forward].flatMap((sql) => statementsFrom(sql));
}

export async function applySchemaSql(execute: (statement: string) => Promise<unknown>): Promise<void> {
  for (const statement of schemaStatements()) {
    await execute(statement);
  }
}
