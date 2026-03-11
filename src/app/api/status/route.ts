import { NextResponse } from "next/server";
import { getNia } from "@/lib/nia";
import { readMessages } from "@/lib/imessage";

export async function GET() {
  try {
    const nia = getNia();
    const sources = await nia.daemon.listSources();
    const source = sources.find(
      (s) => s.detectedType === "imessage" && s.displayName?.includes("iMessage App")
    );

    const localMessages = readMessages(1);
    const hasLocalAccess = localMessages.length > 0;

    return NextResponse.json({
      hasLocalAccess,
      source: source
        ? {
            id: source.localFolderId,
            status: source.status,
            lastSynced: source.lastSynced,
            syncEnabled: source.syncEnabled,
          }
        : null,
      synced: !!source,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
