/**
 * Dry-run gate for WhatsApp sends. The actual provider call is ALWAYS guide 04's
 * canonical client: sendWhatsAppTemplate({to, templateName, languageCode?, components?})
 * from src/lib/vobiz.ts (envs VOBIZ_AUTH_ID/VOBIZ_AUTH_TOKEN/VOBIZ_API_BASE/
 * VOBIZ_WHATSAPP_PATH/VOBIZ_WHATSAPP_SENDER). WHATSAPP_DRY_RUN=true (default, guide
 * 06's env) logs instead of sending — zero cost in every test.
 */
import { sendWhatsAppTemplate } from "../lib/vobiz";

export type GatedWhatsAppResult = { ok: boolean; dryRun?: boolean; error?: string };

export async function sendWhatsAppGated(input: {
  to: string;
  template: string; // approved template NAME (vobiz.ts `templateName`)
  params: string[]; // body {{1}} {{2}} … parameters, in order
}): Promise<GatedWhatsAppResult> {
  if (process.env.WHATSAPP_DRY_RUN !== "false") {
    console.log(
      `[whatsapp] DRY RUN template=${input.template} to=${input.to} params=${JSON.stringify(input.params)}`
    );
    return { ok: true, dryRun: true };
  }
  try {
    await sendWhatsAppTemplate({
      to: input.to,
      templateName: input.template,
      components: [
        {
          type: "body",
          parameters: input.params.map((text) => ({ type: "text", text })),
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp] send failed", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
