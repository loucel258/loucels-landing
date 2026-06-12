"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  RotateCw,
  Send,
  Shield,
  X,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { ChatMessage, ChatResponse, ChatErrorCode } from "@/lib/chat/types";
import type { ChatAuditRow } from "@/lib/audit/chat-reader";
import { siteConfig } from "@/lib/site-config";

type ChatDict = {
  bubbleLabel: string;
  panelTitle: string;
  panelSubtitle: string;
  greeting: string;
  placeholder: string;
  send: string;
  thinking: string;
  retry: string;
  bookCta: string;
  privacy: string;
  errorGeneric: string;
  errorUnavailable: string;
  errorRateLimited: string;
  close: string;
  auditTrail: string;
  auditTitle: string;
  auditSubtitle: string;
  auditEmpty: string;
  auditBack: string;
};

// Keep client-side history aligned with the server-side hard cap.
const MAX_HISTORY = 30;

// Generate a stable session id once per browser session. Stored in
// sessionStorage so it survives a refresh but not a tab close — that's the
// granularity we want for the chat's observability stream.
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "loucels-chat-session";
  let id = window.sessionStorage.getItem(KEY);
  if (!id) {
    id = `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    window.sessionStorage.setItem(KEY, id);
  }
  return id;
}

export function ChatWidget({
  locale,
  dict,
}: {
  locale: Locale;
  dict: ChatDict;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatErrorCode | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  // Audit-trail overlay
  const [trailOpen, setTrailOpen] = useState(false);
  const [trailRows, setTrailRows] = useState<ChatAuditRow[] | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, pending, error]);

  const errorMessage = useMemo(() => {
    if (!error) return null;
    if (error === "rate_limited") return dict.errorRateLimited;
    if (error === "chat_unavailable") return dict.errorUnavailable;
    return dict.errorGeneric;
  }, [error, dict]);

  // Core send — accepts an explicit text override so retry can replay the
  // last user message without reading from the input field.
  const sendText = useCallback(
    async (text: string) => {
      if (!text || pending) return;
      const userMessage: ChatMessage = { role: "user", content: text };
      const nextMessages: ChatMessage[] = [...messages, userMessage].slice(
        -MAX_HISTORY,
      );
      setMessages(nextMessages);
      setInput("");
      setPending(true);
      setError(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locale, messages: nextMessages, sessionId }),
        });
        const data = (await res.json()) as ChatResponse;
        if (!data.ok) {
          setError(data.error);
          return;
        }
        setMessages((prev) => {
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: data.reply,
          };
          return [...prev, assistantMessage].slice(-MAX_HISTORY);
        });
      } catch {
        setError("chat_failed");
      } finally {
        setPending(false);
      }
    },
    [messages, locale, pending, sessionId],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sendText(text);
  }, [input, sendText]);

  const retry = useCallback(() => {
    // The last user message is the one that failed. Drop the failed user turn,
    // re-send identical content.
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const lastUser = messages[messages.length - 1 - lastUserIdx];
    if (!lastUser) return;
    setMessages((prev) => prev.slice(0, -1));
    setError(null);
    sendText(lastUser.content);
  }, [messages, sendText]);

  // Listen for "open-chat with this prompt" requests from elsewhere on the
  // page (currently fired by the Templates section cards). Opens the panel
  // and sends the prompt as if the visitor had typed it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      if (!detail?.prompt) return;
      setOpen(true);
      setTrailOpen(false);
      // Defer send so the panel mounts before the request fires.
      setTimeout(() => sendText(detail.prompt!.trim()), 60);
    };
    window.addEventListener("loucels:open-chat", handler);
    return () => window.removeEventListener("loucels:open-chat", handler);
  }, [sendText]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const loadTrail = useCallback(async () => {
    if (!sessionId) return;
    setTrailOpen(true);
    setTrailLoading(true);
    setTrailError(null);
    try {
      const res = await fetch(
        `/api/chat/audit-trail?sessionId=${encodeURIComponent(sessionId)}`,
      );
      const data = (await res.json()) as
        | { ok: true; rows: ChatAuditRow[] }
        | { ok: false; error: string };
      if (!data.ok) {
        setTrailError(dict.errorGeneric);
        setTrailRows([]);
        return;
      }
      setTrailRows(data.rows);
    } catch {
      setTrailError(dict.errorGeneric);
      setTrailRows([]);
    } finally {
      setTrailLoading(false);
    }
  }, [sessionId, dict]);

  return (
    <>
      {/* Floating bubble */}
      <div className="fixed bottom-5 right-5 z-50">
        {!open && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full bg-cyan-400/40"
          />
        )}
        <button
          type="button"
          aria-label={dict.bubbleLabel}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            background:
              "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)",
          }}
          className="relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg shadow-cyan-500/40 ring-1 ring-white/20 transition-all hover:scale-105 hover:shadow-xl hover:shadow-cyan-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2"
        >
          {open ? <X size={22} /> : <MessageCircle size={22} />}
        </button>
      </div>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={dict.panelTitle}
          className="fixed bottom-24 right-5 z-50 flex w-[calc(100vw-2.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-cyan-500/10 backdrop-blur-xl"
          style={{ height: "min(580px, calc(100vh - 8rem))" }}
        >
          {/* Top gradient accent bar */}
          <div
            aria-hidden
            className="h-[2px] w-full"
            style={{
              background:
                "linear-gradient(90deg, #06B6D4 0%, #7C3AED 50%, #06B6D4 100%)",
            }}
          />

          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <div
                aria-hidden
                className="mt-0.5 h-7 w-7 shrink-0 rounded-full ring-1 ring-white/10"
                style={{
                  background:
                    "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)",
                }}
              />
              <div>
                <p className="text-sm font-semibold tracking-tight text-zinc-100">
                  {dict.panelTitle}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {dict.panelSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label={dict.close}
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages OR Audit-trail overlay */}
          {!trailOpen ? (
            <div
              ref={scrollerRef}
              className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900/40 px-4 py-4 text-sm"
            >
              <MessageBubble role="assistant" content={dict.greeting} bookCta={dict.bookCta} />
              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} bookCta={dict.bookCta} />
              ))}
              {pending && <TypingIndicator />}
              {errorMessage && (
                <div className="flex flex-col items-start gap-2 rounded-md border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                  <span>{errorMessage}</span>
                  {error !== "chat_unavailable" && messages.length > 0 && (
                    <button
                      type="button"
                      onClick={retry}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/40 bg-rose-950/60 px-2 py-1 text-[11px] font-medium text-rose-100 transition-colors hover:bg-rose-900/60"
                    >
                      <RotateCw size={12} />
                      {dict.retry}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <AuditTrailPanel
              rows={trailRows}
              loading={trailLoading}
              error={trailError}
              dict={dict}
              onBack={() => setTrailOpen(false)}
            />
          )}

          {/* Input */}
          <div className="border-t border-zinc-800/80 bg-zinc-900/40 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={dict.placeholder}
                disabled={pending}
                maxLength={2000}
                className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 disabled:opacity-50"
              />
              <button
                type="button"
                aria-label={dict.send}
                onClick={send}
                disabled={pending || !input.trim()}
                style={{
                  background:
                    !pending && input.trim()
                      ? "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)"
                      : undefined,
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-md shadow-cyan-500/20 ring-1 ring-white/10 transition-all hover:scale-105 hover:shadow-cyan-500/40 disabled:bg-zinc-800 disabled:opacity-50 disabled:ring-zinc-700"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[10px] uppercase tracking-wider text-zinc-600">
              <span>Powered by Claude · Governed by Loucells Core</span>
              <span aria-hidden>·</span>
              <a
                href={`/${locale}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-zinc-400 hover:underline"
              >
                {dict.privacy}
              </a>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={loadTrail}
                disabled={!sessionId || trailLoading}
                className="inline-flex items-center gap-1 underline-offset-2 transition-colors hover:text-cyan-400 hover:underline disabled:opacity-40"
              >
                <Shield size={9} strokeWidth={2.2} />
                {dict.auditTrail}
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function AuditTrailPanel({
  rows,
  loading,
  error,
  dict,
  onBack,
}: {
  rows: ChatAuditRow[] | null;
  loading: boolean;
  error: string | null;
  dict: ChatDict;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800/60 px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
        >
          <ArrowLeft size={12} />
          {dict.auditBack}
        </button>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cyan-400">
          <Shield size={11} strokeWidth={2.2} />
          <span>{dict.auditTitle}</span>
        </div>
      </div>
      <p className="border-b border-zinc-800/40 bg-zinc-900/30 px-4 py-2 text-[11px] leading-snug text-zinc-500">
        {dict.auditSubtitle}
      </p>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-xs">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1 text-zinc-500">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
          </div>
        )}
        {error && (
          <p className="rounded-md border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-rose-200">
            {error}
          </p>
        )}
        {!loading && !error && rows && rows.length === 0 && (
          <p className="px-2 py-4 text-center text-zinc-500">
            {dict.auditEmpty}
          </p>
        )}
        {!loading &&
          !error &&
          rows &&
          rows.map((row, i) => <AuditRowCard key={i} row={row} />)}
      </div>
    </div>
  );
}

