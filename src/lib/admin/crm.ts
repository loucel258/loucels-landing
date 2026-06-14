import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CRM read layer for /admin. Everything here is COMPUTED from the existing
 * source-of-truth tables (engagements, client_agents, leads, audit_logs) +
 * the thin CRM relationship tables (crm_accounts/notes/tasks from migration
 * 044). No metric is denormalized, so nothing can drift.
 *
 * Scale assumption: a low number of accounts (this is a boutique studio,
 * not a marketplace). So we fetch the few base tables in full and aggregate
 * in memory rather than issuing N+1 per-account metric queries. If the book
 * of business ever grows past a few hundred accounts, move the rollups into
 * a SQL view or materialized aggregate.
 */

const METRIC_WINDOW_DAYS = 30;
const CHURN_LOOKBACK_DAYS = 14;

export type Lifecycle = "prospect" | "active" | "dormant" | "churned";

export type AccountMetrics = {
  /** distinct conversation sessions across the account's agents (window) */
  conversations: number;
  /** conversations × minutes_saved / 60, rounded */
  hoursSaved: number;
  /** leads created outside 8am-6pm ET or on weekends (window) */
  afterHoursLeads: number;
  /** confirmed bookings tied to the account's engagements (window) */
  bookings: number;
  /** sum of active monthly retainers, in cents */
  mrrCents: number;
  /** true when a paying account has gone quiet — retainer active but no
   *  conversation in the churn-lookback window */
  churnRisk: boolean;
};

export type AccountSummary = {
  id: string;
  name: string;
  contactEmail: string | null;
  vertical: string | null;
  lifecycle: Lifecycle;
  engagementCount: number;
  activeAgentCount: number;
  latestStatus: string | null;
  updatedAt: string;
  metrics: AccountMetrics;
};

export type PipelineDeal = {
  engagementId: string;
  engagementRef: string;
  accountId: string | null;
  accountName: string;
  type: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
};

export type DueTask = {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  dueDate: string | null;
  kind: string;
  overdue: boolean;
};

type EngagementRow = {
  id: string;
  engagement_ref: string;
  account_id: string | null;
  client_legal_name: string;
  client_email: string | null;
  engagement_type: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
};

type AgentRow = {
  engagement_id: string | null;
  workspace_id: string;
  monthly_retainer_cents: number | null;
  retainer_active: boolean | null;
  minutes_saved_per_conversation: number | null;
};

type AuditRow = { workspace_id: string; user_id: string | null; inserted_at: string };
type LeadRow = {
  engagement_id: string | null;
  created_at: string;
  booking_status: string | null;
  confirmed_at: string | null;
};

/** ET hour (0-23) + weekend flag for an ISO timestamp. */
function etTimeParts(iso: string): { hour: number; weekend: boolean } {
  const d = new Date(iso);
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(d);
  const weekdayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(d);
  const hour = parseInt(hourStr, 10) % 24;
  const weekend = weekdayStr === "Sat" || weekdayStr === "Sun";
  return { hour, weekend };
}

function isAfterHours(iso: string): boolean {
  const { hour, weekend } = etTimeParts(iso);
  return weekend || hour < 8 || hour >= 18;
}

/**
 * The CRM hub payload: account portfolio (with rollup metrics), the deal
 * pipeline grouped by status, and the follow-ups due now. One round of
 * base-table fetches powers all three.
 */
