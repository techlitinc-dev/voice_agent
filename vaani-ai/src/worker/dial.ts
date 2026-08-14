/**
 * Dial processors on the shared `campaign-dialer` queue + the `whatsapp-send` queue.
 * Job names "callback-dial" / "manual-dial" are guide 06's contract — payload shapes
 * MUST stay in sync with src/lib/dialJobs.ts.
 */
import type { Job } from "bullmq";
import { PrismaClient, type Agent } from "@prisma/client";
import { dograhTriggerCall } from "../lib/dograh";
import { resolveAgentForCall } from "../lib/ab-test"; // guide 05 A/B + version routing
import { sendWhatsAppGated } from "./whatsapp"; // dry-run gate over guide 04's canonical client
import { parseRetryPolicy, computeNextRetry, isDisposition, type Disposition } from "../lib/campaign/retry";
import { shouldSendWhatsAppFallback } from "../lib/campaign/fallback";
import type {
  DialJobData,
  CallbackDialJobData,
  ManualDialJobData,
  WhatsAppSendJobData,
} from "../lib/queue";

const db = new PrismaClient();
const DRY_RUN = process.env.CAMPAIGN_DRY_RUN !== "false"; // default true — safe
const FORCED = process.env.CAMPAIGN_DRY_RUN_RESULT || ""; // deterministic tests
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Simulated outcome distribution: 70% completed, 15% no-answer, 10% busy, 5% voicemail. */
function simulateResult(): "completed" | Disposition {
  if (FORCED === "completed" || isDisposition(FORCED)) return FORCED as "completed" | Disposition;
  const r = Math.random();
  if (r < 0.7) return "completed";
  if (r < 0.85) return "no-answer";
  if (r < 0.95) return "busy";
  return "voicemail";
}

/** Send the call-to-WhatsApp fallback (readme §9) after a FINAL no-answer.
 *  Never throws; dry-run logs via src/worker/whatsapp.ts. */
