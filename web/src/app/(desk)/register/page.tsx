import { Suspense } from "react";
import { Register } from "@/components/register";

export const metadata = { title: "Loan register" };

export default function RegisterPage() {
  return <Suspense fallback={null}><Register /></Suspense>;
}
