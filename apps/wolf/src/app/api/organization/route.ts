import { organizationResponse } from "./respond";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return organizationResponse({
    kind: "tree",
    companyId: url.searchParams.get("companyId"),
    query: url.searchParams.get("q") ?? "",
  });
}
