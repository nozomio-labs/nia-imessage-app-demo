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
  sources: Array<{ content: string; metadata: Record<string, unknown>; encrypted?: boolean; decryptedLocally?: boolean }>;
  session?: { id: string; chunksUsed: number; chunksRemaining: number; status: string };
  encrypted?: boolean;
  decryptedLocally?: boolean;
  chunksDecrypted?: number;
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
  encrypted?: boolean;
}

type Mode = "standard" | "e2e";

export default function Home() {
  const [mode, setMode] = useState<Mode>("e2e");
  const [status, setStatus] = useState<StatusData | null>(null);
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
    setResult(null);
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

  const accentColor = mode === "e2e" ? "violet" : "emerald";
  const ac = (shade: number) =>
    mode === "e2e" ? `violet-${shade}` : `emerald-${shade}`;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 pt-16 pb-32">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            <span className={mode === "e2e" ? "text-violet-400" : "text-emerald-400"}>Nia</span> iMessage
          </h1>
          <p className="text-neutral-400 text-lg">
            {mode === "e2e" ? "End-to-end encrypted message search" : "Search your messages with AI"}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex justify-center mb-8">
          <div className="flex rounded-lg bg-neutral-900 border border-neutral-800 p-0.5">
            <button
              onClick={() => { setMode("standard"); setSyncResult(null); setResult(null); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                mode === "standard"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Standard
            </button>
            <button
              onClick={() => { setMode("e2e"); setSyncResult(null); setResult(null); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${
                mode === "e2e"
                  ? "bg-violet-600 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              E2E Encrypted
            </button>
          </div>
        </div>

        {/* E2E Info Banner */}
        {mode === "e2e" && (
          <div className="mb-6 p-3 rounded-lg bg-violet-950/30 border border-violet-800/30 text-xs text-violet-300/80 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Messages are encrypted with AES-256-GCM on your device before upload.
              Nia cloud stores only ciphertext + search vectors. Raw content never leaves your machine.
            </span>
          </div>
        )}

        {/* Status */}
        <div className="mb-8 flex items-center justify-center gap-4 text-sm">
          {status === null ? (
            <span className="text-neutral-500">Checking...</span>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${status.hasLocalAccess ? (mode === "e2e" ? "bg-violet-400" : "bg-emerald-400") : "bg-red-400"}`} />
                {status.hasLocalAccess ? "chat.db accessible" : "No chat.db access"}
              </span>
              <span className="text-neutral-700">|</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${status.synced ? (mode === "e2e" ? "bg-violet-400" : "bg-emerald-400") : "bg-amber-400"}`} />
                {status.synced
                  ? `Synced${status.source?.lastSynced ? ` (${new Date(status.source.lastSynced).toLocaleDateString()})` : ""}`
                  : "Not synced"}
              </span>
            </>
          )}
        </div>

        {/* Sync Button */}
        <div className="mb-8 text-center">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-6 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm ${
              mode === "e2e"
                ? "bg-violet-600 hover:bg-violet-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {syncing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mode === "e2e" ? "Encrypting & syncing..." : "Syncing messages..."}
              </span>
            ) : (
              <>
                {mode === "e2e" ? "Encrypt & Sync iMessages" : "Sync iMessages to Nia"}
              </>
            )}
          </button>

          {syncResult && (
            <div className="mt-4 text-sm text-neutral-400 animate-fade-in space-y-1">
              <div>
                <span className={mode === "e2e" ? "text-violet-400 font-medium" : "text-emerald-400 font-medium"}>
                  {syncResult.messagesRead}
                </span>{" "}messages read,{" "}
                <span className={mode === "e2e" ? "text-violet-400 font-medium" : "text-emerald-400 font-medium"}>
                  {syncResult.conversationChunks}
                </span>{" "}chunks{" "}
                {syncResult.encrypted ? "encrypted & " : ""}indexed,{" "}
                <span className={mode === "e2e" ? "text-violet-400 font-medium" : "text-emerald-400 font-medium"}>
                  {syncResult.contactsResolved}
                </span>{" "}contacts
              </div>
              {syncResult.encrypted && syncResult.blindIndexTokens && (
                <div className="text-xs text-violet-400/60">
                  {syncResult.blindIndexTokens} blind index tokens generated for encrypted search
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative mb-8">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "e2e" ? "Search encrypted messages..." : "Ask anything about your messages..."}
            className={`w-full px-5 py-3.5 rounded-xl bg-neutral-900 border outline-none text-white placeholder:text-neutral-500 transition pr-24 ${
              mode === "e2e"
                ? "border-neutral-800 focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                : "border-neutral-800 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            }`}
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className={`absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition text-sm font-medium ${
              mode === "e2e"
                ? "bg-violet-600 hover:bg-violet-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {searching ? "..." : "Search"}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-950/50 border border-red-900/50 text-red-300 text-sm animate-fade-in">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6 animate-fade-in">
            {/* E2E Session Badge */}
            {result.session && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-violet-400/70">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Session {result.session.id.slice(0, 16)}...
                <span className="text-neutral-600">|</span>
                {result.session.chunksUsed} chunks retrieved
                {result.decryptedLocally && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span className="text-emerald-400">{result.chunksDecrypted} decrypted on device</span>
                  </>
                )}
              </div>
            )}

            {result.answer && (
              <div className={`p-5 rounded-xl border ${
                mode === "e2e"
                  ? "bg-neutral-900/80 border-violet-800/30"
                  : "bg-neutral-900/80 border-neutral-800"
              }`}>
                <div className={`text-xs font-medium uppercase tracking-wider mb-3 ${
                  mode === "e2e" ? "text-violet-400" : "text-emerald-400"
                }`}>
                  {mode === "e2e"
                    ? result.decryptedLocally
                      ? "Answer (encrypted on cloud, decrypted on device)"
                      : "Answer (via encrypted search)"
                    : "Answer"}
                </div>
                <div className="text-neutral-200 leading-relaxed whitespace-pre-wrap">
                  {result.answer}
                </div>
              </div>
            )}

            {result.sources.length > 0 && (
              <div>
                <div className="text-xs text-neutral-500 font-medium uppercase tracking-wider mb-3">
                  Sources ({result.sources.length})
                </div>
                <div className="space-y-2">
                  {result.sources.map((source, i) => (
                    <details
                      key={i}
                      className={`group rounded-lg border ${
                        source.encrypted
                          ? "bg-violet-950/20 border-violet-800/20"
                          : "bg-neutral-900/50 border-neutral-800/50"
                      }`}
                    >
                      <summary className="px-4 py-2.5 cursor-pointer text-sm text-neutral-400 hover:text-neutral-200 transition flex items-center gap-2">
                        <svg className="w-3 h-3 transition group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Source {i + 1}
                        {source.decryptedLocally && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-800/30 text-emerald-400 font-medium">
                            DECRYPTED ON DEVICE
                          </span>
                        )}
                        {source.encrypted && !source.decryptedLocally && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-violet-800/30 text-violet-400 font-medium">
                            ENCRYPTED
                          </span>
                        )}
                        {source.metadata?.file_path && (
                          <span className="text-neutral-600 text-xs ml-auto font-mono">
                            {String(source.metadata.file_path).split("/").pop()}
                          </span>
                        )}
                      </summary>
                      <div className={`px-4 pb-3 text-xs font-mono whitespace-pre-wrap border-t pt-3 ${
                        source.encrypted
                          ? "text-violet-400/50 border-violet-800/20"
                          : "text-neutral-500 border-neutral-800/50"
                      }`}>
                        {source.content}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {!result.answer && result.sources.length === 0 && (
              <div className="text-center text-neutral-500 py-8">
                No results found. Try a different query.
              </div>
            )}
          </div>
        )}

        {/* Suggestions */}
        {!result && !error && (
          <div className="text-center text-neutral-600 mt-12">
            <p className="text-sm">Try asking things like:</p>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {[
                "What did I talk about recently?",
                "Who texted me last?",
                "What plans do I have this week?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setQuery(suggestion); inputRef.current?.focus(); }}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900/50 border border-neutral-800/50 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition"
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
