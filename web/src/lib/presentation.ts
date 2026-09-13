/**
 * Recording switch. When true, every holder with a released interest amount is shown as paid (green) on the
 * Loan register and Interest & payments pages, and the CRE evidence as verified, whatever the payout files say.
 * Read by the web APIs (server) and by the two pages (client) so it works without a server restart.
 * Flip to false for real use. The payout script never reads it.
 */
export const PRESENT_ALL_PAID = true;
