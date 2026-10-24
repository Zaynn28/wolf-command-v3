import { connection } from "next/server";
import { PasswordForm } from "@/components/password-form";
import { PageHeader } from "@/components/page-header";
import { readSignedInAccount } from "@/server/auth/current-session";

export async function PasswordPanel() {
  await connection();
  const account = await readSignedInAccount();

  if (!account) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Wolf password"
          title="Change password"
          description="Sign in before changing the Wolf password. Password recovery is an administrator process and does not send email."
        />
        <p className="text-sm text-muted">
          <a href="/login" className="text-foreground underline decoration-line underline-offset-4">
            Go to sign in
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Wolf password"
        title="Change password"
        description={
          account.mustChangePassword
            ? `Replace the temporary Wolf password for ${account.email} before the account can continue. Other sessions are signed out after the change.`
            : `Change the Wolf password for ${account.email}. Other sessions are signed out after the change.`
        }
      />
      <PasswordForm />
    </div>
  );
}
