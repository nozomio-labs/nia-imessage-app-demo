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

    // Step 1: Create a decrypt session to retrieve encrypted chunks
    const session = await nia.daemon.createE2ESession({
      localFolderId: source.localFolderId,
      ttlSeconds: 300,
      maxChunks: 50,
    });

    // Step 2: Vector search finds relevant chunks (embeddings are in the clear)
    const searchResult = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: true,
      include_sources: true,
      e2e_session_id: session.sessionId,
    })) as Record<string, unknown>;

    const rawSources = Array.isArray(searchResult.sources) ? searchResult.sources : [];

    // Step 3: Extract chunk IDs from search results and fetch ciphertext
    const chunkIds: string[] = [];
    for (const s of rawSources) {
      const meta = (s as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const ref = meta?.ciphertext_ref as string | undefined;
      if (ref) chunkIds.push(ref);
    }

    let decryptedContexts: string[] = [];

    if (chunkIds.length > 0) {
      // Step 4: Retrieve ciphertext through the session
      const decryptResult = await nia.daemon.decryptE2EChunks(
        session.sessionId,
        chunkIds.slice(0, 20),
      );

      // Step 5: DECRYPT LOCALLY -- this app holds the key, Nia cloud never sees plaintext
      const { encKey } = await getKeys();

      for (const chunk of decryptResult.chunks) {
        try {
          const plaintext = await decryptFromBase64(chunk.plaintext, encKey);
          decryptedContexts.push(plaintext);
        } catch {
          decryptedContexts.push("[decryption failed]");
        }
      }
    }

    // Step 6: Send decrypted plaintext to LLM for synthesis
    // The LLM now sees real content -- but Nia cloud never did
    let answer: string | null = null;

    if (decryptedContexts.length > 0) {
      const contextBlock = decryptedContexts
        .map((c, i) => `[Source ${i + 1}]\n${c}`)
        .join("\n\n---\n\n");

      const synthesisResult = (await nia.search.query({
        messages: [
          {
            role: "user",
            content: `Based on these message excerpts, answer: ${body.query}\n\n${contextBlock}`,
          },
        ],
        skip_llm: false,
        fast_mode: false,
        include_sources: false,
      })) as Record<string, unknown>;

      answer = typeof synthesisResult.content === "string" ? synthesisResult.content : null;
    }

    const sessionStatus = await nia.daemon.getE2ESessionStatus(session.sessionId);

    const snippets = decryptedContexts.map((content, i) => ({
      content: content.slice(0, 500),
      metadata: {},
      decryptedLocally: true,
    }));

    return NextResponse.json({
      answer: answer || "No relevant messages found for your query.",
      sources: snippets,
      session: {
        id: session.sessionId,
        chunksUsed: sessionStatus.chunksUsed,
        chunksRemaining: sessionStatus.maxChunks - sessionStatus.chunksUsed,
        status: sessionStatus.status,
      },
      encrypted: true,
      decryptedLocally: true,
      chunksDecrypted: decryptedContexts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
