import { describe, it, expect } from "vitest";
import {
  originAllowedForAgent,
  canonicalizeOrigin,
  type ResolvedAgent,
} from "@/lib/agents/resolver";

function makeAgent(allowedOrigins: string[]): ResolvedAgent {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "test-agent",
    workspaceId: "ws_client_test_agent",
    engagementId: "00000000-0000-0000-0000-000000000002",
    name: "Test Agent",
    agentType: "ai_front_desk",
    status: "live",
    systemPrompt: null,
    allowedOrigins,
    toolsEnabled: [],
    greetingMessage: null,
    brandColor: null,
    maxTokens: 1024,
    language: "en",
    retentionDays: 90,
    minutesPerConv: 5,
    monthlyTokenBudget: 2_000_000,
  };
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://api.example.com/api/agent/test-agent/chat", {
    method: "POST",
    headers,
  });
}

describe("originAllowedForAgent", () => {
  const agent = makeAgent(["https://client-site.com"]);

  it("allows an exact allowlisted origin", () => {
    const req = makeRequest({ origin: "https://client-site.com" });
    expect(originAllowedForAgent(req, agent)).toBe(true);
  });

  it("rejects a non-allowlisted origin", () => {
    const req = makeRequest({ origin: "https://evil.com" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("rejects when no Origin and no Referer (fail closed)", () => {
    const req = makeRequest({});
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("rejects the literal 'null' origin (sandboxed iframe / file://)", () => {
    const req = makeRequest({ origin: "null" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("rejects everything when allowlist is empty (deliberate opt-in)", () => {
    const empty = makeAgent([]);
    const req = makeRequest({ origin: "https://client-site.com" });
    expect(originAllowedForAgent(req, empty)).toBe(false);
  });

  it("normalizes case on the incoming origin", () => {
    const req = makeRequest({ origin: "https://CLIENT-SITE.com" });
    expect(originAllowedForAgent(req, agent)).toBe(true);
  });

  it("tolerates a trailing slash stored in allowed_origins", () => {
    const slashed = makeAgent(["https://client-site.com/"]);
    const req = makeRequest({ origin: "https://client-site.com" });
    expect(originAllowedForAgent(req, slashed)).toBe(true);
  });

  it("does not match a subdomain not in the allowlist", () => {
    const req = makeRequest({ origin: "https://sub.client-site.com" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("does not match a different port", () => {
    const req = makeRequest({ origin: "https://client-site.com:8443" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("falls back to Referer when Origin is absent (same-origin GET)", () => {
    const req = makeRequest({ referer: "https://client-site.com/some/page?q=1" });
    expect(originAllowedForAgent(req, agent)).toBe(true);
  });

  it("rejects a Referer from a non-allowlisted site", () => {
    const req = makeRequest({ referer: "https://evil.com/page" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("rejects a malformed Referer (fail closed)", () => {
    const req = makeRequest({ referer: "not-a-url" });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("prefers Origin over Referer when both present", () => {
    const req = makeRequest({
      origin: "https://evil.com",
      referer: "https://client-site.com/page",
    });
    expect(originAllowedForAgent(req, agent)).toBe(false);
  });

  it("skips malformed entries in allowed_origins without throwing", () => {
    const messy = makeAgent(["not a url", "https://client-site.com"]);
    const req = makeRequest({ origin: "https://client-site.com" });
    expect(originAllowedForAgent(req, messy)).toBe(true);
  });
});

describe("canonicalizeOrigin", () => {
  it("returns the lowercased origin for a valid https URL", () => {
    expect(canonicalizeOrigin("https://Client-Site.com/path?x=1")).toBe(
      "https://client-site.com",
    );
  });

  it("accepts http for local development origins", () => {
    expect(canonicalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects the wildcard", () => {
    expect(canonicalizeOrigin("*")).toBeNull();
  });

  it("rejects the literal 'null'", () => {
    expect(canonicalizeOrigin("null")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(canonicalizeOrigin("ftp://files.example.com")).toBeNull();
    expect(canonicalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(canonicalizeOrigin("file:///etc/passwd")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(canonicalizeOrigin("")).toBeNull();
    expect(canonicalizeOrigin("   ")).toBeNull();
    expect(canonicalizeOrigin("not a url")).toBeNull();
  });
});
