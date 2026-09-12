"use client";

import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import s from "./home.module.css";

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace("/overview");
  }, [ready, authenticated, router]);

  return (
    <main className={s.page}>
      <header className={s.header}>
        <Image className={s.brand} src="/syndicatelend-logo.png" alt="SyndicateLend" width={1484} height={260} priority />
        <span className={s.network}><i /> Hedera testnet</span>
      </header>

      <section className={s.hero} aria-labelledby="headline">
        <h1 id="headline">Private RFQ secondary market and<br className={s.desktopBreak} /> register for <span>tokenised syndicated loans</span></h1>
        <h2>Settle in seconds, not weeks.</h2>
        <button className={s.login} disabled={!ready} onClick={() => login()} aria-label="Log in with Privy">
          <span>Log in with</span>
          <span className={s.loginLogo}><Image src="/integrations/privy.png" alt="Privy" width={128} height={70} /></span>
        </button>
      </section>

      <section className={s.layers} aria-label="Technology powering each layer">
        <article>
          <div className={s.layerHead}><Image src="/integrations/hedera.svg" alt="Hedera" width={126} height={35} /></div>
          <h3>Tokenised Issuance and Settlements</h3>
          <ul>
            <li>ATS issuance, lender allocation and KYC controls.</li>
            <li>Atomic loan-token and HTS cash settlement.</li>
            <li>Network-scheduled execution and HCS audit records.</li>
          </ul>
        </article>
        <article>
          <div className={s.layerHead}><div className={s.privy}><Image src="/integrations/privy.png" alt="Privy" width={128} height={70} /></div></div>
          <h3>Wallets and Institutional policy</h3>
          <ul>
            <li>Staff login and quorum-owned institution wallets.</li>
            <li>Two-of-three member approvals for wallet intents.</li>
            <li>Signing policies restrict actions to venue contracts.</li>
          </ul>
        </article>
        <article>
          <div className={s.layerHead}><Image src="/integrations/chainlink.svg" alt="Chainlink" width={138} height={35} /></div>
          <h3>Interest and Loan Term Computation</h3>
          <ul>
            <li>Authenticated rate notices in a confidential handler.</li>
            <li>Commitment checks reject altered loan terms.</li>
            <li>Per-holder interest from terms and register balances.</li>
          </ul>
        </article>
      </section>

      <footer className={s.footer}>
        <a className={s.contact} href="mailto:adrija@fullmetal.finance">adrija@fullmetal.finance</a>
        <a className={s.powered} href="https://fullmetal.finance" target="_blank" rel="noreferrer" aria-label="Powered by fullmetal.finance">
          <span>Powered by</span>
          <Image src="/fullmetal-logo.png" alt="fullmetal.finance" width={1920} height={1080} />
        </a>
      </footer>
    </main>
  );
}
