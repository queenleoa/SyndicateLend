"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export const HASHSCAN = "https://hashscan.io/testnet";

export function Receipt({ href, label, children }: { href: string; label?: string; children?: ReactNode }) {
  return (
    <a className="receipt" href={href} target="_blank" rel="noreferrer" title={label ?? href}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 8 8 2M4 2h4v4" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
      {children ?? label ?? short(href.split("/").pop() ?? "")}
    </a>
  );
}

export function short(s: string, head = 6, tail = 4) {
  if (!s) return "";
  return s.length > head + tail + 3 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function money(units: string | bigint | number, decimals = 6, digits = 2) {
  const n = Number(units) / 10 ** decimals;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function par(units: string | bigint | number) {
  return Number(units).toLocaleString("en-US");
}
export function compactUsd(units: string | bigint | number, decimals = 6) {
  const n = Number(units) / 10 ** decimals;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
export function when(ts: number) {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function ago(ts: number) {
  const ms = Date.now() - (ts < 1e12 ? ts * 1000 : ts);
  const s = Math.round(Math.abs(ms) / 1000);
  const f = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return ms >= 0 ? `${f} ago` : `in ${f}`;
}

export function Pill({ tone = "", live, children }: { tone?: "" | "ok" | "warn" | "bad" | "sky" | "navy"; live?: boolean; children: ReactNode }) {
  return <span className={`pill ${tone ? `pill-${tone}` : ""} ${live ? "pill-live" : ""}`}>{children}</span>;
}

export function Ring({ value, max, tone = "" }: { value: number; max: number; tone?: "" | "ok" | "bad" }) {
  const p = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`ring ${tone ? `ring-${tone}` : ""}`} style={{ ["--p" as string]: p }} role="img" aria-label={`${value} of ${max} approvals`}>
      <span className="num">
        {value}/{max}
      </span>
    </div>
  );
}

export type StepState = "done" | "active" | "pending" | "failed";
export function Steps({ items }: { items: { title: string; sub?: string; state: StepState }[] }) {
  return (
    <ol className="steps" aria-label="lifecycle">
      {items.map((s) => (
        <li key={s.title} className={`step step-${s.state}`} aria-current={s.state === "active" ? "step" : undefined}>
          <div className="t">
            {s.state === "done" ? "✓ " : s.state === "failed" ? "✕ " : ""}
            {s.title}
          </div>
          {s.sub && <div className="s">{s.sub}</div>}
        </li>
      ))}
    </ol>
  );
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card-flat stat">
      <div className="k">{k}</div>
      <div className="v num">{v}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

export function Avatar({ name, tone }: { name: string; tone?: "ok" | "wait" }) {
  const initials = name
    .replace(/@.*/, "")
    .split(/[.+_-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className={`avatar ${tone ? `avatar-${tone}` : ""}`} title={name}>
      {initials || "?"}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card-flat p-8 text-center">
      <div className="h2">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-navy-700 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
