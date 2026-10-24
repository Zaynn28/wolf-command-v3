import { Suspense, type ReactNode } from "react";
import { DesktopNav, MobileNav } from "@/components/primary-nav";
import { SessionMenu } from "@/components/session-menu";
import { ShellFrame } from "@/components/shell-frame";
import { TemporaryPasswordGate } from "@/components/temporary-password-gate";
import { navigation, type NavItem } from "@/lib/navigation";
import { grantedHrefs } from "@/server/access/navigation-access";
import { loadActorContext } from "@/server/access/session-actor";
import { isPlatformOperator } from "@/server/admin/companies";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading Wolf Command…</p>}>
      <GrantedShell>{children}</GrantedShell>
    </Suspense>
  );
}

async function GrantedShell({ children }: { children: ReactNode }) {
  const context = await loadActorContext();
  const hrefs = new Set(grantedHrefs(context.status === "ready" ? context.actor : null));
  if (context.status === "ready" && (await isPlatformOperator(context.db, context.actor.userId))) hrefs.add("/admin/companies");
  const items: NavItem[] = navigation.filter((item) => hrefs.has(item.href));
  return (
    <ShellFrame
      pages={items}
      navigation={
        <Suspense fallback={<p className="px-5 py-4 text-sm text-muted">Loading navigation…</p>}>
          <DesktopNav items={items} />
        </Suspense>
      }
      mobile={
        <Suspense fallback={<p className="border-b border-line px-4 py-3 text-sm text-muted">Menu</p>}>
          <MobileNav items={items} />
        </Suspense>
      }
      session={
        <Suspense fallback={<p className="text-sm text-muted">Checking session…</p>}>
          <SessionMenu layout="chip" primarySignOut />
        </Suspense>
      }
      financeSession={
        <Suspense fallback={<p className="text-sm text-muted">Checking session…</p>}>
          <SessionMenu layout="chip" primarySignOut />
        </Suspense>
      }
    >
      <Suspense fallback={<p className="text-sm text-muted">Checking session…</p>}>
        <TemporaryPasswordGate>{children}</TemporaryPasswordGate>
      </Suspense>
    </ShellFrame>
  );
}