export async function getCrmOverview(sb: SupabaseClient): Promise<{
  accounts: AccountSummary[];
  pipeline: PipelineDeal[];
  dueTasks: DueTask[];
}> {
  const windowSince = new Date(Date.now() - METRIC_WINDOW_DAYS * 86400_000).toISOString();
  const churnSince = new Date(Date.now() - CHURN_LOOKBACK_DAYS * 86400_000).toISOString();

  const [accountsRes, engRes, agentRes, auditRes, leadRes, taskRes] = await Promise.all([
    sb.from("crm_accounts").select("*").order("updated_at", { ascending: false }),
    sb
      .from("engagements")
      .select(
        "id, engagement_ref, account_id, client_legal_name, client_email, engagement_type, status, created_at, delivered_at",
      )
      .order("created_at", { ascending: false }),
    sb
      .from("client_agents")
      .select("engagement_id, workspace_id, monthly_retainer_cents, retainer_active, minutes_saved_per_conversation"),
    sb
      .from("audit_logs")
      .select("workspace_id, user_id, inserted_at")
      .gte("inserted_at", windowSince)
      .limit(20000),
    sb
      .from("leads")
      .select("engagement_id, created_at, booking_status, confirmed_at")
      .gte("created_at", windowSince)
      .limit(10000),
    sb
      .from("crm_tasks")
      .select("id, account_id, title, due_date, kind, status")
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false }),
  ]);

  const accounts = (accountsRes.data as Array<{
    id: string;
    account_name: string;
    primary_contact_email: string | null;
    vertical: string | null;
    lifecycle: Lifecycle;
    updated_at: string;
  }>) ?? [];
  const engagements = (engRes.data as EngagementRow[]) ?? [];
  const agents = (agentRes.data as AgentRow[]) ?? [];
  const audits = (auditRes.data as AuditRow[]) ?? [];
  const leads = (leadRes.data as LeadRow[]) ?? [];
  const openTasks = (taskRes.data as Array<{
    id: string;
    account_id: string;
    title: string;
    due_date: string | null;
    kind: string;
    status: string;
  }>) ?? [];

  // ── index maps ──
  const engByAccount = new Map<string, EngagementRow[]>();
  const accountByEngagement = new Map<string, string>();
  for (const e of engagements) {
    if (e.account_id) {
      (engByAccount.get(e.account_id) ?? engByAccount.set(e.account_id, []).get(e.account_id)!).push(e);
      accountByEngagement.set(e.id, e.account_id);
    }
  }

  // agent → which account (via engagement); also workspace → minutes_saved
  const agentsByAccount = new Map<string, AgentRow[]>();
  const minutesByWorkspace = new Map<string, number>();
  const workspaceToAccount = new Map<string, string>();
  for (const a of agents) {
    minutesByWorkspace.set(a.workspace_id, a.minutes_saved_per_conversation ?? 0);
    const acc = a.engagement_id ? accountByEngagement.get(a.engagement_id) : undefined;
    if (acc) {
      (agentsByAccount.get(acc) ?? agentsByAccount.set(acc, []).get(acc)!).push(a);
      workspaceToAccount.set(a.workspace_id, acc);
    }
  }

  // conversation sessions per account (distinct user_id within window) +
  // most-recent activity per account (for churn signal)
  const sessionsByAccount = new Map<string, Set<string>>();
  const recentSessionByAccount = new Map<string, boolean>();
  for (const r of audits) {
    const acc = workspaceToAccount.get(r.workspace_id);
    if (!acc || !r.user_id) continue;
    (sessionsByAccount.get(acc) ?? sessionsByAccount.set(acc, new Set()).get(acc)!).add(r.user_id);
    if (r.inserted_at >= churnSince) recentSessionByAccount.set(acc, true);
  }

  // leads per account (after-hours + bookings)
  const afterHoursByAccount = new Map<string, number>();
  const bookingsByAccount = new Map<string, number>();
  for (const l of leads) {
    const acc = l.engagement_id ? accountByEngagement.get(l.engagement_id) : undefined;
    if (!acc) continue;
    if (isAfterHours(l.created_at)) {
      afterHoursByAccount.set(acc, (afterHoursByAccount.get(acc) ?? 0) + 1);
    }
    if (l.booking_status === "confirmed") {
      bookingsByAccount.set(acc, (bookingsByAccount.get(acc) ?? 0) + 1);
    }
  }

  const summaries: AccountSummary[] = accounts.map((acc) => {
    const accEngs = engByAccount.get(acc.id) ?? [];
    const accAgents = agentsByAccount.get(acc.id) ?? [];
    const sessions = sessionsByAccount.get(acc.id) ?? new Set<string>();

    // hours saved: distinct sessions × that account's representative
    // minutes_saved (use the max across its agents — the headline rate)
    const minutes = accAgents.reduce(
      (m, a) => Math.max(m, a.minutes_saved_per_conversation ?? 0),
      0,
    );
    const conversations = sessions.size;
    const hoursSaved = Math.round((conversations * minutes) / 60);

    const mrrCents = accAgents.reduce(
      (sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents ?? 0 : 0),
      0,
    );
    const activeAgentCount = accAgents.filter((a) => a.retainer_active).length;
    const hasActiveRetainer = mrrCents > 0;
    const churnRisk = hasActiveRetainer && !recentSessionByAccount.get(acc.id);

    return {
      id: acc.id,
      name: acc.account_name,
      contactEmail: acc.primary_contact_email,
      vertical: acc.vertical,
      lifecycle: acc.lifecycle,
      engagementCount: accEngs.length,
      activeAgentCount,
      latestStatus: accEngs[0]?.status ?? null,
      updatedAt: acc.updated_at,
      metrics: {
        conversations,
        hoursSaved,
        afterHoursLeads: afterHoursByAccount.get(acc.id) ?? 0,
        bookings: bookingsByAccount.get(acc.id) ?? 0,
        mrrCents,
        churnRisk,
      },
    };
  });

  const accountNameById = new Map(accounts.map((a) => [a.id, a.account_name]));
  const pipeline: PipelineDeal[] = engagements.map((e) => ({
    engagementId: e.id,
    engagementRef: e.engagement_ref,
    accountId: e.account_id,
    accountName: e.account_id ? accountNameById.get(e.account_id) ?? e.client_legal_name : e.client_legal_name,
    type: e.engagement_type,
    status: e.status,
    createdAt: e.created_at,
    deliveredAt: e.delivered_at,
  }));

  const todayIso = new Date().toISOString().slice(0, 10);
  const dueTasks: DueTask[] = openTasks
    .filter((t) => !t.due_date || t.due_date <= todayIso)
    .map((t) => ({
      id: t.id,
      accountId: t.account_id,
      accountName: accountNameById.get(t.account_id) ?? "—",
      title: t.title,
      dueDate: t.due_date,
      kind: t.kind,
      overdue: !!t.due_date && t.due_date < todayIso,
    }));

  return { accounts: summaries, pipeline, dueTasks };
}

