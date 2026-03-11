# Nia iMessage App

Search your iMessages with AI using the [Nia TypeScript SDK](https://www.npmjs.com/package/nia-ai-ts). Supports both standard cloud sync and end-to-end encrypted mode.

## What it does

- Reads your local `chat.db` (macOS iMessage database)
- Resolves contact names from the AddressBook
- Syncs conversation chunks to Nia cloud for AI-powered search
- Provides a search UI with AI synthesis and source citations

## Two modes

**Standard** — Messages are synced as plaintext. Nia handles chunking, embedding, and search server-side. Simple and fast.

**E2E Encrypted** — Messages are encrypted locally with AES-256-GCM before upload. Nia cloud never sees plaintext content. Uses:
- Client-side key derivation (PBKDF2)
- Real ZeroEntropy embeddings via `/daemon/embed`
- HMAC-SHA256 blind index tokens for server-side filtering
- Temporary decrypt sessions for search

## Setup

```bash
bun install
```

Create `.env.local`:

```
NIA_API_KEY=nk_your_api_key_here
NIA_API_URL=https://apigcp.trynia.ai/v2
CHAT_DB_PATH=/Users/you/Library/Messages/chat.db
ADDRESSBOOK_PATH=/Users/you/Library/Application Support/AddressBook/Sources/XXXXX/AddressBook-v22.abcddb
```

Get your API key from [trynia.ai](https://trynia.ai).

## Run

```bash
bun dev
```

Open http://localhost:3000. Click "Sync iMessages to Nia", then search.

## How it works

### Standard mode

```
chat.db → buildLocalIMessageSyncBatch() → pushSync() → search.query()
```

### E2E mode

```
chat.db → buildLocalIMessageSyncBatch()
        → daemon.embed() (real ZeroEntropy embeddings)
        → buildE2ESyncBatch() (AES-256-GCM encrypt + blind index)
        → pushE2ESync() (ciphertext + vectors to Nia)
        → createE2ESession() + search.query(e2e_session_id)
```

## SDK usage

```typescript
import { NiaSDK, buildLocalIMessageSyncBatch, buildE2ESyncBatch, deriveKeyFromPassphrase, deriveBlindIndexKey } from "nia-ai-ts";

const nia = new NiaSDK({ apiKey: "nk_...", baseUrl: "https://apigcp.trynia.ai/v2" });

// Standard sync
const batch = buildLocalIMessageSyncBatch({ rows, contactLookup });
await nia.daemon.pushSync({ localFolderId, files: batch.files, connectorType: "imessage" });

// E2E sync
const { key, salt } = await deriveKeyFromPassphrase("your-passphrase");
const blindKey = await deriveBlindIndexKey("your-passphrase", salt);
const embeddings = await nia.daemon.embed(texts, "document");
const e2eBatch = await buildE2ESyncBatch({ chunks, encryptionKey: key, blindIndexKey: blindKey, embedder });
await nia.daemon.pushE2ESync({ localFolderId, chunks: e2eBatch.syncChunks });

// Search
const session = await nia.daemon.createE2ESession({ localFolderId, ttlSeconds: 300 });
const result = await nia.search.query({ messages: [...], local_folders: [id], e2e_session_id: session.sessionId });
```

## Tech

- [Next.js](https://nextjs.org) 16 with App Router
- [Nia TypeScript SDK](https://www.npmjs.com/package/nia-ai-ts) (`nia-ai-ts`)
- [Tailwind CSS](https://tailwindcss.com) v4
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for local DB access
