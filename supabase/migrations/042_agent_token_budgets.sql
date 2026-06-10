-- 042_agent_token_budgets.sql
-- Per-tenant monthly token budget (closes review finding H2 / business
-- risk B2). The retainer is a fixed price but Anthropic cost scales with
-- usage — without a ceiling, one high-traffic tenant erodes the margin
-- of the whole book. The chat route checks the running monthly total
-- before each Claude call and degrades to a polite "contact us" reply
-- once the budget is exhausted.

-- 1. Budget column. Default 2M tokens/month ≈ comfortable for an SMB
--    front-desk agent (a heavy month of ~4-5k conversations on Haiku).
--    Adjust per tenant according to their plan tier.
alter table public.client_agents
  add column if not exists monthly_token_budget bigint not null default 2000000;

-- 2. Usage counter, one row per (workspace, calendar month). Atomic
--    upserts via the RPC below; read path is a single PK lookup.
create table if not exists public.agent_usage_monthly (
  workspace_id  text not null,
  month         date not null,            -- first day of the month (UTC)
  tokens_in     bigint not null default 0,
  tokens_out    bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, month)
);

alter table public.agent_usage_monthly enable row level security;

-- Lesson from migrations 032/037/039: grants in the SAME migration.
grant insert, select, update, delete on public.agent_usage_monthly to service_role;

-- 3. Atomic increment. Called after each Claude turn with actual usage.
create or replace function public.increment_agent_usage(
  p_workspace_id text,
  p_tokens_in    bigint,
  p_tokens_out   bigint
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.agent_usage_monthly (workspace_id, month, tokens_in, tokens_out, updated_at)
  values (p_workspace_id, date_trunc('month', now())::date, p_tokens_in, p_tokens_out, now())
  on conflict (workspace_id, month) do update
    set tokens_in  = agent_usage_monthly.tokens_in  + excluded.tokens_in,
        tokens_out = agent_usage_monthly.tokens_out + excluded.tokens_out,
        updated_at = now();
$$;

revoke all on function public.increment_agent_usage(text, bigint, bigint) from public;
grant execute on function public.increment_agent_usage(text, bigint, bigint) to service_role;

comment on table public.agent_usage_monthly is
  'Running monthly token totals per agent workspace. Source: increment_agent_usage RPC called by the agent chat route after each Claude turn. Enforced against client_agents.monthly_token_budget.';