export async function maybeSendWhatsAppFallback(input: {
  workspaceId: string;
  campaignId: string;
  phone: string;
  name: string | null;
  retryPolicyJson: unknown;
  disposition: string;
  retryExhausted: boolean;
}): Promise<void> {
  const fb = shouldSendWhatsAppFallback({
    retryPolicyJson: input.retryPolicyJson,
    disposition: input.disposition,
    retryExhausted: input.retryExhausted,
  });
  if (!fb.send || !fb.templateId) return;
  try {
    const tpl = await db.whatsAppTemplate.findFirst({
      where: { id: fb.templateId, workspaceId: input.workspaceId, status: "APPROVED" },
    });
    if (!tpl) {
      log(`[whatsapp-fallback] template ${fb.templateId} missing/not APPROVED — skipped`);
      return;
    }
    const res = await sendWhatsAppGated({
      to: input.phone,
      template: tpl.name,
      params: [input.name ?? "Customer"],
    });
    log(`[whatsapp-fallback] campaign=${input.campaignId} to=${input.phone} template=${tpl.name} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
  } catch (e) {
    console.error("[whatsapp-fallback] failed", e);
  }
}

/**
 * Resolve which Dograh workflow serves an outbound call for `agent`:
 * guide 05's A/B + version routing (resolveAgentForCall) over the agent's
 * PUBLISHED versions, falling back to the agent-level Dograh ids.
 * Returns null when nothing usable is published — caller must NOT dial.
 */
export async function resolveWorkflowForAgent(
  agent: Agent,
  workspaceId: string,
  callerPhone?: string
): Promise<{ dograhWorkflowId: string; dograhWorkflowUuid: string; versionId: string | null } | null> {
  const versions = await db.agentVersion.findMany({
    where: { agentId: agent.id, workspaceId, status: "PUBLISHED" },
    select: { id: true, isAbVariant: true, abTrafficPercent: true, dograhWorkflowId: true, dograhWorkflowUuid: true },
  });
  const resolved = resolveAgentForCall({ agentId: agent.id, callerPhone, publishedVersions: versions });
  const wf = resolved ?? (agent.dograhWorkflowId
    ? { dograhWorkflowId: agent.dograhWorkflowId, dograhWorkflowUuid: agent.dograhWorkflowUuid, versionId: null as string | null }
    : null);
  if (!wf || !wf.dograhWorkflowUuid) return null;
  return { dograhWorkflowId: wf.dograhWorkflowId, dograhWorkflowUuid: wf.dograhWorkflowUuid, versionId: resolved?.versionId ?? null };
}

export async function dialJob(job: Job<DialJobData>): Promise<void> {
  const { campaignContactId } = job.data;
  const cc = await db.campaignContact.findUnique({
    where: { id: campaignContactId },
    include: {
      contact: true,
      campaign: { include: { agent: true } },
    },
  });
  if (!cc) return;
  if (cc.status !== "DIALING") {
    log(`[dial] stale job for ${campaignContactId} (status=${cc.status}) — skipped`);
    return;
  }
  const { campaign, contact } = cc;

  // Dial-time DNC re-check (contact may have opted out since the tick).
  if (contact.dnc || contact.optOutAt) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" } });
    log(`[dial] ${contact.phone}: DNC skip at dial time`);
    return;
  }
  const dnc = await db.dncEntry.findFirst({
    where: { workspaceId: campaign.workspaceId, phone: contact.phone },
    select: { id: true },
  });
  if (dnc) {
    await db.campaignContact.update({ where: { id: cc.id }, data: { status: "SKIPPED_DNC", lastResult: "skipped:dnc" } });
    log(`[dial] ${contact.phone}: DncEntry skip at dial time`);
    return;
  }

  // Caller id for fromNumber/analytics: the pool number claimed by the scheduler,
  // else the workspace's FIRST DID (guide 08 joins Call.fromNumber → PhoneNumber.number,
  // so fromNumber must ALWAYS be a real E.164 number — never a placeholder).
  let fromNumber: string | null = null;
  if (job.data.phoneNumberId) {
    const pn = await db.phoneNumber.findUnique({ where: { id: job.data.phoneNumberId }, select: { number: true } });
    fromNumber = pn?.number ?? null;
  } else {
    const pn = await db.phoneNumber.findFirst({
      where: { workspaceId: campaign.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    });
    fromNumber = pn?.number ?? null;
  }
  if (!fromNumber) {
    await db.campaignContact.update({
      where: { id: cc.id },
      data: { status: "FAILED", lastResult: "failed" },
    });
    log(`[dial] ${contact.phone}: FAILED — no DID in workspace for fromNumber (add one in /campaigns/pools or /numbers)`);
    return;
  }

  let result: "completed" | Disposition;
  let callId: string | null = null;
  if (DRY_RUN) {
    result = simulateResult();
  } else {
    try {
      // A/B + version routing (guide 05): pick the serving published version.
      const wf = await resolveWorkflowForAgent(campaign.agent, campaign.workspaceId, contact.phone);
      if (!wf) throw new Error("agent not published (missing Dograh ids)");
      // Exact Dograh contract (guide 04): POST /api/v1/public/agent/workflow/{uuid}
      // { phone_number, initial_context } → { status, workflow_run_id }.
      // opening_hook / objection_playbook / amd_policy travel in initial_context —
      // the workflow prompt references them (guide 05's builder documents the keys).
      const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
        phoneNumber: contact.phone,
        initialContext: {
          name: contact.name ?? "",
          caller_id: fromNumber,
          opening_hook: campaign.openingHook ?? "",
          objection_playbook: campaign.objectionPlaybook ?? "",
          amd_policy: campaign.amdPolicy, // LEAVE_MESSAGE → agent leaves the template message on voicemail
          campaign_type: campaign.type,
          ...(contact.attributes as Record<string, string> | null ?? {}),
        },
      });
      const call = await db.call.create({
        data: {
          workspaceId: campaign.workspaceId,
          dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`,
          direction: "OUTBOUND",
          status: "RINGING",
          fromNumber,
          toNumber: contact.phone,
          agentId: campaign.agentId,
          agentVersionId: wf.versionId, // A/B attribution (docs 05 §3.8)
          campaignId: campaign.id,
        },
      });
      callId = call.id;
      result = "completed"; // call placed; final outcome arrives via webhook (Step 10 reconciles)
    } catch (e) {
      console.error("[dial] dograh error", e);
      result = "failed"; // infra failure is retryable via policy
    }
  }

  const attempts = cc.attempts + 1;
  const policy = parseRetryPolicy(campaign.retryPolicy);
  const defaults = { maxAttempts: campaign.maxAttempts, retryDelayMin: campaign.retryDelayMin };
  const success = result === "completed";
  const next = success
    ? { retry: false, nextAttemptAt: null }
    : computeNextRetry(policy, result as Disposition, attempts, defaults, new Date(), Math.random);

  await db.campaignContact.update({
    where: { id: cc.id },
    data: {
      attempts,
      lastResult: result,
      lastCallId: callId ?? cc.lastCallId,
      status: success ? "COMPLETED" : next.retry ? "RETRY_SCHEDULED" : "FAILED",
      nextAttemptAt: next.nextAttemptAt,
    },
  });
  log(`[dial] ${contact.phone}: ${result} (attempt ${attempts}/${defaults.maxAttempts}${campaign.predictiveDialing ? ", predictive" : ""})`);
  if (DRY_RUN) {
    // Visibility for the dry-run tests: proves mid-flight script edits + AMD policy
    // reach the dial path (in real mode they travel in initial_context).
    log(`[dial] dry-run context hook="${(campaign.openingHook ?? "").slice(0, 40)}" amd=${campaign.amdPolicy} from=${fromNumber}`);
  }

  await maybeSendWhatsAppFallback({
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    phone: contact.phone,
    name: contact.name,
    retryPolicyJson: campaign.retryPolicy,
    disposition: result,
    retryExhausted: !success && !next.retry,
  });
}

