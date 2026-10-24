import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

type ModulePageProps = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
};

export function ModulePage({
  title,
  description,
  emptyTitle,
  emptyBody,
}: ModulePageProps) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Not connected" title={title} description={description} />
      <EmptyState title={emptyTitle} body={emptyBody} />
    </div>
  );
}
