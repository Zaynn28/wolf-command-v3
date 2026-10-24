import { serveHrRuntime } from "@/server/hr/runtime-proxy";

type RouteContext = { params: Promise<{ companyId: string; path?: string[] }> };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const { companyId, path } = await context.params;
  return serveHrRuntime(request, companyId, path?.join("/") ?? "", `/hr/${companyId}/runtime`);
}

export function OPTIONS() {
  return Response.json({ error: "HR is not available for this session." }, { status: 403 });
}

export function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
