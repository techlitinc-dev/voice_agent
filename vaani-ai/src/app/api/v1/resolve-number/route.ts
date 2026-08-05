import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveGreeting } from "@/lib/greeting";
import { checkInboundSpam } from "@/lib/spamFilter";
import { parseHumanTransferConfig } from "@/lib/fallbackPolicy";

/**
 * Called by the voice stack at inbound call start (pre-call data fetch).
 * GET /api/v1/resolve-number?to=%2B918040001234&from=%2B919812345678
 * Secured by a shared secret header (same secret as the Dograh webhook).
 *
 * Response (200): { ok, workflowId, agentName, workspaceId, greeting, context, blocked }
 *  - greeting: the exact text the AI should speak (smart greeting by context, spec §5)
 *  - context:  template variables for the workflow (caller_name, is_returning_caller,
 *              business_status, transfer_queue, transfer_skill)
 *  - blocked:  true + blockReason when the spam filter rejects the caller
 */
export async function GET(req: NextRequest) {
  const secret = process.env.DOGRAH_WEBHOOK_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (secret && provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const to = req.nextUrl.searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, error: "missing ?to=" }, { status: 400 });
  const from = req.nextUrl.searchParams.get("from") ?? "";

  const phone = await db.phoneNumber.findFirst({
    where: { number: to },
    include: { agent: { include: { toolConfigs: true } }, workspace: { select: { slug: true } } },
  });
  if (!phone || !phone.agent || phone.agent.status !== "PUBLISHED" || !phone.agent.dograhWorkflowId) {
    return NextResponse.json({ ok: false, error: "no published agent for this number" }, { status: 404 });
  }

  // Spam & robocall filtering (spec §5) — checked before anything else.
  const spam = from ? await checkInboundSpam(phone.workspaceId, from) : { spam: false as const };
  if (spam.spam) {
    return NextResponse.json({ ok: true, blocked: true, blockReason: spam.reason, workspaceId: phone.workspaceId });
  }

  // Returning-caller detection: Contact lookup by caller number in this workspace.
  const contact = from
    ? await db.contact.findUnique({
        where: { workspaceId_phone: { workspaceId: phone.workspaceId, phone: from } },
        select: { name: true, dnc: true },
      })
    : null;

  const g = resolveGreeting({
    workspaceSlug: phone.workspace.slug,
    baseGreeting: phone.agent.greeting,
    callerName: contact?.name,
  });

  const transferConfig = parseHumanTransferConfig(
    phone.agent.toolConfigs.find((t) => t.tool === "HUMAN_TRANSFER")?.config
  );

  return NextResponse.json({
    ok: true,
    blocked: false,
    workflowId: phone.agent.dograhWorkflowId,
    agentName: phone.agent.name,
    workspaceId: phone.workspaceId,
    greeting: g.greeting,
    context: {
      caller_name: contact?.name ?? "",
      is_returning_caller: g.isReturning ? "true" : "false",
      business_status: g.businessStatus,
      transfer_queue: transferConfig.queue,
      transfer_skill: transferConfig.skill ?? "",
    },
  });
}
