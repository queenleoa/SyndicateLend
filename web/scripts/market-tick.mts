/** Run the market maker and onboarding tick once (the hosted app runs it after API responses). */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");
const { marketTick } = await import("../src/lib/automated-desk");
await hydrate();
const log = await marketTick(true);
console.log(log.length ? log.join("\n") : "nothing to do");
await flush();
process.exit(0);
