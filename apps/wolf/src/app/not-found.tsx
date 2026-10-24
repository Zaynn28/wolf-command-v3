import Link from "next/link";

export default function NotFound() {
  return (
    <section className="max-w-xl">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        That destination is not part of this shell.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground"
      >
        Back to Overview
      </Link>
    </section>
  );
}
