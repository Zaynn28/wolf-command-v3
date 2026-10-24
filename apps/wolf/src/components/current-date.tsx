import { connection } from "next/server";
import { Suspense } from "react";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

async function Today() {
  await connection();
  const now = new Date();

  return (
    <time dateTime={now.toISOString().slice(0, 10)}>{dateFormat.format(now)}</time>
  );
}

export function CurrentDate({ className = "mt-2 min-h-6 text-sm text-muted" }: { className?: string }) {
  return (
    <p className={className}>
      <Suspense fallback="Loading date…">
        <Today />
      </Suspense>
    </p>
  );
}
