import { redirect } from "next/navigation";

/** The loan configuration now lives on the register, per asset. */
export default function FacilityPage() {
  redirect("/register");
}
