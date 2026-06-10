"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, X, Loader2 } from "lucide-react";

const TAGS = [
  "complaint",
  "booking",
  "info_request",
  "follow_up",
  "spam",
  "vip",
  "urgent",
  "sale_lost",
  "sale_won",
] as const;

type Tag = (typeof TAGS)[number];

export function TagBar({
  slug,
  sessionId,
  appliedTags,
  labels,
}: {
  slug: string;
  sessionId: string;
  appliedTags: string[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Tag | null>(null);
  const [_pending, startTransition] = useTransition();

  async function toggle(tag: Tag) {
    setBusy(tag);
    const isApplied = appliedTags.includes(tag);
    try {
      if (isApplied) {
        await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/tag?tag=${tag}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/tag`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag }),
        });
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <Tag className="size-3" />
        Tags
      </span>
      {TAGS.map((tag) => {
        const active = appliedTags.includes(tag);
        const isBusy = busy === tag;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            disabled={isBusy}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
              active
                ? "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-300"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 ring-1 ring-transparent"
            } ${isBusy ? "opacity-60" : ""}`}
          >
            {isBusy && <Loader2 className="size-3 animate-spin" />}
            {!isBusy && active && <X className="size-3" />}
            {labels[tag] ?? tag}
          </button>
        );
      })}
    </div>
  );
}
