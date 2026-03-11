"use client";

import { useState, useEffect, useRef } from "react";

interface StatusData {
  hasLocalAccess: boolean;
  synced: boolean;
  source: {
    id: string;
    status: string;
    lastSynced: string | null;
    syncEnabled: boolean;
  } | null;
}

interface SearchResult {
  answer: string | null;
  sources: Array<{ content: string; metadata: Record<string, unknown>; encrypted?: boolean }>;
  session?: { id: string; chunksUsed: number; chunksRemaining: number; expiresAt: string };
  mode?: string;
}

interface SyncResult {
  status: string;
  chunksIndexed?: number;
  chunksStored?: number;
  messagesRead: number;
  conversationChunks: number;
  contactsResolved: number;
  blindIndexTokens?: number;
  sourceId: string;
  mode?: string;
}

type Mode = "standard" | "e2e";

export default function Home() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [mode, setMode] = useState<Mode>("standard");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Failed to check status"));
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const endpoint = mode === "e2e" ? "/api/e2e-sync" : "/api/sync";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5000 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSyncResult(data);
      const statusRes = await fetch("/api/status");
      setStatus(await statusRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const endpoint = mode === "e2e" ? "/api/e2e-search" : "/api/search";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  const isE2E = mode === "e2e";

  return (
    <main className="min-h-screen flex flex-col items-center px-6 pt-24 pb-32">
      <div className="w-full max-w-xl">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-light tracking-tight mb-3 lowercase">
            nia
          </h1>
          <p className="text-neutral-400 text-sm tracking-wide">
            search your imessages
          </p>
        </div>

        <div className="flex items-center justify-center gap-6 mb-10">
          <button
            onClick={() => { setMode("standard"); setResult(null); setSyncResult(null); setError(null); }}
            className={`text-xs tracking-widest uppercase transition-colors ${
              !isE2E ? "text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Standard
          </button>
          <span className="text-neutral-600">|</span>
          <button
            onClick={() => { setMode("e2e"); setResult(null); setSyncResult(null); setError(null); }}
            className={`text-xs tracking-widest uppercase transition-colors ${
              isE2E ? "text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Encrypted
          </button>
        </div>

        {isE2E && (
          <p className="text-center text-[11px] text-neutral-400 mb-8 tracking-wide">
            AES-256-GCM encrypted locally before upload
          </p>
        )}

        <div className="mb-10 flex items-center justify-center gap-6 text-xs text-neutral-400">
          {status === null ? (
            <span>checking...</span>
          ) : (
            <>
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${status.hasLocalAccess ? "bg-white" : "bg-neutral-600"}`} />
                {status.hasLocalAccess ? "chat.db" : "no access"}
              </span>
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${status.synced ? "bg-white" : "bg-neutral-600"}`} />
                {status.synced
                  ? `synced${status.source?.lastSynced ? ` ${new Date(status.source.lastSynced).toLocaleDateString()}` : ""}`
                  : "not synced"}
              </span>
            </>
          )}
        </div>

        <div className="mb-10 text-center">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-6 py-2 text-xs tracking-widest uppercase border border-neutral-600 hover:border-white hover:bg-white hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
          >
            {syncing ? (isE2E ? "encrypting..." : "syncing...") : "sync"}
          </button>

          {syncResult && (
            <div className="mt-6 text-xs text-neutral-400 animate-fade-in">
              {syncResult.messagesRead} messages &middot; {syncResult.conversationChunks} chunks &middot; {syncResult.contactsResolved} contacts
              {syncResult.blindIndexTokens != null && (
                <span className="block mt-1 text-neutral-500">
                  {syncResult.blindIndexTokens} blind index tokens
                </span>
              )}
            </div>
          )}
        </div>

        <form onSubmit={handleSearch} className="relative mb-10">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ask anything..."
            className="w-full px-0 py-3 bg-transparent border-b border-neutral-700 focus:border-white outline-none text-sm text-white placeholder:text-neutral-500 transition-colors duration-200"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="absolute right-0 top-1/2 -translate-y-1/2 text-xs tracking-widest uppercase text-neutral-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            {searching ? "..." : "go"}
          </button>
        </form>

        {error && (
          <div className="mb-8 py-3 text-xs text-neutral-300 border-l-2 border-neutral-500 pl-4 animate-fade-in">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-8 animate-fade-in">
            {result.session && (
              <div className="text-[11px] text-neutral-400 tracking-wide">
                session: {result.session.chunksUsed} chunks used, {result.session.chunksRemaining} remaining
              </div>
            )}

            {result.answer && (
              <div>
                <div className="text-[10px] tracking-widest uppercase text-neutral-500 mb-4">
                  answer
                </div>
                <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">
                  {result.answer}
                </div>
              </div>
            )}

            {result.sources.length > 0 && (
              <div>
                <div className="text-[10px] tracking-widest uppercase text-neutral-500 mb-4">
                  sources ({result.sources.length})
                </div>
                <div className="space-y-1">
                  {result.sources.map((source, i) => (
                    <details key={i} className="group">
                      <summary className="py-2 cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-3">
                        <span className="w-4 text-right text-neutral-500">{i + 1}</span>
                        <span>
                          {source.metadata?.file_path
                            ? String(source.metadata.file_path).split("/").pop()
                            : `source ${i + 1}`}
                        </span>
                        {source.encrypted && (
                          <span className="text-[10px] text-neutral-500">e2e</span>
                        )}
                      </summary>
                      <div className="pl-7 pb-4 text-xs text-neutral-400 font-mono whitespace-pre-wrap leading-relaxed">
                        {source.content}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {!result.answer && result.sources.length === 0 && (
              <div className="text-center text-neutral-500 py-12 text-sm">
                no results found
              </div>
            )}
          </div>
        )}

        {!result && !error && status?.synced && (
          <div className="text-center mt-16">
            <div className="flex flex-wrap justify-center gap-3">
              {[
                "what did I talk about recently?",
                "who texted me last?",
                "what plans do I have?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setQuery(suggestion); inputRef.current?.focus(); }}
                  className="px-3 py-1.5 text-xs text-neutral-500 hover:text-white transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
