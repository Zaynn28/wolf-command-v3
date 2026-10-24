import { Suspense } from "react";
import { AccessPanel } from "@/components/access-panel";

export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessPanel
        module="overview"
        searchParams={searchParams}
        title="Overview"
        description="Server-checked home."
        emptyTitle="No records"
        emptyBody="No company records are stored."
      />
    </Suspense>
  );
}
