import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { getKeys } from "@/lib/encryption";
import { decryptFromBase64 } from "nia-ai-ts";

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
        { error: "No E2E iMessage source found. Sync with E2E encryption first." },
        { status: 404 }
      );
    }

    const session = await nia.daemon.createE2ESession({
      localFolderId: source.localFolderId,
      ttlSeconds: 300,
      maxChunks: 50,
    });

    // Step 1: Vector search to find relevant encrypted chunks (skip LLM)
    const searchResult = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: true,
      include_sources: true,
      e2e_session_id: session.sessionId,
    })) as Record<string, unknown>;

    const rawSources = Array.isArray(searchResult.sources) ? searchResult.sources : [];

    // Step 2: Extract chunk IDs from vector search results
    const chunkIds: string[] = [];
    for (const s of rawSources) {
      const meta = (s as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const ref = meta?.ciphertext_ref as string | undefined;
      if (ref) chunkIds.push(ref);
    }

    if (!chunkIds.length) {
      return NextResponse.json({
        answer: "No relevant messages found for your query.",
        sources: [],
        encrypted: true,
      });
    }

    // Step 3: Fetch ciphertext through session
    const decryptResult = await nia.daemon.decryptE2EChunks(
      session.sessionId,
      chunkIds.slice(0, 15),
    );

    // Step 4: DECRYPT LOCALLY with the key this app holds
    const { encKey } = await getKeys();
    const decryptedTexts: string[] = [];

    for (const chunk of decryptResult.chunks) {
      try {
        const plaintext = await decryptFromBase64(chunk.plaintext, encKey);
        decryptedTexts.push(plaintext);
      } catch {
        // skip chunks that can't be decrypted (old salt)
      }
    }

    if (!decryptedTexts.length) {
      return NextResponse.json({
        answer: "Found encrypted chunks but decryption failed. You may need to re-sync with 'Encrypt & Sync' to use the current encryption key.",
        sources: [],
        encrypted: true,
        decryptionFailed: true,
      });
    }

    // Step 5: Send decrypted content to LLM for synthesis
    // Use the search endpoint with the context embedded in the system message
    const contextBlock = decryptedTexts
      .map((c, i) => `--- Message excerpt ${i + 1} ---\n${c}`)
      .join("\n\n");

    const synthesisResult = (await nia.search.query({
      messages: [
        {
          role: "system",
          content: `You are answering questions about the user's personal iMessage conversations. Here are relevant message excerpts:\n\n${contextBlock}`,
        },
        { role: "user", content: body.query },
      ],
      local_folders: [source.localFolderId],
      skip_llm: false,
      fast_mode: false,
      include_sources: false,
    })) as Record<string, unknown>;

    const answer = typeof synthesisResult.content === "string"
      ? synthesisResult.content
      : "Could not generate an answer.";

    const sessionStatus = await nia.daemon.getE2ESessionStatus(session.sessionId);

    return NextResponse.json({
      answer,
      sources: decryptedTexts.map((content) => ({
        content: content.slice(0, 500),
        metadata: {},
        decryptedLocally: true,
      })),
      session: {
        id: session.sessionId,
        chunksUsed: sessionStatus.chunksUsed,
        chunksRemaining: sessionStatus.maxChunks - sessionStatus.chunksUsed,
        status: sessionStatus.status,
      },
      encrypted: true,
      decryptedLocally: true,
      chunksDecrypted: decryptedTexts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
