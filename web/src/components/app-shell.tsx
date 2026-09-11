"use client";

import Image from "next/image";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { useMe } from "@/lib/use-me";

const nav = [
  { href: "/blotter", label: "RFQ blotter", hint: "Quotes, trades, settlement" },
  { href: "/approvals", label: "Approvals", hint: "Desk quorum authorisations" },
  { href: "/portfolio", label: "Portfolio", hint: "Positions and cash" },
  { href: "/register", label: "Register", hint: "Facility and eligible holders" },
  { href: "/admin", label: "Administration", hint: "Institutions and venue" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useMe();
  return (
    <div className="flex min-h-screen">
      <aside className="sidebar w-64 shrink-0 flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <Link href="/blotter" aria-label="SyndicateLend home" className="flex items-center gap-2">
            <Image src="/globe.png" alt="" width={26} height={26} className="rounded-full" />
            <span className="text-white font-semibold tracking-tight text-[15px]">
              Syndicate<span className="font-normal">Lend</span>
            </span>
          </Link>
          {me?.institution ? (
            <div className="mt-4 rounded-lg bg-white/5 border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#8ea0bb]">Desk</div>
              <div className="text-white text-sm font-medium leading-tight mt-0.5">{me.institution.name}</div>
              <div className="text-xs text-[#b9dff2] mt-0.5">{me.roleLabel}</div>
            </div>
          ) : me ? (
            <div className="mt-4 rounded-lg bg-white/5 border border-white/10 p-3 text-xs text-[#8ea0bb]">Not attached to an institution</div>
          ) : null}
        </div>
        <nav className="p-3 flex-1">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`nav-item ${active ? "active" : ""}`}>
                <div>{n.label}</div>
                <div className="hint">{n.hint}</div>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10 text-[11px] leading-relaxed text-[#8ea0bb]">
          <div className="flex items-center gap-2 text-[#b9dff2]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-300 pill-live" /> Hedera testnet
          </div>
          Synthetic facility and cash. Tokens are not legal title.
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-line bg-surface/80 backdrop-blur flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="text-sm text-ink-muted">Private tokenised loan register and RFQ market</div>
          <UserMenu />
        </header>
        <main className="p-6 flex-1 max-w-[1280px] w-full">{children}</main>
      </div>
    </div>
  );
}
