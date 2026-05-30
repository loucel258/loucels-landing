#!/usr/bin/env bash
# =============================================================================
# verify-trust-stack.sh
# =============================================================================
# End-to-end smoke test for all P0/P1 fixes shipped 2026-05-25.
# Run AFTER `npm run dev` is up on localhost:3000 AND migrations 013-017
# have been applied to your Supabase project.
#
# Usage:
#   ./scripts/verify-trust-stack.sh                  # localhost
#   BASE_URL=https://… ./scripts/verify-trust-stack.sh   # preview deploy
#
# Exits non-zero if any test fails. Each test prints PASS / FAIL.
# =============================================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

c_red()   { printf "\033[31m%s\033[0m" "$1"; }
c_green() { printf "\033[32m%s\033[0m" "$1"; }
c_dim()   { printf "\033[2m%s\033[0m"  "$1"; }

# Assert helper. Args: <label> <expected_http> <actual_http>
assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf "  %s  %s  %s\n" "$(c_green "PASS")" "$label" "$(c_dim "(HTTP $actual)")"
    PASS=$((PASS+1))
  else
    printf "  %s  %s  %s\n" "$(c_red   "FAIL")" "$label" "$(c_dim "(expected $expected, got $actual)")"
    FAIL=$((FAIL+1))
  fi
}

# Capture HTTP status only.
status_of() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo
echo "================================================================="
echo " Trust Stack verification against $BASE_URL"
echo "================================================================="

# -----------------------------------------------------------------------------
# 1. P0 A — JWT required on every Trust Stack endpoint
# -----------------------------------------------------------------------------
echo
echo "P0 A — JWT required on Trust Stack endpoints (expect 401)"

for route in \
  "/api/demo/dlp/preview" \
  "/api/demo/dlp" \
  "/api/demo/hitl/propose" \
  "/api/demo/hitl/decide"; do
  s=$(status_of -X POST "$BASE_URL$route" \
       -H "content-type: application/json" \
       -d '{}')
  assert_status "POST $route without JWT" 401 "$s"
done

s=$(status_of "$BASE_URL/api/demo/hitl/queue")
assert_status "GET /api/demo/hitl/queue without JWT" 401 "$s"

# -----------------------------------------------------------------------------
# 2. Mint a workspace JWT
# -----------------------------------------------------------------------------
echo
echo "Auth — mint workspace JWT"

token_response=$(curl -s -X POST "$BASE_URL/api/demo/auth" \
  -H "content-type: application/json" \
  -d '{"workspace_id":"ws_demo_001","role_label":"front_desk_agent"}')
