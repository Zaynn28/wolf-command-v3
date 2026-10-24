"use client";

export default function AppError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <section
      role="alert"
      className="rounded-lg border border-line bg-surface px-4 py-8"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        This page could not be shown
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
        The shell hit an unexpected error while rendering this destination.
        Data sources are still not connected.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium text-foreground"
      >
        Try again
      </button>
    </section>
  );
}
