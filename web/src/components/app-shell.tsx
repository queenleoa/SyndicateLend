"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { useMe } from "@/lib/use-me";
import { useNotifications } from "@/lib/use-notifications";
import s from "./app-shell.module.css";

/** Three workspaces: the arranger's registry, the desk's exchange, and this institution's own book. */
export const WORKSPACES = [
  {
    key: "institution",
    label: "Institution",
    items: [{ href: "/institution", label: "Wallet & onboarding" }],
  },
  {
    key: "registry",
    label: "Loan Registry",
    items: [
      { href: "/issue", label: "Issue an asset" },
      { href: "/register", label: "Loan register" },
      { href: "/assignments", label: "Transfer requests" },
      { href: "/lifecycle", label: "Interest & payments" },
      { href: "/admin", label: "Administration" },
    ],
  },
  {
    key: "exchange",
    label: "Secondary Exchange",
    items: [
      { href: "/overview", label: "Execution room" },
      { href: "/blotter", label: "RFQ trading" },
      { href: "/approvals", label: "Desk approvals" },
    ],
  },
  {
    key: "positions",
    label: "Positions",
    items: [{ href: "/portfolio", label: "Positions and accruals" }],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();
  const { notifications, error: notificationError } = useNotifications();
  const active = WORKSPACES.find((g) => g.items.some((n) => pathname.startsWith(n.href))) ?? WORKSPACES[0];
  return (
    <div className={s.shell} data-workspace={active.key}>
      <header className={s.header}>
        <div className={s.topbar}>
          <Link href="/institution" aria-label="SyndicateLend institution workspace" className={s.brand}>
            <Image src="/syndicatelend-logo.png" alt="SyndicateLend" width={1484} height={260} priority />
          </Link>
          <div className={s.account}>
            <span className={s.network}><i />Hedera testnet</span>
            <details className={s.notifications}>
              <summary aria-label={notificationError ? "Approval notifications unavailable" : `${notifications?.total ?? 0} approvals need your signature`}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Approvals</span><b>{notificationError ? "!" : notifications?.total ?? "…"}</b>
              </summary>
              <div className={s.notificationMenu}><strong>Needs your signature</strong>{notificationError ? <p>Notifications unavailable. Open your workspace to check approvals.</p> : !notifications ? <p>Checking approvals…</p> : notifications.total === 0 ? <p>You’re up to date.</p> : notifications.items.map((item) => <Link href={item.href} key={item.intentId}><span>{item.kind === "setup" ? "Wallet setup" : "Trade approval"}</span>{item.title}</Link>)}<Link href="/institution">Open institution workspace →</Link></div>
            </details>
            <UserMenu canReset={me?.canReset} />
          </div>
        </div>
        <nav className={s.workspaces} aria-label="Workspace">
          {WORKSPACES.map((g, index) => (
            <Link key={g.key} href={g.items[0].href} data-ws={g.key} aria-current={active.key === g.key ? "true" : undefined} className={active.key === g.key ? s.activeWorkspace : ""}>
              <i aria-hidden="true" /><span>{String(index + 1).padStart(2, "0")}</span>{g.label}{g.key === "institution" && Boolean(notifications?.setup) && <b className={s.badge}>{notifications?.setup}</b>}{g.key === "exchange" && Boolean(notifications?.trade) && <b className={s.badge}>{notifications?.trade}</b>}
            </Link>
          ))}
          {me?.institution && (
            <div className={s.institution}><strong>{me.institution.name}</strong><span>{me.roleLabel}</span></div>
          )}
        </nav>
        <nav className={s.steps} aria-label={`${active.label} pages`}>
          {active.items.map((n, index) => {
            const current = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={current ? s.activeStep : ""}>{active.key === "registry" && index < 4 && <span>{index + 1}</span>}{n.label}</Link>
            );
          })}
        </nav>
      </header>
      <main className={s.main}>
          {children}
      </main>
    </div>
  );
}
