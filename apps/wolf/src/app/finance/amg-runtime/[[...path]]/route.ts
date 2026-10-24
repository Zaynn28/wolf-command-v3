import { serveFinanceRuntime } from "@/server/finance/runtime-proxy";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const path = (await context.params).path?.join("/") ?? "";
  return serveFinanceRuntime(request, "amg", path, "/finance/amg-runtime");
}

export function OPTIONS() {
  return Response.json({ error: "Finance is not available for this session." }, { status: 403 });
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
