import { Suspense } from "react";
import { AccessPanel } from "@/components/access-panel";

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Checking access…</p>}>
      <AccessPanel
        module="settings"
        searchParams={searchParams}
        title="Settings"
        description="Your own profile."
        emptyTitle="No records"
        emptyBody="No records are stored."
      />
    </Suspense>
  );
}
