import { Suspense } from "react";
import { AccessPanel } from "@/components/access-panel";

export default function AcademyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessPanel
        module="academy"
        searchParams={searchParams}
        title="Academy"
        description="Training records are limited to companies where this account has a membership."
        emptyTitle="No training records"
        emptyBody="No training records are stored."
      />
    </Suspense>
  );
}
