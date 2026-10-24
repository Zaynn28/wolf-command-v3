import { Suspense } from "react";
import { AccessPanel } from "@/components/access-panel";

export default function ContentMachinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessPanel
        module="content"
        searchParams={searchParams}
        title="Content Machine"
        description="Content records are limited to the signed-in account’s company and content department."
        emptyTitle="No drafts"
        emptyBody="No drafts are stored."
      />
    </Suspense>
  );
}
