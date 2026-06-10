import { notFound, redirect } from "next/navigation";
import { ShieldCheck, CheckCircle2, Clock } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t, pl, type PortalLang } from "@/lib/portal/strings";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { ApprovalCard, type ApprovalLabels } from "./approval-card";
import { daysAgo } from "@/lib/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApprovalRow = {
  id: string;
  workspace_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  decider_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  risk_score: number | null;
  risk_flags: string[];
};

/** strings.ts is server-only; the client card receives its copy as props. */
function buildApprovalLabels(lang: PortalLang): ApprovalLabels {
  return {
    actions: {
      send_message: t(lang, "ra.action.send_message"),
      send_quote: t(lang, "ra.action.send_quote"),
      send_refund: t(lang, "ra.action.send_refund"),
      reply_review: t(lang, "ra.action.reply_review"),
    },
    riskHigh: t(lang, "ra.high_risk"),
    riskMedium: t(lang, "ra.medium_risk"),
    proposedLabel: t(lang, "ra.proposed_label"),
    originalMessage: t(lang, "ra.proposed_label"),
    editLabel: t(lang, "ra.edit_label"),
    rejectLabel: t(lang, "ra.reject_label"),
    rejectPlaceholder: t(lang, "ra.reject_placeholder"),
    btnApprove: t(lang, "ra.btn_approve"),
    btnModify: t(lang, "ra.btn_modify"),
    btnReject: t(lang, "ra.btn_reject"),
    btnApproveEdited: t(lang, "ra.btn_approve_edited"),
    btnConfirmReject: t(lang, "ra.btn_confirm_reject"),
    btnCancel: t(lang, "ra.btn_cancel"),
    btnBack: t(lang, "ra.btn_back"),
    realtimeHint: t(lang, "ra.realtime_hint"),
    stubHint: t(lang, "ra.stub_hint"),
    approvedRealtime: t(lang, "ra.approved_realtime"),
    approvedStub: t(lang, "ra.approved_stub"),
    approvedRealtimeDesc: t(lang, "ra.approved_realtime_desc"),
    approvedStubDesc: t(lang, "ra.approved_stub_desc"),
    rejected: t(lang, "ra.rejected"),
    rejectedDesc: t(lang, "ra.rejected_desc"),
    errorText: t(lang, "ra.error"),
  };
}

export default async function RequiereAccionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return null;
  const lang = await resolvePortalLang(slug);
  const labels = buildApprovalLabels(lang);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const { data: agents } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);
  const wsIds = ((agents as Array<{ workspace_id: string }>) ?? []).map((a) => a.workspace_id);

  if (wsIds.length === 0) {
    return (
      <div className="space-y-6">
        <Header empty lang={lang} />
        <Panel>
          <EmptyPanel
            icon={<ShieldCheck className="size-5" />}
            title={t(lang, "ra.clear_title")}
            description={t(lang, "ra.subtitle_no_agent")}
          />
        </Panel>
      </div>
    );
  }

  const { data: pendingData } = await sb
    .from("pending_approvals")
    .select("*")
    .in("workspace_id", wsIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const { data: recentData } = await sb
    .from("pending_approvals")
    .select("*")
    .in("workspace_id", wsIds)
    .neq("status", "pending")
    .order("decided_at", { ascending: false })
    .limit(20);

  const pending = (pendingData as ApprovalRow[]) ?? [];
  const recent = (recentData as ApprovalRow[]) ?? [];

  return (
    <div className="space-y-6">
      <Header pendingCount={pending.length} lang={lang} />

      {pending.length === 0 ? (
        <Panel tone="success">
          <div className="flex items-center gap-4 py-4">
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-md shadow-emerald-500/30">
              <CheckCircle2 className="size-7" />
            </span>
            <div>
              <p className="text-lg font-bold text-neutral-900">{t(lang, "ra.clear_title")}</p>
              <p className="text-sm text-neutral-600">{t(lang, "ra.clear_desc")}</p>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <ApprovalCard key={p.id} approval={p} slug={slug} labels={labels} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Panel
          title={t(lang, "ra.history_title")}
          eyebrow={t(lang, "ra.history_eyebrow")}
          icon={<Clock className="size-4" />}
        >
          <ul className="divide-y divide-neutral-100">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        r.status === "approved"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {r.status === "approved" ? t(lang, "ra.approved_stub") : t(lang, "ra.rejected")}
                    </span>
                    <span className="text-neutral-700">
                      {labels.actions[r.action_type] ?? r.action_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-neutral-500">
                    {r.proposed_text}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-neutral-500">
                  {r.decided_at ? `${daysAgo(r.decided_at)}d` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Header({
  pendingCount,
  empty,
  lang,
}: {
  pendingCount?: number;
  empty?: boolean;
  lang: PortalLang;
}) {
  return (
    <header>
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
        {t(lang, "ra.title")}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        {empty
          ? t(lang, "ra.subtitle_no_agent")
          : pendingCount && pendingCount > 0
            ? t(lang, "ra.subtitle_pending", {
                n: pendingCount,
                plural: pl(pendingCount, "s", "es", lang),
              })
            : t(lang, "ra.subtitle_empty")}
      </p>
    </header>
  );
}
