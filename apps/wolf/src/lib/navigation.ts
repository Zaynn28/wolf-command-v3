export type NavItem = {
  href: string;
  label: string;
  description: string;
};

export const navigation = [
  {
    href: "/",
    label: "Overview",
    description: "Server-checked home. No company records are stored.",
  },
  {
    href: "/finance",
    label: "Finance",
    description: "One Finance application. Each company has its own records and enabled modules.",
  },
  {
    href: "/hr",
    label: "HR",
    description: "Server-checked HR module. No people records are stored.",
  },
  {
    href: "/organization",
    label: "Organization",
    description: "Demo family tree and owner task center. Synthetic people are labeled Demo.",
  },
  {
    href: "/assistant",
    label: "Assistant",
    description: "Company-scoped assistant for organization records this account can already read.",
  },
  {
    href: "/academy",
    label: "Academy",
    description: "Server-checked academy module. No training records are stored.",
  },
  {
    href: "/content-machine",
    label: "Content Machine",
    description: "Server-checked content module. No drafts are stored.",
  },
  {
    href: "/owner-private",
    label: "Owner Private",
    description: "Server-checked page. No private records are stored.",
  },
  {
    href: "/access",
    label: "Access",
    description: "Positions, roles, access policies, and the company operating structure.",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Your own profile and Wolf password.",
  },
  {
    href: "/admin/companies",
    label: "Companies",
    description: "Operator-only company setup. Not public registration.",
  },
] as const satisfies readonly NavItem[];

export type AppHref = (typeof navigation)[number]["href"];

const moduleHrefs = [
  "/finance",
  "/hr",
  "/academy",
  "/content-machine",
] as const satisfies readonly AppHref[];

export type ModuleHref = (typeof moduleHrefs)[number];

export const modules = navigation.filter(
  (item): item is Extract<(typeof navigation)[number], { href: ModuleHref }> =>
    (moduleHrefs as readonly string[]).includes(item.href),
);

export function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
