"use client";

import Image from "next/image";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";

const layers = [
  { k: "Register", t: "Hedera Asset Tokenization Studio", d: "One ERC-3643 security per tranche. Whitelist and KYC are checked inside every transfer." },
  { k: "Control", t: "Privy organisation wallets", d: "Each desk is a 2-of-3 quorum of named people. No single person, and never the platform, can move it." },
  { k: "Settlement", t: "Scheduled atomic DvP", d: "Loan and cash legs move in one Hedera transaction at the agreed time, or neither moves." },
  { k: "Evidence", t: "Consensus Service audit trail", d: "Every RFQ, quote, approval and receipt is ordered and timestamped on a public topic." },
];

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace("/blotter");
  }, [ready, authenticated, router]);

  return (
    <main className="flex-1 grid lg:grid-cols-[1.1fr_1fr] min-h-screen">
      <section className="panel-dark rounded-none p-10 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Image src="/globe.png" alt="" width={40} height={40} />
            <span className="text-2xl font-semibold tracking-tight">
              Syndicate<span className="font-normal">Lend</span>
            </span>
          </div>
          <h1 className="mt-10 text-3xl lg:text-[2.4rem] leading-tight font-semibold tracking-tight">
            A loan trade should not stay exposed for weeks after both sides have agreed.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#b9dff2] max-w-xl">
            SyndicateLend is a private tokenised register and request-for-quote market for syndicated-loan interests. Ownership, eligibility,
            institutional approval and payment settle as one controlled transaction.
          </p>
        </div>
        <ol className="mt-12 grid sm:grid-cols-2 gap-4">
          {layers.map((l, i) => (
            <li key={l.k} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#8ea0bb]">
                {i + 1} · {l.k}
              </div>
              <div className="text-sm font-semibold mt-1">{l.t}</div>
              <div className="text-xs text-[#b9dff2] mt-1 leading-relaxed">{l.d}</div>
            </li>
          ))}
        </ol>
      </section>
      <section className="flex items-center justify-center p-10">
        <div className="card max-w-md w-full p-8">
          <Logo height={30} />
          <h2 className="mt-6 text-lg font-semibold text-navy-900">Sign in to your desk</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Use your firm email. Your role (trader, compliance officer or portfolio manager) decides what you can propose and approve.
          </p>
          <button className="btn btn-primary mt-6 w-full justify-center" disabled={!ready} onClick={() => login()}>
            Continue with email or Google
          </button>
          <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
            {[
              ["2 of 3", "desk approvals"],
              ["1 tx", "atomic DvP"],
              ["T+0", "scheduled settlement"],
            ].map(([v, k]) => (
              <div key={k} className="rounded-lg bg-surface-2 border border-line p-3">
                <dt className="text-navy-900 font-semibold num">{v}</dt>
                <dd className="text-[11px] text-ink-muted">{k}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
            Hedera testnet demonstration with synthetic data. Tokens do not constitute legal title to a loan interest.
          </p>
        </div>
      </section>
    </main>
  );
}
