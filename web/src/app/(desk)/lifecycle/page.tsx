import { Suspense } from "react";
import { InterestLifecycle } from "@/components/interest-lifecycle";

export const metadata = { title: "Interest lifecycle" };

export default function LifecyclePage() { return <Suspense fallback={null}><InterestLifecycle /></Suspense>; }
