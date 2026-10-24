import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { readAuthConfig } from "@/server/auth/config";
import { sessionCookieName } from "@/server/auth/constants";
import { getDb } from "@/server/db/runtime";
import { serveOrganization, type OrganizationRequest } from "@/server/organization/handler";

export async function organizationResponse(request: OrganizationRequest): Promise<Response> {
  await connection();
  const token = (await cookies()).get(sessionCookieName)?.value ?? null;
  const config = readAuthConfig(process.env);
  if (!config) return Response.json({ error: "Organization is unavailable." }, { status: 503 });
  try {
    const result = await serveOrganization(getDb(config.databaseUrl), token, new Date(), request);
    return Response.json(result.body, { status: result.status });
  } catch {
    return Response.json({ error: "Organization is unavailable." }, { status: 503 });
  }
}
