import { MessageSquare, ArrowUpRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { BarStrip } from "@/components/workspace/sparkline";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate, daysAgo } from "@/lib/admin/format";
import type { AuditLogRow } from "../types";

export function ConversationsTab({
  workspaceId,
  audit,
}: {
  workspaceId: string | null;
  audit: AuditLogRow[];
}) {
  if (!workspaceId) {
    return (
      <EmptyPanel
        icon={<MessageSquare className="size-5" />}
        title="No agent deployed yet"
        description="When you deploy an agent for this engagement, conversations land here in real time with replay, audit chain, and review tags."
      />
    );
  }

  // Group by session
  const bySession = new Map<string, AuditLogRow[]>();
  for (const row of audit) {
    if (!row.user_id) continue;
    const list = bySession.get(row.user_id) ?? [];
    list.push(row);
    bySession.set(row.user_id, list);
  }

  const sessions = [...bySession.entries()]
    .map(([sessionId, rows]) => {
      const sorted = rows.sort(
        (a, b) => new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime(),
      );
      const allows = sorted.filter((r) => r.decision === "ALLOW").length;
      const denies = sorted.filter((r) => r.decision === "DENY").length;
      const escalated = sorted.some((r) => r.blocked_by === "agent_escalation");
      const piiBlocked = sorted.some((r) => r.blocked_by === "dlp_layer1" || r.blocked_by === "dlp_layer2");
      return {
        sessionId,
        startedAt: sorted[0]!.inserted_at,
        lastAt: sorted[sorted.length - 1]!.inserted_at,
        messageCount: sorted.length,
        allows,
        denies,
        escalated,
        piiBlocked,
      };
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  const totalSessions = sessions.length;
  const totalAllows = audit.filter((r) => r.decision === "ALLOW").length;
  const totalDenies = audit.filter((r) => r.decision === "DENY").length;
  const totalEscalated = sessions.filter((s) => s.escalated).length;
  const resolutionRate = totalSessions > 0 ? ((totalSessions - totalEscalated) / totalSessions) * 100 : 0;
  const escalationRate = totalSessions > 0 ? (totalEscalated / totalSessions) * 100 : 0;
  const avgMsgs = totalSessions > 0 ? audit.length / totalSessions : 0;

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Sessions (30d)"
          value={totalSessions}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label="Avg messages / session"
          value={avgMsgs.toFixed(1)}
          sub="ALLOW + DENY decisions"
          tone="neutral"
        />
        <Metric
          label="Resolution rate"
          value={`${resolutionRate.toFixed(0)}%`}
          sub={`${totalSessions - totalEscalated} of ${totalSessions} closed without human`}
          tone={resolutionRate >= 70 ? "emerald" : resolutionRate >= 50 ? "amber" : "rose"}
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Escalation rate"
          value={`${escalationRate.toFixed(0)}%`}
          sub={`${totalEscalated} session${totalEscalated === 1 ? "" : "s"} reached human`}
          tone="violet"
          icon={<ArrowUpRight className="size-4" />}
        />
      </MetricRow>

      <Panel title="Decision distribution" eyebrow="Audit chain summary">
        <BarStrip
          segments={[
            { label: "Allowed", value: totalAllows, color: "bg-emerald-500" },
            { label: "Denied", value: totalDenies, color: "bg-rose-500" },
          ]}
        />
        <p className="mt-3 text-[10px] text-neutral-500">
          Every chat turn lands in the immutable audit_logs chain. Denies break down by reason in the Audit tab.
        </p>
      </Panel>

      <Panel
        title="Recent sessions"
        eyebrow={`Last ${Math.min(sessions.length, 25)}`}
        icon={<MessageSquare className="size-4" />}
      >
        {sessions.length === 0 ? (
          <EmptyPanel
            icon={<MessageSquare className="size-5" />}
            title="No conversations yet in this window"
            description="Sessions show up here within seconds of the agent receiving a user message."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="px-2 py-2 font-semibold">Session</th>
                  <th className="px-2 py-2 font-semibold">Started</th>
                  <th className="px-2 py-2 font-semibold">Messages</th>
                  <th className="px-2 py-2 font-semibold">Outcome</th>
                  <th className="px-2 py-2 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sessions.slice(0, 25).map((s) => (
                  <tr key={s.sessionId} className="hover:bg-neutral-50">
                    <td className="px-2 py-2 font-mono text-[10px] text-neutral-700">
                      {s.sessionId.slice(0, 24)}…
                    </td>
                    <td className="px-2 py-2 text-neutral-700">{formatShortDate(s.startedAt)}</td>
                    <td className="px-2 py-2 tabular-nums">{s.messageCount}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.escalated && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                            <ArrowUpRight className="size-2.5" /> escalated
                          </span>
                        )}
                        {s.piiBlocked && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                            <AlertCircle className="size-2.5" /> PII block
                          </span>
                        )}
                        {!s.escalated && !s.piiBlocked && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <CheckCircle2 className="size-2.5" /> resolved
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-neutral-500">
                      {daysAgo(s.lastAt)}d ago
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
