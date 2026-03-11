import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import {
  deriveKeyFromPassphrase,
  decryptFromBase64,
} from "nia-ai-ts";

const E2E_PASSPHRASE = process.env.E2E_PASSPHRASE || "nia-imessage-demo-e2e-2026";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query: string };
    if (!body.query?.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const nia = getNia();

    const sources = await nia.daemon.listSources();
    const source = sources.find(
      (s) => s.detectedType === "imessage" && s.displayName?.includes("iMessage E2E")
    );

    if (!source) {
      return NextResponse.json(
        { error: "No E2E iMessage source found. Sync with E2E mode first." },
        { status: 404 }
      );
    }

    const session = await nia.daemon.createE2ESession({
      localFolderId: source.localFolderId,
      ttlSeconds: 300,
      maxChunks: 50,
    });

    // Step 1: Vector search finds relevant encrypted chunks
    const searchResult = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: true,
      include_sources: true,
      e2e_session_id: session.sessionId,
    })) as Record<string, unknown>;

    const rawSources = Array.isArray(searchResult.sources) ? searchResult.sources : [];

    // Step 2: Extract chunk IDs from search results and fetch ciphertext
    const chunkIds: string[] = [];
    for (const s of rawSources) {
      const meta = (s as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const ref = meta?.ciphertext_ref as string | undefined;
      if (ref) chunkIds.push(ref);
    }

    let decryptedContexts: string[] = [];

    if (chunkIds.length > 0) {
      const decryptResult = await nia.daemon.decryptE2EChunks(
        session.sessionId,
        chunkIds.slice(0, 10),
      );

      // Step 3: Decrypt ciphertext locally with our key
      const { key } = await deriveKeyFromPassphrase(E2E_PASSPHRASE);

      for (const chunk of decryptResult.chunks) {
        try {
          const plaintext = await decryptFromBase64(chunk.plaintext, key);
          decryptedContexts.push(plaintext);
        } catch {
          // chunk may use a different key or format
          decryptedContexts.push(chunk.plaintext.slice(0, 200));
        }
      }
    }

    // Step 4: If we decrypted content, synthesize an answer with context
    let answer: string | null = null;

    if (decryptedContexts.length > 0) {
      const contextBlock = decryptedContexts
        .map((c, i) => `[Source ${i + 1}]\n${c}`)
        .join("\n\n---\n\n");

      const synthesisResult = (await nia.search.query({
        messages: [
          {
            role: "user",
            content: `Based on the following iMessage conversation excerpts, answer this question: ${body.query}\n\n${contextBlock}`,
          },
        ],
        skip_llm: false,
        fast_mode: false,
        include_sources: false,
      })) as Record<string, unknown>;

      answer = typeof synthesisResult.content === "string" ? synthesisResult.content : null;
    }

    // Fallback: try regular search if no chunks decrypted
    if (!answer && decryptedContexts.length === 0) {
      const fallback = (await nia.search.query({
        messages: [{ role: "user", content: body.query }],
        local_folders: [source.localFolderId],
        skip_llm: false,
        fast_mode: false,
        include_sources: true,
        e2e_session_id: session.sessionId,
      })) as Record<string, unknown>;

      answer = typeof fallback.content === "string" ? fallback.content : null;
    }

    const snippets = decryptedContexts.slice(0, 10).map((content, i) => ({
      content: content.slice(0, 500),
      metadata: { source_index: i + 1 },
      encrypted: false,
      decrypted: true,
    }));

    const sessionStatus = await nia.daemon.getE2ESessionStatus(session.sessionId);

    return NextResponse.json({
      answer,
      sources: snippets,
      session: {
        id: session.sessionId,
        chunksUsed: sessionStatus.chunksUsed,
        chunksRemaining: sessionStatus.maxChunks - sessionStatus.chunksUsed,
        expiresAt: session.expiresAt,
      },
      mode: "e2e",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
