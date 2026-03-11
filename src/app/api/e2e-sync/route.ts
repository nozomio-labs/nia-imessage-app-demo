import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { readMessages, buildContactLookup } from "@/lib/imessage";
import { buildEncryptedBatch } from "@/lib/encryption";
import { buildLocalIMessageSyncBatch } from "nia-ai-ts";
import type { LocalIMessageRow } from "nia-ai-ts";

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

    const e2eBatch = await buildEncryptedBatch(
      batch.files.map((f) => ({
        content: f.content,
        metadata: f.metadata as unknown as Record<string, unknown>,
        contactId: f.metadata.contactId,
        conversationId: f.metadata.conversationId,
        timestamp: f.metadata.timestamp,
        senderRole: f.metadata.senderRole,
      }))
    );

    const nia = getNia();

    const sources = await nia.daemon.listSources();
    const existing = sources.find(
      (s) => s.detectedType === "imessage" && s.displayName?.includes("iMessage E2E")
    );

    let localFolderId: string;
    if (existing) {
      localFolderId = existing.localFolderId;
    } else {
      const created = await nia.daemon.createSource({
        path: process.env.CHAT_DB_PATH || "~/Library/Messages/chat.db",
        displayName: "iMessage E2E",
        detectedType: "imessage",
      });
      localFolderId = created.localFolderId;
    }

    const syncResult = await nia.daemon.pushE2ESync({
      localFolderId,
      chunks: e2eBatch.syncChunks,
      embeddingProfile: e2eBatch.embeddingProfile,
      connectorType: "imessage",
      isFinalBatch: true,
      idempotencyKey: `e2e-app-${Date.now()}`,
    });

    return NextResponse.json({
      status: syncResult.status,
      chunksStored: syncResult.chunksStored,
      messagesRead: rawRows.length,
      conversationChunks: batch.files.length,
      contactsResolved: Object.keys(contactLookup).length,
      blindIndexTokens: e2eBatch.stats.totalTokens,
      sourceId: localFolderId,
      encrypted: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
