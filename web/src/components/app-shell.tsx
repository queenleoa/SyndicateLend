"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";

const nav = [
  { href: "/blotter", label: "RFQ blotter", hint: "Quotes and trades" },
  { href: "/approvals", label: "Approvals", hint: "Desk authorisations" },
  { href: "/portfolio", label: "Portfolio", hint: "Positions and cash" },
  { href: "/register", label: "Register", hint: "Facility and holders" },
  { href: "/admin", label: "Administration", hint: "Institution and controls" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <Link href="/blotter" aria-label="SyndicateLend home">
            <Logo height={24} />
          </Link>
        </div>
        <nav className="p-2 flex-1">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2 mb-0.5 text-sm ${active ? "bg-sky-100 text-navy-800 font-semibold" : "text-ink hover:bg-paper"}`}
              >
                <div>{n.label}</div>
                <div className="text-xs text-ink-muted">{n.hint}</div>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-line text-xs text-ink-muted">
          Hedera testnet · synthetic data
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-line bg-surface flex items-center justify-between px-6">
          <div className="text-sm text-ink-muted">Private loan register and RFQ market</div>
          <UserMenu />
        </header>
        <main className="p-6 flex-1">{children}</main>
      </div>
    </div>
  );
}
