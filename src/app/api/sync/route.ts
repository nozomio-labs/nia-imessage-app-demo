import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { readMessages, buildContactLookup } from "@/lib/imessage";
import { buildLocalIMessageSyncBatch } from "nia-ai-ts";
import type { LocalIMessageRow, DaemonSyncFile } from "nia-ai-ts";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { limit?: number };
    const limit = body.limit ?? 2000;

    const rawRows = readMessages(limit);
    if (!rawRows.length) {
      return NextResponse.json({ error: "No messages found in chat.db" }, { status: 404 });
    }

    const contactLookup = buildContactLookup();

    const rows: LocalIMessageRow[] = rawRows.map((r) => ({
      rowId: r.row_id,
      text: r.text,
      appleDate: r.date,
      isFromMe: Boolean(r.is_from_me),
      service: r.service,
      threadOriginatorGuid: r.thread_originator_guid,
      contactId: r.contact_id,
      contactDisplay: r.contact_display,
    }));

    const batch = buildLocalIMessageSyncBatch({ rows, contactLookup });

    if (!batch.files.length) {
      return NextResponse.json({ error: "No conversation chunks built" }, { status: 400 });
    }

    const nia = getNia();

    const sources = await nia.daemon.listSources();
    const existing = sources.find(
      (s) => s.detectedType === "imessage" && s.displayName?.includes("iMessage App")
    );

    let localFolderId: string;
    if (existing) {
      localFolderId = existing.localFolderId;
    } else {
      const created = await nia.daemon.createSource({
        path: process.env.CHAT_DB_PATH || "~/Library/Messages/chat.db",
        displayName: "iMessage App",
        detectedType: "imessage",
      });
      localFolderId = created.localFolderId;
    }

    const syncResult = await nia.daemon.pushSync({
      localFolderId,
      files: batch.files.map(
        (f): DaemonSyncFile => ({
          path: f.path,
          content: f.content,
          metadata: f.metadata as unknown as Record<string, unknown>,
        })
      ),
      cursor: batch.cursor as unknown as Record<string, unknown>,
      stats: batch.stats as unknown as Record<string, unknown>,
      connectorType: "imessage",
      isFinalBatch: true,
      idempotencyKey: `imessage-app-${Date.now()}`,
    });

    return NextResponse.json({
      status: syncResult.status,
      chunksIndexed: syncResult.chunksIndexed,
      messagesRead: rawRows.length,
      conversationChunks: batch.files.length,
      contactsResolved: Object.keys(contactLookup).length,
      sourceId: localFolderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
