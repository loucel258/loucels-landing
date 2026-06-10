"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Bot, Sparkles } from "lucide-react";

type ActivityItem = {
  id: string;
  insertedAt: string;
  role: "user" | "assistant" | "tool" | "system_event";
  sessionId: string;
  preview: string;
};

const POLL_INTERVAL_MS = 10_000;

export function LiveActivityFeed({
  slug,
  initial,
  lang,
  emptyLabel,
}: {
  slug: string;
  initial: ActivityItem[];
  lang: "en" | "es";
  emptyLabel: string;
}) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetch(`/api/portal/${slug}/activity`, { cache: "no-store" });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) setItems(data.items);
        }
      } catch {
        // network blip — keep current items, try again next tick
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    }

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  if (items.length === 0) {
    return <p className="py-3 text-xs italic text-neutral-500">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {items.slice(0, 6).map((a) => (
        <ActivityRow key={a.id} item={a} lang={lang} />
      ))}
    </ul>
  );
}

function ActivityRow({ item, lang }: { item: ActivityItem; lang: "en" | "es" }) {
  const isUser = item.role === "user";
  const isAssistant = item.role === "assistant";
  const ts = new Date(item.insertedAt);
  const tsStr = ts.toLocaleTimeString(lang === "es" ? "es-ES" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-neutral-100 text-neutral-600"
            : isAssistant
              ? "bg-gradient-to-br from-cyan-500 to-violet-500 text-white"
              : "bg-amber-100 text-amber-700"
        }`}
      >
        {isUser ? (
          <MessageSquare className="size-3.5" />
        ) : isAssistant ? (
          <Bot className="size-3.5" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-neutral-700">
          <span className="font-semibold text-neutral-900">
            {isUser
              ? lang === "es" ? "Visitante" : "Visitor"
              : isAssistant
                ? lang === "es" ? "Agente" : "Agent"
                : lang === "es" ? "Sistema" : "System"}
          </span>{" "}
          · {item.preview}
        </p>
        <p className="text-[10px] text-neutral-500">{tsStr}</p>
      </div>
    </li>
  );
}
