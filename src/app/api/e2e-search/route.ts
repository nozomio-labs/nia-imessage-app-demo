import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { decryptFromBase64 } from "nia-ai-ts";
import { getE2EKeys } from "@/lib/e2e-keys";

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
    const { encKey: key } = await getE2EKeys();

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

    // Call Anthropic directly for synthesis (decrypted content never touches Nia cloud)
    const context = decrypted.map((c, i) => `[Message ${i + 1}]\n${c}`).join("\n\n---\n\n");
    const prompt = `You are an AI assistant helping a user search their iMessage conversations. Based on the following message excerpts, answer the user's question concisely.\n\nConversation excerpts:\n${context}\n\nUser's question: ${body.query}`;

    const llmResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    let answer: string;
    if (llmResponse.ok) {
      const llmData = (await llmResponse.json()) as { content?: Array<{ text?: string }> };
      answer = llmData.content?.[0]?.text || "Could not generate answer.";
    } else {
      // Fallback: use Nia search with context
      const result = (await nia.search.query({
        messages: [{ role: "user", content: `${prompt}` }],
        skip_llm: false,
        fast_mode: false,
        include_sources: false,
      })) as Record<string, unknown>;
      answer = typeof result.content === "string" ? result.content : "Could not generate answer.";
    }
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
