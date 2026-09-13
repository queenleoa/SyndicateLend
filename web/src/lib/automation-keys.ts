import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

/**
 * The venue's automation keys (AUTOMATED_DESK_KEYS: P-256 private keys, PKCS8 DER base64, comma-separated).
 * They form the quorum of the automated institutions, and the first one is the automated compliance
 * co-signer on self-service judge desks. Only public material ever leaves this module.
 */
export function automationPrivateKeys(env = process.env.AUTOMATED_DESK_KEYS): string[] {
  return (env ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

export function automationConfigured(env = process.env.AUTOMATED_DESK_KEYS): boolean {
  return automationPrivateKeys(env).length >= 2;
}

/** SPKI DER base64 public keys, in the same order as the private keys, plus a stable fingerprint. */
export function automationPublicKeys(env = process.env.AUTOMATED_DESK_KEYS): { publicKeys: string[]; fingerprint: string } {
  const values = automationPrivateKeys(env);
  if (values.length < 2) throw new Error("Configure AUTOMATED_DESK_KEYS (two P-256 keys) first.");
  const publicKeys = values.map((value) => {
    const privateKey = createPrivateKey({ key: Buffer.from(value, "base64"), type: "pkcs8", format: "der" });
    if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Automation keys must be P-256 keys.");
    return createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  });
  if (new Set(publicKeys).size !== publicKeys.length) throw new Error("Automation keys must be distinct.");
  return { publicKeys, fingerprint: createHash("sha256").update([...publicKeys].sort().join(",")).digest("hex") };
}

/** The key that co-signs judge desks: always the first automation key. */
export function cosignerPublicKey(env = process.env.AUTOMATED_DESK_KEYS): string {
  return automationPublicKeys(env).publicKeys[0];
}

/**
 * A reserve P-256 signer minted for one judge desk. Only the public half is kept (the private half is
 * discarded on return), so the desk quorum is a genuine 2-of-3 in Privy (trader, compliance co-signer,
 * reserve key) while the venue still holds exactly one of the three keys and can never execute alone.
 */
export function mintReserveSignerPublicKey(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}
