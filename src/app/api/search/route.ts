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
      (s) => s.detectedType === "imessage" && s.displayName?.includes("iMessage App")
    );

    if (!source) {
      return NextResponse.json(
        { error: "No iMessage source found. Sync your messages first." },
        { status: 404 }
      );
    }

    const result = (await nia.search.query({
      messages: [{ role: "user", content: body.query }],
      local_folders: [source.localFolderId],
      skip_llm: false,
      fast_mode: false,
      include_sources: true,
    })) as Record<string, unknown>;

    const answer = typeof result.content === "string" ? result.content : null;
    const rawSources = Array.isArray(result.sources) ? result.sources : [];

    const snippets = rawSources.slice(0, 10).map((s: Record<string, unknown>) => ({
      content: typeof s.content === "string" ? s.content.slice(0, 500) : "",
      metadata: s.metadata ?? {},
    }));

    return NextResponse.json({ answer, sources: snippets });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
