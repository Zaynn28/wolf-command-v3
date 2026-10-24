import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPanel } from "./login-panel";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in with an email address and the Wolf password for a provisioned account.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading sign in…</p>}>
      <LoginPanel />
    </Suspense>
  );
}
