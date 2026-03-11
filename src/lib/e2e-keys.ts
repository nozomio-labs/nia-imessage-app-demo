import { deriveKeyFromPassphrase, deriveBlindIndexKey } from "nia-ai-ts";

const E2E_PASSPHRASE = process.env.E2E_PASSPHRASE || "nia-imessage-demo-e2e-2026";

function deterministicSalt(passphrase: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(`nia-e2e-salt:${passphrase}`);
  const salt = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    salt[i % 16] ^= bytes[i]!;
  }
  return salt;
}

const SALT = deterministicSalt(E2E_PASSPHRASE);

let cached: { encKey: CryptoKey; blindKey: CryptoKey } | null = null;

export async function getE2EKeys() {
  if (cached) return cached;
  const { key: encKey } = await deriveKeyFromPassphrase(E2E_PASSPHRASE, SALT);
  const blindKey = await deriveBlindIndexKey(E2E_PASSPHRASE, SALT);
  cached = { encKey, blindKey };
  return cached;
}