/** guide 06 contract: dial a CallbackTask's phone, mark the task DONE. */
export async function callbackDialJob(job: Job<CallbackDialJobData>): Promise<void> {
  const { workspaceId, callbackTaskId, phone } = job.data;
  // Claim atomically: only the first job flips PENDING → DONE.
  const claim = await db.callbackTask.updateMany({
    where: { id: callbackTaskId, workspaceId, status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });
  if (claim.count === 0) {
    log(`[callback-dial] task ${callbackTaskId} already handled — skipped`);
    return;
  }
  const task = await db.callbackTask.findUnique({ where: { id: callbackTaskId } });
  const fail = async (reason: string, cancel = false) => {
    await db.callbackTask.updateMany({
      where: { id: callbackTaskId },
      data: cancel ? { status: "CANCELLED", completedAt: null } : { status: "PENDING", completedAt: null },
    });
    log(`[callback-dial] ${phone}: ${reason}`);
  };

  const dnc = await db.dncEntry.findFirst({ where: { workspaceId, phone }, select: { id: true } });
  if (dnc) return fail("on DNC — callback cancelled", true);

  // Agent resolution, in priority order: (1) agentId on the job payload (newer
  // guide 06 producers), (2) the campaign's agent when the task came from a
  // campaign, (3) the workspace's inbound agent (first PhoneNumber with an agent).
  let agent: Agent | null = null;
  if (job.data.agentId) {
    agent = await db.agent.findFirst({ where: { id: job.data.agentId, workspaceId, status: "PUBLISHED" } });
  }
  if (!agent && task?.campaignId) {
    const camp = await db.campaign.findUnique({ where: { id: task.campaignId }, include: { agent: true } });
    agent = camp?.agent ?? null;
  }
  if (!agent) {
    const pn = await db.phoneNumber.findFirst({
      where: { workspaceId, agentId: { not: null } },
      include: { agent: true },
    });
    agent = pn?.agent ?? null;
  }
  if (!agent) return fail("no agent available — callback cancelled", true);

  if (DRY_RUN) {
    log(`[callback-dial] DRY RUN → would dial ${phone} (task ${callbackTaskId}${task?.note ? `, note: ${task.note}` : ""}${job.data.reason ? `, reason: ${job.data.reason}` : ""})`);
    return;
  }
  try {
    const wf = await resolveWorkflowForAgent(agent, workspaceId, phone);
    if (!wf) throw new Error("agent not published");
    // fromNumber must be a real E.164 DID (guide 08 joins on it): prefer the DID
    // assigned to the resolved agent, else the workspace's first DID.
    const did = (await db.phoneNumber.findFirst({
      where: { workspaceId, agentId: agent.id },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    })) ?? (await db.phoneNumber.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { number: true },
    }));
    if (!did) {
      await db.callbackTask.updateMany({ where: { id: callbackTaskId }, data: { status: "CANCELLED" } });
      log(`[callback-dial] ${phone}: CANCELLED — no DID in workspace for fromNumber`);
      return;
    }
    const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
      phoneNumber: phone,
      initialContext: { callback_note: task?.note ?? job.data.reason ?? "", is_callback: "true" },
    });
    await db.call.create({
      data: {
        workspaceId,
        dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: did.number,
        toNumber: phone,
        agentId: agent.id,
        campaignId: task?.campaignId ?? null,
      },
    });
    log(`[callback-dial] dialed ${phone} (task ${callbackTaskId})`);
  } catch (e) {
    console.error("[callback-dial] dograh error", e);
    await fail("dial failed — task back to PENDING for job retry");
    throw e; // let BullMQ backoff retry the job
  }
}

