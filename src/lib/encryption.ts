import {
  deriveKeyFromPassphrase,
  deriveBlindIndexKey,
  buildE2ESyncBatch,
  type E2EChunkInput,
  type LocalEmbeddingProvider,
} from "nia-ai-ts";
import { getNia } from "./nia";

const PASSPHRASE = process.env.E2E_PASSPHRASE || "nia-imessage-demo-e2e-2026";

function deterministicSalt(passphrase: string): Uint8Array {
  const encoder = new TextEncoder();
  const data = encoder.encode(`nia-e2e-salt:${passphrase}`);
  const salt = new Uint8Array(16);
  for (let i = 0; i < data.length; i++) {
    salt[i % 16] ^= data[i]!;
  }
  return salt;
}

let cachedKeys: {
  encKey: CryptoKey;
  blindKey: CryptoKey;
  salt: Uint8Array;
} | null = null;

export async function getKeys() {
  if (cachedKeys) return cachedKeys;
  const salt = deterministicSalt(PASSPHRASE);
  const { key: encKey } = await deriveKeyFromPassphrase(PASSPHRASE, salt);
  const blindKey = await deriveBlindIndexKey(PASSPHRASE, salt);
  cachedKeys = { encKey, blindKey, salt };
  return cachedKeys;
}

export function buildNiaEmbedder(): LocalEmbeddingProvider {
  const nia = getNia();
  return {
    embedDocuments: async (texts: string[]) => {
      const BATCH = 20;
      const all: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const result = await nia.daemon.embed(batch, "document");
        all.push(...result.embeddings);
      }
      return all;
    },
    embedQuery: async (text: string) => {
      const result = await nia.daemon.embed([text], "query");
      return result.embeddings[0]!;
    },
  };
}

export interface E2EBatchResult {
  syncChunks: Awaited<ReturnType<typeof buildE2ESyncBatch>>["syncChunks"];
  embeddingProfile: string;
  stats: { totalChunks: number; totalTokens: number };
}

export async function buildEncryptedBatch(
  files: Array<{
    content: string;
    metadata: Record<string, unknown>;
    contactId?: string;
    conversationId?: string;
    timestamp?: string | null;
    senderRole?: "self" | "contact";
  }>
): Promise<E2EBatchResult> {
  const { encKey, blindKey } = await getKeys();
  const embedder = buildNiaEmbedder();

  const chunks: E2EChunkInput[] = files.map((f, i) => ({
    chunkId: `imsg_e2e_${i}_${Date.now()}`,
    content: f.content,
    contactId: f.contactId,
    conversationId: f.conversationId,
    dayBucket: f.timestamp?.slice(0, 10),
    senderRole: f.senderRole,
    metadata: f.metadata,
  }));

  return buildE2ESyncBatch({
    chunks,
    encryptionKey: encKey,
    blindIndexKey: blindKey,
    embedder,
  });
}
