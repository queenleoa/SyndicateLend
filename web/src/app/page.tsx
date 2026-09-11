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
        <div className={s.eyebrow}>Institutional credit. Connected.</div>
        <h1 id="headline">The only platform you need to<br className={s.desktopBreak} /> manage and trade <span>syndicated loans</span></h1>
        <h2>Settle in seconds, not weeks.</h2>
        <p>Tokenise lender positions. Trade through RFQs. Approve as an institution.<br className={s.desktopBreak} /> Exchange loan interests and cash together, with confidential interest calculations.</p>
        <button className={s.login} disabled={!ready} onClick={() => login()}>Log in <span aria-hidden="true">↗</span></button>
      </section>

      <section className={s.layers} aria-label="Technology powering each layer">
        <article>
          <div className={s.layerHead}><Image src="/integrations/hedera.svg" alt="Hedera" width={126} height={35} /><span>01 / Asset layer</span></div>
          <h3>Tokenised positions.<br />Atomic settlement.</h3>
          <p>Asset Tokenization Studio records lender holdings, enforces eligibility and enables loan tokens to settle against cash.</p>
          <div className={s.boundary}>On-ledger ownership &amp; transfer controls</div>
        </article>
        <article>
          <div className={s.layerHead}><div className={s.privy}><Image src="/integrations/privy.png" alt="Privy" width={128} height={70} /></div><span>02 / Authority layer</span></div>
          <h3>Your institution.<br />Your approval policy.</h3>
          <p>Privy organisation wallets require two of three authorised members to approve. Every wallet action follows the desk’s policy.</p>
          <div className={s.boundary}>Member authentication &amp; wallet authorisation</div>
        </article>
        <article>
          <div className={s.layerHead}><Image src="/integrations/chainlink.svg" alt="Chainlink" width={138} height={35} /><span>03 / Privacy layer</span></div>
          <h3>Private loan terms.<br />Verifiable calculations.</h3>
          <p>Chainlink CRE processes rate notices inside a confidential handler. Only the commitment and holder payment amounts are released.</p>
          <div className={s.boundary}>Confidential inputs &amp; interest computation</div>
        </article>
      </section>

      <footer className={s.footer}>
        <span className={s.note}>Synthetic assets on public testnet · CRE simulation</span>
        <a className={s.powered} href="https://fullmetal.finance" target="_blank" rel="noreferrer" aria-label="Powered by fullmetal.finance">
          <span>Powered by</span>
          <Image src="/fullmetal-logo.png" alt="fullmetal.finance" width={1920} height={1080} />
        </a>
      </footer>
    </main>
  );
}
