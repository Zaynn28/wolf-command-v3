import { organizationResponse } from "../respond";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "progress") {
    const companyId = url.searchParams.get("companyId");
    return organizationResponse({
      kind: "progress",
      companyId: companyId && companyId.trim() !== "" ? companyId : null,
      today: url.searchParams.get("today") ?? new Date().toISOString().slice(0, 10),
    });
  }
  const scope = url.searchParams.get("scope");
  return organizationResponse({
    kind: "tasks",
    companyId: url.searchParams.get("companyId"),
    from: url.searchParams.get("from") ?? "2026-10-01",
    to: url.searchParams.get("to") ?? "2026-10-31",
    today: url.searchParams.get("today") ?? new Date().toISOString().slice(0, 10),
    scope: scope === "owner" || scope === "company" || scope === "assigned" ? scope : "assigned",
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return organizationResponse({ kind: "create", body });
  } catch {
    return Response.json({ error: "The task fields are not valid." }, { status: 400 });
  }
}
