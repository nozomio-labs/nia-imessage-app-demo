import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";

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

    const result = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: false,
      fast_mode: false,
      include_sources: true,
      e2e_session_id: session.sessionId,
    })) as Record<string, unknown>;

    const answer = typeof result.content === "string" ? result.content : null;
    const rawSources = Array.isArray(result.sources) ? result.sources : [];

    const snippets = rawSources.slice(0, 10).map((s: Record<string, unknown>) => {
      const content = typeof s.content === "string" ? s.content : "";
      const isEncrypted = content.startsWith("eyJ") || content.startsWith("[E2E");
      return {
        content: isEncrypted ? "[Encrypted content - visible only through desktop bridge]" : content.slice(0, 500),
        metadata: s.metadata ?? {},
        encrypted: isEncrypted,
      };
    });

    const sessionStatus = await nia.daemon.getE2ESessionStatus(session.sessionId);

    return NextResponse.json({
      answer,
      sources: snippets,
      session: {
        id: session.sessionId,
        chunksUsed: sessionStatus.chunksUsed,
        chunksRemaining: sessionStatus.maxChunks - sessionStatus.chunksUsed,
        status: sessionStatus.status,
      },
      encrypted: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
