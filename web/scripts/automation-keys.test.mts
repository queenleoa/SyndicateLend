import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { automationConfigured, automationPublicKeys, cosignerPublicKey } from "../src/lib/automation-keys";

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), pub: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
};

test("public keys derive from the configured private keys, first key is the judge-desk co-signer", () => {
  const [a, b] = [pair(), pair()];
  const env = `${a.priv}, ${b.priv}`;
  assert.equal(automationConfigured(env), true);
  assert.deepEqual(automationPublicKeys(env).publicKeys, [a.pub, b.pub]);
  assert.equal(cosignerPublicKey(env), a.pub);
  assert.equal(automationPublicKeys(env).fingerprint, automationPublicKeys(`${b.priv},${a.priv}`).fingerprint);
});

test("missing, single or duplicate keys are refused", () => {
  const a = pair();
  assert.equal(automationConfigured(undefined), false);
  assert.equal(automationConfigured(a.priv), false);
  assert.throws(() => automationPublicKeys(a.priv));
  assert.throws(() => automationPublicKeys(`${a.priv},${a.priv}`), /distinct/);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  assert.throws(() => automationPublicKeys(`${a.priv},${rsa}`), /P-256/);
});
