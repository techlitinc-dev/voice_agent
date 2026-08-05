/**
 * Vaani AI — minimal TypeScript SDK for the public REST API v1.
 * Zero dependencies (fetch). Copy this file into your project or import it directly.
 *
 *   import { VaaniClient } from "./sdk/vaani";
 *   const vaani = new VaaniClient({ apiKey: process.env.VAANI_API_KEY!, baseUrl: "https://app.vaani.ai" });
 *   const calls = await vaani.listCalls({ limit: 10 });
 */

export type VaaniClientOptions = { apiKey: string; baseUrl: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string }; status: number };

export type VaaniAgent = {
  id: string; name: string; template: string | null; status: string; version: number;
  languageMode: string; voiceId: string; llmModel: string; createdAt: string;
};

export type VaaniCampaign = {
  id: string; name: string; type: string; status: string; agentId: string; listId: string;
  callsPerMinute: number; concurrency: number; createdAt: string;
};

export type VaaniContact = {
  id: string; phone: string; name: string | null; listId: string | null;
  timezone: string | null; dnc: boolean; attributes: unknown; createdAt: string;
};

export type VaaniCall = {
  id: string; direction: string; status: string; fromNumber: string; toNumber: string;
  agentId: string | null; campaignId: string | null; durationSec: number;
  outcome: string | null; sentiment: string | null; scriptAdherenceScore: number | null;
  billedPaise: number; createdAt: string;
};

export type VaaniNumber = {
  id: string; number: string; label: string | null; numberType: string;
  agentId: string | null; monthlyRentPaise: number; createdAt: string;
};

export type ContactInput = {
  phone: string; name?: string; listId?: string; timezone?: string; attributes?: Record<string, unknown>;
};

export class VaaniClient {
  constructor(private opts: VaaniClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string } }
      | null;
    if (!json) return { ok: false, error: { code: "bad_response", message: `HTTP ${res.status}` }, status: res.status };
    if (!json.ok) return { ok: false, error: json.error, status: res.status };
    return { ok: true, data: json.data };
  }

  listAgents() { return this.request<VaaniAgent[]>("GET", "/agents"); }
  createAgent(input: { name: string; systemPrompt: string; greeting: string; template?: string; languageMode?: string; fixedLanguage?: string; voiceId?: string; llmModel?: string }) {
    return this.request<VaaniAgent>("POST", "/agents", input);
  }

  listCampaigns() { return this.request<VaaniCampaign[]>("GET", "/campaigns"); }
  createCampaign(input: { name: string; agentId: string; listId: string; type?: string; callsPerMinute?: number; concurrency?: number }) {
    return this.request<VaaniCampaign>("POST", "/campaigns", input);
  }

  listContacts() { return this.request<VaaniContact[]>("GET", "/contacts"); }
  /** Bulk import/upsert up to 1000 contacts. */
  importContacts(contacts: ContactInput[]) {
    return this.request<{ created: number; updated: number }>("POST", "/contacts", { contacts });
  }

  listCalls(filter?: { status?: string; direction?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (filter?.status) qs.set("status", filter.status);
    if (filter?.direction) qs.set("direction", filter.direction);
    if (filter?.limit) qs.set("limit", String(filter.limit));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    return this.request<VaaniCall[]>("GET", `/calls${suffix}`);
  }
  /** Trigger one outbound call (honors server-side CAMPAIGN_DRY_RUN). */
  triggerCall(input: { to: string; agentId: string }) {
    return this.request<{ callId: string; dryRun?: boolean; workflowRunId?: number }>("POST", "/calls", input);
  }

  listNumbers() { return this.request<VaaniNumber[]>("GET", "/numbers"); }
  registerNumber(input: { number: string; label?: string; agentId?: string }) {
    return this.request<VaaniNumber>("POST", "/numbers", input);
  }
}