function AuditRowCard({ row }: { row: ChatAuditRow }) {
  const isDeny = row.decision === "DENY";
  const kind = row.reason.split(":")[0] ?? row.reason;
  const seq =
    row.workspace_sequence !== null && row.workspace_sequence !== undefined
      ? `#${row.workspace_sequence}`
      : "—";
  const time = new Date(row.inserted_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const hashShort = row.prev_row_hash ? row.prev_row_hash.slice(0, 10) : null;

  return (
    <article
      className={`rounded-md border px-3 py-2 ${
        isDeny
          ? "border-rose-900/50 bg-rose-950/30"
          : "border-zinc-800/60 bg-zinc-900/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider">
        <span className="font-mono text-zinc-500">{seq}</span>
        <span className="text-zinc-500">{time}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-semibold ${
            isDeny
              ? "bg-rose-900/40 text-rose-300"
              : "bg-emerald-900/40 text-emerald-300"
          }`}
        >
          {row.decision}
        </span>
      </div>
      <p className="mt-1.5 text-zinc-200">
        <span className="text-cyan-400">{row.source}</span>
        <span className="text-zinc-500"> · </span>
        <span>{kind}</span>
        {row.blocked_by && (
          <>
            <span className="text-zinc-500"> · blocked_by=</span>
            <span className="text-rose-300">{row.blocked_by}</span>
          </>
        )}
      </p>
      {row.redaction_count !== null && row.redaction_count > 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          PII redactions: {row.redaction_count}
        </p>
      )}
      {(row.token_usage_in || row.token_usage_out) && (
        <p className="mt-1 text-[11px] text-zinc-500">
          tokens: {row.token_usage_in ?? 0} in / {row.token_usage_out ?? 0} out
        </p>
      )}
      {hashShort && (
        <p
          className="mt-1.5 truncate font-mono text-[10px] text-zinc-600"
          title={row.prev_row_hash ?? ""}
        >
          chain: {hashShort}…
        </p>
      )}
    </article>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-center gap-1 rounded-2xl rounded-bl-sm border border-zinc-800/60 bg-zinc-900/80 px-3.5 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  bookCta,
}: {
  role: "user" | "assistant";
  content: string;
  bookCta: string;
}) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-white shadow-md shadow-cyan-500/20 ring-1 ring-white/10"
          style={{
            background: "linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)",
          }}
        >
          <RichText text={content} bookCta={bookCta} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-zinc-800/60 bg-zinc-900/80 px-3.5 py-2 text-zinc-100">
        <RichText text={content} bookCta={bookCta} />
      </div>
    </div>
  );
}

/**
 * Inline rendering of message text:
 *  - URLs that start with the Cal.com booking base become a styled
 *    "Book your call →" button (cleaner UX than a 250-char URL pasted in).
 *  - Other URLs are linkified as underlined plain links.
 *  - Everything else renders as text with whitespace preserved.
 */
function RichText({ text, bookCta }: { text: string; bookCta: string }) {
  const calBase = siteConfig.calUrl;
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const parts = text.split(urlRegex);

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (!urlRegex.test(part)) {
          return <span key={i}>{part}</span>;
        }
        // Cal.com booking link → styled CTA button
        if (part.startsWith(calBase)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="my-2 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-white shadow-md shadow-cyan-500/30 ring-1 ring-white/10 transition-all hover:scale-[1.02] hover:shadow-cyan-500/50"
              style={{
                background:
                  "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)",
              }}
            >
              {bookCta}
              <ArrowRight size={12} />
            </a>
          );
        }
        // Other URLs → plain underlined link
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:no-underline"
          >
            {part}
          </a>
        );
      })}
    </span>
  );
}
