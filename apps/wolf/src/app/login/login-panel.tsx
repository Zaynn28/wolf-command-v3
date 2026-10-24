import { connection } from "next/server";
import { LoginForm } from "@/components/login-form";
import { PageHeader } from "@/components/page-header";

export async function LoginPanel() {
  await connection();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Local sign in"
        title="Sign in"
        description="Sign in with the email address on your Wolf account and the password created for Wolf. This is not your email-provider password. Entering an address does not create an account."
      />
      <LoginForm />
    </div>
  );
}
