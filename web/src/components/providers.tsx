"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
// App client: per-environment settings (allowed origins, session duration) configured in the dashboard.
const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

export function Providers({ children }: { children: ReactNode }) {
  if (!appId) {
    return (
      <div className="p-8 text-sm text-bad">NEXT_PUBLIC_PRIVY_APP_ID is not set. Copy it from the Privy dashboard into .env.</div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ["email", "google"],
        appearance: {
          theme: "light",
          accentColor: "#16305a",
          logo: "/syndicatelend-logo.png",
          landingHeader: "Sign in to your desk",
          loginMessage: "Institutional access only. Use your firm email.",
        },
        // Desk wallets are organisation wallets managed server-side under a key quorum;
        // individual staff do not receive personal wallets.
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
