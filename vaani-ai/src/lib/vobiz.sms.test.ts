import { describe, it, expect, afterEach, vi } from "vitest";

async function load() {
  vi.resetModules();
  process.env.VOBIZ_API_BASE = "https://vobiz.test";
  process.env.VOBIZ_SMS_PATH = "/v1/sms/messages";
  process.env.VOBIZ_AUTH_ID = "aid";
  process.env.VOBIZ_AUTH_TOKEN = "atok";
  process.env.VOBIZ_SMS_SENDER = "VAANIAI";
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

describe("sendSms (guide 05)", () => {
  it("sends the SMS shape with Basic auth and returns providerMessageId", async () => {
    const { sendSms } = await load();
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { message_id: "sms.123" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendSms({ to: "+919812345678", message: "Your booking is confirmed" });
    expect(res.providerMessageId).toBe("sms.123");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://vobiz.test/v1/sms/messages");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("aid:atok").toString("base64")}`);
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("VAANIAI");
    expect(body.to).toBe("+919812345678");
    expect(body.text).toBe("Your booking is confirmed");
  });

  it("401 → throws VobizError with status", async () => {
    const { sendSms, VobizError } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(401, "unauthorized")));
    await expect(sendSms({ to: "+919812345678", message: "x" })).rejects.toBeInstanceOf(VobizError);
  });

  it("missing sender config → throws before any fetch", async () => {
    vi.resetModules();
    process.env.VOBIZ_AUTH_ID = "aid";
    process.env.VOBIZ_AUTH_TOKEN = "atok";
    delete process.env.VOBIZ_SMS_SENDER;
    const { sendSms } = await import("./vobiz");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms({ to: "+919812345678", message: "x" })).rejects.toThrow(/VOBIZ_SMS_SENDER/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed recipient numbers before sending", async () => {
    const { sendSms } = await load();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSms({ to: "9812345678", message: "x" })).rejects.toThrow(/bad recipient/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