export type AccountDetail = {
  account: {
    id: string;
    name: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    vertical: string | null;
    language: string;
    lifecycle: Lifecycle;
    createdAt: string;
  };
  engagements: PipelineDeal[];
  metrics: AccountMetrics;
  notes: Array<{ id: string; body: string; author: string; createdAt: string }>;
  tasks: Array<{ id: string; title: string; dueDate: string | null; kind: string; status: string; overdue: boolean }>;
};

export async function getAccountDetail(
  sb: SupabaseClient,
  accountId: string,
): Promise<AccountDetail | null> {
  const windowSince = new Date(Date.now() - METRIC_WINDOW_DAYS * 86400_000).toISOString();
  const churnSince = new Date(Date.now() - CHURN_LOOKBACK_DAYS * 86400_000).toISOString();

  const { data: acc } = await sb
    .from("crm_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return null;
  const account = acc as {
    id: string;
    account_name: string;
    primary_contact_name: string | null;
    primary_contact_email: string | null;
    primary_contact_phone: string | null;
    vertical: string | null;
    language: string;
    lifecycle: Lifecycle;
    created_at: string;
  };

  const { data: engData } = await sb
    .from("engagements")
    .select(
      "id, engagement_ref, account_id, client_legal_name, client_email, engagement_type, status, created_at, delivered_at",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  const engagements = (engData as EngagementRow[]) ?? [];
  const engIds = engagements.map((e) => e.id);

  const { data: agentData } = engIds.length
    ? await sb
        .from("client_agents")
        .select("engagement_id, workspace_id, monthly_retainer_cents, retainer_active, minutes_saved_per_conversation")
        .in("engagement_id", engIds)
    : { data: [] };
  const agents = (agentData as AgentRow[]) ?? [];
  const workspaceIds = agents.map((a) => a.workspace_id);

  const [auditRes, leadRes, notesRes, tasksRes] = await Promise.all([
    workspaceIds.length
      ? sb
          .from("audit_logs")
          .select("user_id, inserted_at")
          .in("workspace_id", workspaceIds)
          .gte("inserted_at", windowSince)
          .limit(20000)
      : Promise.resolve({ data: [] as Array<{ user_id: string | null; inserted_at: string }> }),
    engIds.length
      ? sb
          .from("leads")
          .select("created_at, booking_status")
          .in("engagement_id", engIds)
          .gte("created_at", windowSince)
          .limit(10000)
      : Promise.resolve({ data: [] as Array<{ created_at: string; booking_status: string | null }> }),
    sb.from("crm_notes").select("id, body, author, created_at").eq("account_id", accountId).order("created_at", { ascending: false }),
    sb.from("crm_tasks").select("id, title, due_date, kind, status").eq("account_id", accountId).order("created_at", { ascending: false }),
  ]);

  const audits = (auditRes.data as Array<{ user_id: string | null; inserted_at: string }>) ?? [];
  const sessions = new Set<string>();
  let recentSession = false;
  for (const r of audits) {
    if (r.user_id) sessions.add(r.user_id);
    if (r.inserted_at >= churnSince) recentSession = true;
  }
  const minutes = agents.reduce((m, a) => Math.max(m, a.minutes_saved_per_conversation ?? 0), 0);
  const conversations = sessions.size;
  const leadsArr = (leadRes.data as Array<{ created_at: string; booking_status: string | null }>) ?? [];
  const afterHoursLeads = leadsArr.filter((l) => isAfterHours(l.created_at)).length;
  const bookings = leadsArr.filter((l) => l.booking_status === "confirmed").length;
  const mrrCents = agents.reduce((s, a) => s + (a.retainer_active ? a.monthly_retainer_cents ?? 0 : 0), 0);

  const todayIso = new Date().toISOString().slice(0, 10);
  const accountName = account.account_name;

  return {
    account: {
      id: account.id,
      name: accountName,
      contactName: account.primary_contact_name,
      contactEmail: account.primary_contact_email,
      contactPhone: account.primary_contact_phone,
      vertical: account.vertical,
      language: account.language,
      lifecycle: account.lifecycle,
      createdAt: account.created_at,
    },
    engagements: engagements.map((e) => ({
      engagementId: e.id,
      engagementRef: e.engagement_ref,
      accountId: e.account_id,
      accountName,
      type: e.engagement_type,
      status: e.status,
      createdAt: e.created_at,
      deliveredAt: e.delivered_at,
    })),
    metrics: {
      conversations,
      hoursSaved: Math.round((conversations * minutes) / 60),
      afterHoursLeads,
      bookings,
      mrrCents,
      churnRisk: mrrCents > 0 && !recentSession,
    },
    notes: ((notesRes.data as Array<{ id: string; body: string; author: string; created_at: string }>) ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author,
      createdAt: n.created_at,
    })),
    tasks: ((tasksRes.data as Array<{ id: string; title: string; due_date: string | null; kind: string; status: string }>) ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      kind: t.kind,
      status: t.status,
      overdue: t.status === "open" && !!t.due_date && t.due_date < todayIso,
    })),
  };
}