TOKEN=$(printf "%s" "$token_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [[ -z "$TOKEN" ]]; then
  printf "  %s  could not mint JWT — auth endpoint returned: %s\n" "$(c_red "FAIL")" "$token_response"
  FAIL=$((FAIL+1))
  echo
  echo "Aborting further tests (no token)."
  echo "Summary: $PASS pass / $FAIL fail"
  exit 1
fi
printf "  %s  workspace JWT minted (%s chars)\n" "$(c_green "PASS")" "${#TOKEN}"
PASS=$((PASS+1))

# Supervisor token for HITL paths
sup_response=$(curl -s -X POST "$BASE_URL/api/demo/auth" \
  -H "content-type: application/json" \
  -d '{"workspace_id":"ws_demo_001","role_label":"supervisor"}')
SUP_TOKEN=$(printf "%s" "$sup_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# -----------------------------------------------------------------------------
# 3. P0 A continued — endpoints accept valid JWT
# -----------------------------------------------------------------------------
echo
echo "P0 A — endpoints accept valid JWT"

s=$(status_of -X POST "$BASE_URL/api/demo/dlp/preview" \
     -H "content-type: application/json" \
     -H "authorization: Bearer $TOKEN" \
     -d '{"prompt":"hello"}')
assert_status "DLP preview with JWT"   200 "$s"

s=$(status_of "$BASE_URL/api/demo/hitl/queue" \
     -H "authorization: Bearer $SUP_TOKEN")
assert_status "HITL queue with JWT"    200 "$s"

# -----------------------------------------------------------------------------
# 4. P0 A — cross-tenant guard on /decide
# -----------------------------------------------------------------------------
echo
echo "P0 A — cross-tenant guard (decide a non-existent UUID → 200/4xx, never 5xx)"

fake_uuid="00000000-0000-0000-0000-000000000000"
s=$(status_of -X POST "$BASE_URL/api/demo/hitl/decide" \
     -H "content-type: application/json" \
     -H "authorization: Bearer $SUP_TOKEN" \
     -d "{\"id\":\"$fake_uuid\",\"status\":\"approved\"}")
# Acceptable: 400 (invalid id format check), 404, or 200 with ok:false.
# NOT acceptable: 500 (unhandled).
if [[ "$s" == "200" || "$s" == "400" || "$s" == "404" ]]; then
  printf "  %s  decide non-existent id %s\n" "$(c_green "PASS")" "$(c_dim "(HTTP $s)")"
  PASS=$((PASS+1))
else
  printf "  %s  decide non-existent id %s\n" "$(c_red "FAIL")" "$(c_dim "(unexpected HTTP $s)")"
  FAIL=$((FAIL+1))
fi

# -----------------------------------------------------------------------------
# 5. P1 #6 — rate limiter on /api/demo/auth (30 burst, refill 30/min)
# -----------------------------------------------------------------------------
echo
echo "P1 #6 — rate limit kicks in on auth mint (burst 30)"

throttled=0
for i in $(seq 1 40); do
  s=$(status_of -X POST "$BASE_URL/api/demo/auth" \
       -H "content-type: application/json" \
       -d '{"workspace_id":"ws_demo_001"}')
  if [[ "$s" == "429" ]]; then
    throttled=$((throttled+1))
  fi
done
if [[ $throttled -ge 5 ]]; then
  printf "  %s  saw %d × 429 in 40 calls\n" "$(c_green "PASS")" "$throttled"
  PASS=$((PASS+1))
else
  printf "  %s  expected ≥5 throttled responses, got %d\n" "$(c_red "FAIL")" "$throttled"
  FAIL=$((FAIL+1))
fi

# -----------------------------------------------------------------------------
# 6. Admin sweep endpoint — auth gated
# -----------------------------------------------------------------------------
echo
echo "Admin sweep — auth gated"

s=$(status_of -X POST "$BASE_URL/api/admin/hitl/sweep")
# 403 if a secret is configured but missing; 500 if no secret configured.
if [[ "$s" == "403" || "$s" == "500" ]]; then
  printf "  %s  sweep refused without secret %s\n" "$(c_green "PASS")" "$(c_dim "(HTTP $s)")"
  PASS=$((PASS+1))
else
  printf "  %s  sweep returned %s without secret — should be 403/500\n" "$(c_red "FAIL")" "$s"
  FAIL=$((FAIL+1))
fi

# -----------------------------------------------------------------------------
# 7. Layer 1 sanitizer end-to-end (DLP preview returns redactions)
# -----------------------------------------------------------------------------
echo
echo "DLP sanitizer end-to-end"

dlp_response=$(curl -s -X POST "$BASE_URL/api/demo/dlp/preview" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"prompt":"SSN 234-56-7890 and email a@b.com"}')

if printf "%s" "$dlp_response" | grep -q '"totalRedactions"'; then
  count=$(printf "%s" "$dlp_response" | sed -n 's/.*"totalRedactions":\([0-9]*\).*/\1/p')
  if [[ "${count:-0}" -ge 1 ]]; then
    printf "  %s  DLP returned %s redaction(s)\n" "$(c_green "PASS")" "$count"
    PASS=$((PASS+1))
  else
    printf "  %s  DLP returned 0 redactions on a PII prompt\n" "$(c_red "FAIL")"
    FAIL=$((FAIL+1))
  fi
else
  printf "  %s  DLP response had no totalRedactions key\n" "$(c_red "FAIL")"
  FAIL=$((FAIL+1))
fi

# =============================================================================
echo
echo "================================================================="
echo " Summary: $(c_green "$PASS pass") · $(c_red "$FAIL fail")"
echo "================================================================="
echo
echo "Note: Layer 2 fail-closed, sweeper end-to-end, edit-introduces-PII, and"
echo "decided_at consistency are easier to verify manually with the SQL editor —"
echo "see landing/REVIEW-2026-05-26.md for the procedures."

[[ $FAIL -eq 0 ]]
