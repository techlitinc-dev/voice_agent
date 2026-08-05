import { NextResponse } from "next/server";
import { apiError, apiOk, parseJsonBody, withApiKey } from "@/lib/api/http";
import { callTriggerSchema, listCalls } from "@/lib/api/resources";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  return withApiKey(req, "calls:read", async (ctx, r) => apiOk(await listCalls(ctx.workspaceId, new URL(r.url))));
}

/**
 * Trigger ONE outbound call. Honors CAMPAIGN_DRY_RUN (same gate as guide 07's
 * worker): dry-run creates a RINGING Call row without touching Dograh.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return withApiKey(req, "campaigns:launch", async (ctx) => {
    const body = await parseJsonBody(req, callTriggerSchema);
    if ("response" in body) return body.response;
    const agent = await db.agent.findFirst({ where: { id: body.data.agentId, workspaceId: ctx.workspaceId } });
    if (!agent) return apiError(422, "agent_not_found", "Agent not found in your workspace");

    if (process.env.CAMPAIGN_DRY_RUN !== "false") {
      const call = await db.call.create({
        data: {
          workspaceId: ctx.workspaceId,
          direction: "OUTBOUND",
          status: "RINGING",
          fromNumber: "dry-run",
          toNumber: body.data.to,
          agentId: agent.id,
        },
      });
      return apiOk({ callId: call.id, dryRun: true }, 201);
    }

    const { dograhTriggerCall } = await import("@/lib/dograh");
    const workflowUuid = (agent as unknown as { dograhWorkflowUuid?: string | null }).dograhWorkflowUuid
      ?? agent.dograhWorkflowId;
    if (!workflowUuid) return apiError(422, "agent_not_published", "Agent has no published Dograh workflow");
    const run = await dograhTriggerCall(workflowUuid, { phoneNumber: body.data.to });
    const call = await db.call.create({
      data: {
        workspaceId: ctx.workspaceId,
        dograhCallId: `${agent.dograhWorkflowId}:${run.workflow_run_id}`,
        direction: "OUTBOUND",
        status: "RINGING",
        fromNumber: "vobiz",
        toNumber: body.data.to,
        agentId: agent.id,
      },
    });
    return apiOk({ callId: call.id, workflowRunId: run.workflow_run_id }, 201);
  });
}
