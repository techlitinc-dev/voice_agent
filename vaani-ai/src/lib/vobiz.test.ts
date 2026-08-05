import { describe, it, expect, afterEach, vi } from "vitest";

async function load() {
  vi.resetModules();
  process.env.VOBIZ_API_BASE = "https://vobiz.test";
  process.env.VOBIZ_WHATSAPP_PATH = "/v1/whatsapp/messages";
  process.env.VOBIZ_AUTH_ID = "aid";
  process.env.VOBIZ_AUTH_TOKEN = "atok";
  process.env.VOBIZ_WHATSAPP_SENDER = "+918040001234";
  return await import("./vobiz");
}

function fakeResponse(status: number, json: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => (typeof json === "string" ? json : JSON.stringify(json)),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendWhatsAppTemplate", () => {
  it("sends the template shape with Basic auth and returns providerMessageId", async () => {
    const { sendWhatsAppTemplate } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { message_id: "wamid.123" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWhatsAppTemplate({
      to: "+919812345678",
      templateName: "call_followup",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ramesh" }] }],
    });
    expect(res.providerMessageId).toBe("wamid.123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://vobiz.test/v1/whatsapp/messages");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("aid:atok").toString("base64")}`
    );
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("+918040001234");
    expect(body.to).toBe("+919812345678");
    expect(body.template.name).toBe("call_followup");
    expect(body.template.language.code).toBe("en");
  });

  it("401 → throws VobizError with status", async () => {
    const { sendWhatsAppTemplate, VobizError } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(401, "unauthorized")));
    await expect(
      sendWhatsAppTemplate({ to: "+919812345678", templateName: "x" })
    ).rejects.toBeInstanceOf(VobizError);
  });

  it("missing sender config → throws before any fetch", async () => {
    vi.resetModules();
    process.env.VOBIZ_AUTH_ID = "aid";
    process.env.VOBIZ_AUTH_TOKEN = "atok";
    delete process.env.VOBIZ_WHATSAPP_SENDER;
    const { sendWhatsAppTemplate } = await import("./vobiz");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendWhatsAppTemplate({ to: "+919812345678", templateName: "x" })
    ).rejects.toThrow(/VOBIZ_WHATSAPP_SENDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed recipient numbers before sending", async () => {
    const { sendWhatsAppTemplate } = await load();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendWhatsAppTemplate({ to: "9812345678", templateName: "x" })
    ).rejects.toThrow(/bad recipient/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
