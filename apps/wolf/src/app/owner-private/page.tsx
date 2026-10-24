import { Suspense } from "react";
import { AccessPanel } from "@/components/access-panel";

export default function OwnerPrivatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessPanel
        module="owner_private"
        searchParams={searchParams}
        title="Owner Private"
        description="This page requires an explicit Owner Private grant. No private records are stored."
        emptyTitle="No private records"
        emptyBody="No private records are stored."
      />
    </Suspense>
  );
}
