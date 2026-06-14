import Link from "next/link";
import {
  DollarSign,
  Clock,
  Users,
  Bot,
  Activity,
  AlertTriangle,
  Bell,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { getCrmOverview } from "@/lib/admin/crm";
import { formatUsdFromCents, daysAgo } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Dashboard — Loucells Core admin",
  robots: { index: false, follow: false },
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  booking_status: string | null;
  created_at: string;
};

export default async function DashboardPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" subtitle="Your command center" />
        <EmptyState title="Dashboard unavailable" description="The read-only data connection isn't configured." />
      </div>
    );
  }

  // Server component re-renders per request, so a request-time clock read
  // is the intended behavior here (the compiler's purity rule is overly
  // strict for RSC data fetching).
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [overview, agentsRes, pendingRes, leadsRes, weekLeadsRes] = await Promise.all([
    getCrmOverview(sb),
    sb.from("client_agents").select("status"),
    sb.from("pending_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb
      .from("leads")
      .select("id, name, email, source, booking_status, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
  ]);

  const { accounts, pipeline, dueTasks } = overview;
  const agents = (agentsRes.data as Array<{ status: string }>) ?? [];
  const liveAgents = agents.filter((a) => a.status === "live").length;
  const pendingApprovals = pendingRes.count ?? 0;
  const recentLeads = (leadsRes.data as LeadRow[]) ?? [];
  const leadsThisWeek = weekLeadsRes.count ?? 0;

  const totalMrrCents = accounts.reduce((s, a) => s + a.metrics.mrrCents, 0);
  const activeAccounts = accounts.filter((a) => a.lifecycle === "active").length;
  const hoursSaved = accounts.reduce((s, a) => s + a.metrics.hoursSaved, 0);
  const bookings = accounts.reduce((s, a) => s + a.metrics.bookings, 0);
  const churnAccounts = accounts.filter((a) => a.metrics.churnRisk);

  // open deals = anything not in a terminal lane
  const TERMINAL = new Set(["converted_to_build", "declined", "abandoned", "sow_voided", "payment_failed"]);
  const openDeals = pipeline.filter((d) => !TERMINAL.has(d.status)).length;

  const attentionCount = dueTasks.length + churnAccounts.length + pendingApprovals;

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="Your command center" />

      {/* Headline KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard tone="hero" label="MRR" value={formatUsdFromCents(totalMrrCents)} icon={<DollarSign className="size-4" />} sub={`${activeAccounts} active · ${accounts.length} accounts`} />
        <KpiCard tone="cyan" label="Hours saved · 30d" value={String(hoursSaved)} icon={<Clock className="size-4" />} />
        <KpiCard tone="emerald" label="Leads · 7d" value={String(leadsThisWeek)} icon={<Inbox className="size-4" />} sub={`${bookings} bookings · 30d`} />
        <KpiCard tone="violet" label="Live agents" value={String(liveAgents)} icon={<Bot className="size-4" />} sub={`${agents.length} provisioned`} />
      </section>

      {/* Needs attention */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <Bell className="size-4" /> Needs your attention
          {attentionCount > 0 && (
            <span className="tabular-nums rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{attentionCount}</span>
          )}
        </h2>
        {attentionCount === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-5 text-sm text-emerald-800">
            All clear — no follow-ups due, no quiet accounts, no pending approvals.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {/* Follow-ups */}
            <Link href="/admin/crm" className="group rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Follow-ups due</span>
                <AlertTriangle className={`size-4 ${dueTasks.length > 0 ? "text-amber-500" : "text-neutral-300"}`} />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">{dueTasks.length}</p>
              <p className="mt-1 truncate text-[11px] text-neutral-500">
                {dueTasks[0] ? `${dueTasks[0].accountName} — ${dueTasks[0].title}` : "Nothing due"}
              </p>
            </Link>
            {/* Pending approvals */}
            <Link href="/admin/agents" className="group rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Pending approvals</span>
                <Inbox className={`size-4 ${pendingApprovals > 0 ? "text-cyan-500" : "text-neutral-300"}`} />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">{pendingApprovals}</p>
              <p className="mt-1 text-[11px] text-neutral-500">HITL actions awaiting sign-off</p>
            </Link>
            {/* Churn risk */}
            <Link href="/admin/crm" className="group rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Churn risk</span>
                <AlertTriangle className={`size-4 ${churnAccounts.length > 0 ? "text-rose-500" : "text-neutral-300"}`} />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">{churnAccounts.length}</p>
              <p className="mt-1 truncate text-[11px] text-neutral-500">
                {churnAccounts[0] ? `${churnAccounts[0].name} has gone quiet` : "All accounts active"}
              </p>
            </Link>
          </div>
        )}
      </section>

      {/* Two columns: pipeline snapshot + recent leads */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Pipeline snapshot */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Pipeline</h2>
            <Link href="/admin/crm" className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:text-cyan-800">
              Open CRM <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-neutral-900">{openDeals}</span>
              <span className="text-sm text-neutral-500">open {openDeals === 1 ? "deal" : "deals"}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">{pipeline.length} total engagements across all stages</p>
            {pipeline[0] && (
              <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-800">{pipeline[0].accountName}</p>
                  <p className="font-mono text-[10px] text-neutral-400">{pipeline[0].engagementRef}</p>
                </div>
                <StatusBadge status={pipeline[0].status} />
              </div>
            )}
          </div>
        </section>

        {/* Recent leads */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Recent leads</h2>
            <Link href="/admin/chat-pulse" className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:text-cyan-800">
              Chat pulse <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {recentLeads.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-400">No leads yet.</div>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
              {recentLeads.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">{l.name || l.email || "—"}</p>
                    <p className="text-[11px] text-neutral-400">{(l.source ?? "").replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {l.booking_status && <StatusBadge status={l.booking_status} />}
                    <span className="text-[10px] tabular-nums text-neutral-400">{daysAgo(l.created_at) ?? 0}d</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Quick links */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/admin/crm", label: "CRM", icon: <Users className="size-4" /> },
          { href: "/admin/agents", label: "Agents", icon: <Bot className="size-4" /> },
          { href: "/admin/revenue", label: "Revenue", icon: <DollarSign className="size-4" /> },
          { href: "/admin/chat-pulse", label: "Chat pulse", icon: <Activity className="size-4" /> },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:border-cyan-300 hover:text-cyan-700"
          >
            <span className="text-neutral-400">{q.icon}</span>
            {q.label}
          </Link>
        ))}
      </section>
    </div>
  );
}
