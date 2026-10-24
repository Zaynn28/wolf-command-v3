"use client";

export function Greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <h1 suppressHydrationWarning className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
      {part}, Wolf Command
    </h1>
  );
}
