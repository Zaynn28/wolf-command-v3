export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <p className="text-sm font-medium text-muted">Loading page</p>
      <div className="h-8 w-48 rounded bg-raised" />
      <div className="h-4 w-full max-w-xl rounded bg-surface" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 rounded-lg border border-line bg-surface" />
        <div className="h-28 rounded-lg border border-line bg-surface" />
      </div>
    </div>
  );
}
