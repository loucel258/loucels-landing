import { notFound, redirect } from "next/navigation";
import { BarChart3, TrendingUp, MessageCircle, CheckCircle2 } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { resolvePortalLang } from "@/lib/portal/lang";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { t } from "@/lib/portal/strings";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { Metric, MetricRow } from "@/components/workspace/metric";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MessageRow = {
  session_id: string;
  role: string;
  cipher_b64: string;
  inserted_at: string;
};

type LeadRow = {
  session_id: string;
  booking_status: string;
  created_at: string;
};

const TOPIC_BUCKETS: Array<{ id: string; en: string; es: string; keywords: string[] }> = [
  { id: "booking", en: "Booking", es: "Citas", keywords: ["book", "appointment", "schedule", "available", "cita", "agendar", "reservar", "disponibilidad"] },
  { id: "pricing", en: "Pricing", es: "Precios", keywords: ["price", "cost", "how much", "fee", "precio", "costo", "tarifa", "cuánto"] },
  { id: "hours", en: "Hours / location", es: "Horario / dirección", keywords: ["open", "hours", "location", "address", "abierto", "horario", "dirección"] },
  { id: "service_info", en: "Service info", es: "Info del servicio", keywords: ["service", "treatment", "procedure", "info", "what is", "servicio", "tratamiento", "qué es"] },
  { id: "complaint", en: "Issue / complaint", es: "Problema / queja", keywords: ["complaint", "problem", "issue", "refund", "queja", "problema", "reembolso"] },
];

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return null;
  const lang = await resolvePortalLang(slug);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const engagementId = (access as { engagement_id: string }).engagement_id;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [msgRes, leadsRes] = await Promise.all([
    sb
      .from("conversation_messages")
      .select("session_id, role, cipher_b64, inserted_at")
      .eq("engagement_id", engagementId)
      .gte("inserted_at", since)
      .limit(2000),
    sb
      .from("leads")
      .select("session_id, booking_status, created_at")
      .eq("engagement_id", engagementId)
      .gte("created_at", since)
      .limit(2000),
  ]);

  const messages = (msgRes.data as MessageRow[]) ?? [];
  const leads = (leadsRes.data as LeadRow[]) ?? [];

  // ---- Hourly distribution ----
  const hourly = new Array(24).fill(0);
  const sessions = new Set<string>();
  for (const m of messages) {
    sessions.add(m.session_id);
    if (m.role === "user") {
      const h = new Date(m.inserted_at).getHours();
      hourly[h] += 1;
    }
  }
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const maxHourly = Math.max(...hourly, 1);

  // ---- Funnel ----
  // Visits = sessions, Conversations = sessions with ≥3 messages,
  // Engaged = sessions linked to a lead, Booked = leads confirmed
  const sessionMsgCount = new Map<string, number>();
  for (const m of messages) {
    sessionMsgCount.set(m.session_id, (sessionMsgCount.get(m.session_id) ?? 0) + 1);
  }
  const totalSessions = sessions.size;
  const meaningfulConversations = [...sessionMsgCount.values()].filter((n) => n >= 3).length;
  const leadSessions = new Set(leads.map((l) => l.session_id));
  const bookings = leads.filter((l) => l.booking_status === "confirmed").length;

  // ---- Topic buckets ----
  // Decrypt only the first user message per session for topic classification.
  // Bounded to ~200 sessions to keep this cheap.
  const topicCounts = new Map<string, number>();
  let topicOther = 0;
  if (encryptionAvailable()) {
    const firstUserPerSession = new Map<string, MessageRow>();
    for (const m of messages.sort((a, b) => new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime())) {
      if (m.role !== "user") continue;
      if (!firstUserPerSession.has(m.session_id)) firstUserPerSession.set(m.session_id, m);
    }
    let processed = 0;
    for (const [, m] of firstUserPerSession) {
      if (processed >= 200) break;
      processed += 1;
      let plain = "";
      try {
        plain = decryptMessage(engagementId, m.cipher_b64).toLowerCase();
      } catch {
        continue;
      }
      const matched = TOPIC_BUCKETS.find((b) => b.keywords.some((k) => plain.includes(k)));
      if (matched) {
        topicCounts.set(matched.id, (topicCounts.get(matched.id) ?? 0) + 1);
      } else {
        topicOther += 1;
      }
    }
  }

  const totalTopicHits = [...topicCounts.values()].reduce((a, b) => a + b, 0) + topicOther;

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t(lang, "analytics.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t(lang, "analytics.desc")}</p>
      </header>

      <MetricRow>
        <Metric
          label={lang === "es" ? "Sesiones · 30d" : "Sessions · 30d"}
          value={totalSessions}
          tone="accent"
          icon={<MessageCircle className="size-4" />}
        />
        <Metric
          label={lang === "es" ? "Conversaciones útiles" : "Meaningful conversations"}
          value={meaningfulConversations}
          sub={lang === "es" ? "≥3 mensajes" : "≥3 messages"}
          tone="neutral"
        />
        <Metric
          label={lang === "es" ? "Citas confirmadas" : "Bookings confirmed"}
          value={bookings}
          tone="emerald"
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label={lang === "es" ? "Hora pico" : "Peak hour"}
          value={`${peakHour.toString().padStart(2, "0")}:00`}
          sub={hourly[peakHour] > 0 ? `${hourly[peakHour]} ${lang === "es" ? "mensajes" : "messages"}` : undefined}
          tone="violet"
          icon={<TrendingUp className="size-4" />}
        />
      </MetricRow>

      <PanelGrid cols={2}>
        <Panel
          title={t(lang, "analytics.hourly_title")}
          eyebrow={t(lang, "analytics.hourly_desc")}
          icon={<BarChart3 className="size-4" />}
        >
          {hourly.every((v) => v === 0) ? (
            <EmptyPanel icon={<BarChart3 className="size-5" />} title={t(lang, "analytics.empty")} />
          ) : (
            <div className="flex items-end gap-1 pt-2">
              {hourly.map((v, h) => {
                const pct = (v / maxHourly) * 100;
                return (
                  <div key={h} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-cyan-400 to-violet-500 transition-all"
                      style={{ height: `${Math.max(2, pct)}%`, minHeight: "2px" }}
                      title={`${h.toString().padStart(2, "0")}:00 — ${v}`}
                    />
                    {h % 4 === 0 && (
                      <span className="text-[9px] text-neutral-500">{h.toString().padStart(2, "0")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={t(lang, "analytics.funnel_title")} eyebrow="">
          <ul className="space-y-3">
            <FunnelStep
              label={lang === "es" ? "Sesiones iniciadas" : "Sessions started"}
              value={totalSessions}
              base={totalSessions}
              color="bg-cyan-500"
            />
            <FunnelStep
              label={lang === "es" ? "Conversaciones útiles" : "Meaningful conversations"}
              value={meaningfulConversations}
              base={totalSessions}
              color="bg-cyan-400"
            />
            <FunnelStep
              label={lang === "es" ? "Leads capturados" : "Leads captured"}
              value={leadSessions.size}
              base={totalSessions}
              color="bg-violet-500"
            />
            <FunnelStep
              label={lang === "es" ? "Citas confirmadas" : "Bookings confirmed"}
              value={bookings}
              base={totalSessions}
              color="bg-emerald-500"
            />
          </ul>
        </Panel>
      </PanelGrid>

      <Panel title={t(lang, "analytics.topics_title")} eyebrow={t(lang, "analytics.topics_desc")}>
        {totalTopicHits === 0 ? (
          <EmptyPanel icon={<BarChart3 className="size-5" />} title={t(lang, "analytics.empty")} />
        ) : (
          <ul className="space-y-2.5">
            {TOPIC_BUCKETS.map((b) => {
              const count = topicCounts.get(b.id) ?? 0;
              const pct = totalTopicHits > 0 ? (count / totalTopicHits) * 100 : 0;
              return (
                <li key={b.id}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-neutral-800">{lang === "es" ? b.es : b.en}</span>
                    <span className="tabular-nums text-neutral-500">
                      {count} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
            {topicOther > 0 && (
              <li>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-neutral-500">
                    {lang === "es" ? "Otros" : "Other"}
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    {topicOther} · {((topicOther / totalTopicHits) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full bg-neutral-400"
                    style={{ width: `${(topicOther / totalTopicHits) * 100}%` }}
                  />
                </div>
              </li>
            )}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  base,
  color,
}: {
  label: string;
  value: number;
  base: number;
  color: string;
}) {
  const pct = base > 0 ? (value / base) * 100 : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-neutral-800">{label}</span>
        <span className="tabular-nums text-neutral-500">
          {value} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </li>
  );
}
