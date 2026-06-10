# Client onboarding runbook

The exact sequence to take a signed client from zero to a live embedded
agent. Every step is admin-UI driven (no SQL since 2026-06-10). Skipping
steps is how prod incidents happen — follow the order.

## 0. Prerequisites (once per client)

- [ ] Engagement row exists (`/admin/new-engagement` — fires automatically
      from DocuSign/Stripe webhooks for standard deals).
- [ ] Client's website domain(s) confirmed in writing (needed for the
      origin allowlist — ask for EVERY domain variant they serve the
      site from: apex, `www.`, landing-page subdomains).

## 1. Create the agent — `/admin/agents` → "New agent"

- Pick the engagement, name the agent (client-facing, e.g. "Denise"),
  choose the type, accept or adjust the suggested slug.
- Agent starts in `designing`. Nothing is public yet.

## 2. Configure — `/admin/agent/<id>` → Configuration panel

- [ ] **Persona**: brand voice + scope. It is wrapped in the Trust Stack
      safety base automatically — write only the business-specific part.
- [ ] **Greeting message** in the client's primary language.
- [ ] **Brand color** (their hex, not ours).
- [ ] **Allowed origins**: the client's real domains only. NEVER add
      `localhost` to a client agent — use your own dev agent for testing.
- [ ] **Tools**: booking and/or escalation per the SOW.
- [ ] **Monthly token budget**: leave the 2M default unless the plan tier
      says otherwise. This is the margin guardrail.
- Save. Changes apply immediately (cache is invalidated on save).

## 3. Test in shadow / UAT

- Transition `designing → shadow_mode` (timestamps log automatically).
- Test locally against your OWN dev agent first
  (`scripts/dev/test-widget.html` + `python3 -m http.server 8080`).
- For client-agent testing, temporarily add your staging origin, test,
  then REMOVE it before go-live.
- Transition to `uat`; have the client try their real FAQs. Check
  `/admin/agent/<id>` DENY feed for misfires.

## 4. Go live

- The UI enforces the gate: slug + ≥1 origin + persona required.
- Transition to `live`.
- Copy the embed snippet from the Configuration panel and send it to the
  client's webmaster: paste before `</body>`.
- Verify on their live site: widget appears, replies, CORS headers OK.

## 5. Portal access

- Configuration panel → "Generate / rotate portal passcode".
- The passcode shows ONCE. Store it in the password manager under the
  client's name, then send it to the client through a secure channel
  (not plain email if avoidable).
- Portal URL: `https://loucels.com/portal/<slug>`.
- Walk the client through: Resumen (ROI), Bandeja (conversations +
  take-over), Requiere acción (approvals), Integrations (their embed
  snippet + authorized domains).

## 6. Post-launch checklist

- [ ] First real conversation visible in the portal Bandeja.
- [ ] Audit chain recording (`/admin/agent/<id>` KPIs populate).
- [ ] Budget tracking running (usage > 0 in agent_usage_monthly).
- [ ] Client knows how to take over a conversation and approve actions.
- [ ] Calendar reminder: 7-day check-in on escalation rate.

## Troubleshooting quick refs

| Symptom | Likely cause |
| --- | --- |
| Widget doesn't appear on client site | Origin not in allowlist (check exact scheme + subdomain), or agent not `live` |
| Widget worked, now replies "high volume" | Monthly token budget exhausted — review usage, raise budget or discuss tier |
| Client can't log into portal | Passcode rotated since; rotate again and resend |
| Config change not taking effect | Should be instant via cache invalidation; if editing SQL directly (don't), wait 60s |