/** guide 06 contract: manual click-to-call from the web dialer. */
export async function manualDialJob(job: Job<ManualDialJobData>): Promise<void> {
  const { workspaceId, callId, fromNumber, toNumber } = job.data;
  const call = await db.call.findFirst({ where: { id: callId, workspaceId } });
  if (!call) {
    log(`[manual-dial] call row ${callId} not found in workspace — dropped`);
    return;
  }
  // Worker-side DNC re-check (producer guards too — defense in depth).
  const dnc = await db.dncEntry.findFirst({ where: { workspaceId, phone: toNumber }, select: { id: true } });
  if (dnc) {
    await db.call.update({ where: { id: call.id }, data: { status: "FAILED", outcome: "blocked:dnc" } });
    log(`[manual-dial] ${toNumber} on DNC — call ${callId} marked failed`);
    return;
  }
  const pn = await db.phoneNumber.findFirst({
    where: { workspaceId, number: fromNumber },
    include: { agent: true },
  });
  const agent = pn?.agent;
  if (DRY_RUN) {
    log(`[manual-dial] DRY RUN → would dial ${toNumber} from ${fromNumber} (call ${callId})`);
    return;
  }
  try {
    if (!agent) throw new Error("no agent on that number");
    const wf = await resolveWorkflowForAgent(agent, workspaceId, toNumber);
    if (!wf) throw new Error("no published agent on that number");
    const run = await dograhTriggerCall(wf.dograhWorkflowUuid, {
      phoneNumber: toNumber,
      initialContext: { manual_dial: "true" },
    });
    await db.call.update({
      where: { id: call.id },
      data: { dograhCallId: `${wf.dograhWorkflowId}:${run.workflow_run_id}`, agentId: agent.id },
    });
    log(`[manual-dial] dialed ${toNumber} from ${fromNumber}`);
  } catch (e) {
    console.error("[manual-dial] dograh error", e);
    await db.call.update({ where: { id: call.id }, data: { status: "FAILED" } });
    throw e;
  }
}

/** Throttled WhatsApp campaign send (readme §9). */
export async function whatsappSendJob(job: Job<WhatsAppSendJobData>): Promise<void> {
  const { workspaceId, whatsAppCampaignId, phone, templateName, params, index, total } = job.data;
  const res = await sendWhatsAppGated({ to: phone, template: templateName, params });
  log(`[whatsapp-send] ${whatsAppCampaignId}: ${index + 1}/${total} to=${phone} ok=${res.ok}${res.dryRun ? " (dry-run)" : ""}${res.error ? ` error=${res.error}` : ""}`);
  if (index === total - 1) {
    await db.whatsAppCampaign.updateMany({
      where: { id: whatsAppCampaignId, workspaceId, status: "RUNNING" },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    log(`[whatsapp-send] ${whatsAppCampaignId}: COMPLETED (${total} messages)`);
  }
}
