"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { useMe } from "@/lib/use-me";

/** Three workspaces: the arranger's registry, the desk's exchange, and this institution's own book. */
export const WORKSPACES = [
  {
    key: "registry",
    label: "Loan registry",
    items: [
      { href: "/register", label: "Lender register" },
      { href: "/facility", label: "ATS configuration" },
      { href: "/assignments", label: "Assignments" },
      { href: "/lifecycle", label: "Interest" },
      { href: "/admin", label: "Administration" },
    ],
  },
  {
    key: "exchange",
    label: "Secondary exchange",
    items: [
      { href: "/overview", label: "Execution room" },
      { href: "/blotter", label: "RFQ trading" },
      { href: "/approvals", label: "Desk approvals" },
    ],
  },
  {
    key: "positions",
    label: "My positions",
    items: [{ href: "/portfolio", label: "Positions and accruals" }],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();
  const active = WORKSPACES.find((g) => g.items.some((n) => pathname.startsWith(n.href))) ?? WORKSPACES[1];
  return (
    <div className="app-root min-h-screen flex flex-col" data-workspace={active.key}>
      <header className="workspace-bar">
        <div className="brand-row">
          <Link href="/overview" aria-label="SyndicateLend home" className="brand">
            <Image src="/globe.png" alt="" width={24} height={24} className="rounded-full" />
            <span>Syndicate<em>Lend</em></span>
          </Link>
          <div className="workspace-right">
            {me?.institution && (
              <div className="desk-chip"><span>{me.institution.name}</span><small>{me.roleLabel}</small></div>
            )}
            <span className="workspace-chip">MHTLB-A · testnet</span>
            <UserMenu />
          </div>
        </div>
        <nav className="workspace-tabs" role="tablist" aria-label="Workspace">
          {WORKSPACES.map((g) => (
            <Link key={g.key} href={g.items[0].href} role="tab" aria-selected={active.key === g.key} data-ws={g.key} className={`workspace-tab ${active.key === g.key ? "active" : ""}`}>
              <i className="ws-dot" />{g.label}
            </Link>
          ))}
        </nav>
        <nav className="subtabs" aria-label={`${active.label} pages`}>
          {active.items.map((n) => {
            const current = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={`subtab ${current ? "active" : ""}`}>{n.label}</Link>
            );
          })}
        </nav>
      </header>
      <main className="workspace-main flex-1">
        <div className="page">
          {me?.institution && me.onboarding && !me.onboarding.ready && (
            <div className="observer-banner">
              <strong>{me.institution.name} is being onboarded.</strong> {me.onboarding.steps.filter((s) => s.state === "done").length} of {me.onboarding.steps.length} steps done. Your desk&apos;s quorum is {me.institution.members.map((m) => m.email).join(", ")} (2 of 3 must sign; one-time codes for the aliases arrive in the same inbox). Finish it on <Link href="/approvals">Desk approvals</Link>.
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
