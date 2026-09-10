"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace("/blotter");
  }, [ready, authenticated, router]);

  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="card max-w-lg w-full p-10">
        <Logo height={36} />
        <h1 className="mt-6 text-xl font-semibold text-navy-800">Private tokenised loan register and RFQ market</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Trade syndicated-loan interests and settle asset and payment together in one controlled transaction on Hedera.
          Access is restricted to onboarded institutions; desk actions require your firm&apos;s internal approval quorum.
        </p>
        <button className="btn btn-primary mt-6" disabled={!ready} onClick={() => login()}>
          Sign in to your desk
        </button>
        <p className="mt-4 text-xs text-ink-muted">Testnet demonstration with synthetic data. Tokens do not constitute legal title to a loan interest.</p>
      </div>
    </main>
  );
}
