import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { deriveKeyFromPassphrase, decryptFromBase64 } from "nia-ai-ts";

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
      return NextResponse.json({ error: "No E2E source. Sync first." }, { status: 404 });
    }

    const session = await nia.daemon.createE2ESession({
      localFolderId: source.localFolderId,
      ttlSeconds: 300,
      maxChunks: 50,
    });

    // Vector search (skip LLM, just get chunk refs)
    const searchResult = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: true,
      include_sources: true,
      e2e_session_id: session.sessionId,
    })) as Record<string, unknown>;

    const rawSources = Array.isArray(searchResult.sources) ? searchResult.sources : [];
    const chunkIds: string[] = [];
    for (const s of rawSources) {
      const meta = (s as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const ref = meta?.ciphertext_ref as string | undefined;
      if (ref) chunkIds.push(ref);
    }

    if (!chunkIds.length) {
      return NextResponse.json({
        answer: "No relevant messages found for that query.",
        sources: [],
        session: { id: session.sessionId, chunksUsed: 0, chunksRemaining: 50 },
        mode: "e2e",
      });
    }

    // Fetch ciphertext + decrypt locally
    const decryptResult = await nia.daemon.decryptE2EChunks(session.sessionId, chunkIds.slice(0, 10));
    const { key } = await deriveKeyFromPassphrase(E2E_PASSPHRASE);

    const decrypted: string[] = [];
    for (const chunk of decryptResult.chunks) {
      try {
        decrypted.push(await decryptFromBase64(chunk.plaintext, key));
      } catch {
        // skip unreadable chunks
      }
    }

    if (!decrypted.length) {
      return NextResponse.json({
        answer: "Found encrypted chunks but couldn't decrypt. Check passphrase.",
        sources: [],
        session: { id: session.sessionId, chunksUsed: decryptResult.chunks.length, chunksRemaining: decryptResult.chunksRemaining },
        mode: "e2e",
      });
    }

    // Single LLM call with decrypted context injected
    const context = decrypted.map((c, i) => `[Message ${i + 1}]\n${c}`).join("\n\n");
    const result = (await nia.search.query({
      messages: [
        { role: "user", content: `Answer based on these iMessage conversations:\n\n${context}\n\nQuestion: ${body.query}` },
      ],
      skip_llm: false,
      fast_mode: true,
      include_sources: false,
    })) as Record<string, unknown>;

    const answer = typeof result.content === "string" ? result.content : "Could not generate answer.";
    const sessionStatus = await nia.daemon.getE2ESessionStatus(session.sessionId);

    return NextResponse.json({
      answer,
      sources: decrypted.slice(0, 10).map((c, i) => ({
        content: c.slice(0, 500),
        metadata: { source_index: i + 1 },
        decrypted: true,
      })),
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
