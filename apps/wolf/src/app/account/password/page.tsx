import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordPanel } from "./password-panel";

export const metadata: Metadata = {
  title: "Change password",
  description: "Change the Wolf password for the signed-in account.",
};

export default function PasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading password change…</p>}>
      <PasswordPanel />
    </Suspense>
  );
}
