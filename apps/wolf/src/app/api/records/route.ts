import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { readAuthConfig } from "@/server/auth/config";
import { sessionCookieName } from "@/server/auth/constants";
import { handleRecordsRequest } from "@/server/access/records-request";
import type { ModuleQuery } from "@/server/access/open-module";
import { getDb } from "@/server/db/runtime";

export async function GET(request: Request) {
  return handle(request, "read");
}

export async function POST(request: Request) {
  return handle(request, null);
}

async function handle(request: Request, fallbackAction: string | null) {
  await connection();
  const token = (await cookies()).get(sessionCookieName)?.value ?? null;
  if (!token) return Response.json({ state: "signed_out" }, { status: 401 });
  const config = readAuthConfig(process.env);
  if (!config) return Response.json({ state: "unavailable" }, { status: 503 });
  let body: Record<string, unknown> = {};
  if (fallbackAction === null) {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ state: "validation", reason: "body" }, { status: 400 });
    }
  }
  const url = new URL(request.url);
  const query: ModuleQuery = {
    companyId: url.searchParams.get("companyId") ?? stringValue(body.companyId),
    departmentId: url.searchParams.get("departmentId") ?? stringValue(body.departmentId),
    userId: url.searchParams.get("userId") ?? stringValue(body.userId),
    role: url.searchParams.get("role") ?? stringValue(body.role),
    grant: url.searchParams.get("grant") ?? stringValue(body.grant),
  };
  try {
    const result = await handleRecordsRequest(
      getDb(config.databaseUrl),
      token,
      new Date(),
      {
        module: url.searchParams.get("module") ?? stringValue(body.module),
        action: url.searchParams.get("action") ?? (fallbackAction === null ? stringValue(body.action) : fallbackAction) ?? "read",
        query,
      },
    );
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ state: "unavailable" }, { status: 503 });
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
