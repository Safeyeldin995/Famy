import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpDeliveryError } from "../OtpDeliveryError";
import { OtpCoreService } from "../OtpCoreService";
import {
  MetaWhatsAppOTPProvider,
  buildMetaTemplatePayload,
  readMetaWhatsAppConfig,
} from "../MetaWhatsAppOTPProvider.server";

const baseConfig = {
  accessToken: "test-access-token",
  phoneNumberId: "123456789",
  templateName: "famy_auth_otp",
  templateLanguage: "en",
  templateButtonType: "url" as const,
};

const meta = {
  purpose: "SIGNUP" as const,
  otp: "123456",
  timestamp: new Date("2026-07-22T12:00:00.000Z"),
  requestId: "11111111-1111-1111-1111-111111111111",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MetaWhatsAppOTPProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds template payload with recipient without plus sign", () => {
    const payload = buildMetaTemplatePayload("201221000633", "123456", baseConfig);
    expect(payload.to).toBe("201221000633");
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("famy_auth_otp");
    expect(payload.template.components).toHaveLength(2);
    expect(payload.template.components[1]).toMatchObject({ sub_type: "url" });
  });

  it("omits button component when templateButtonType is none", () => {
    const payload = buildMetaTemplatePayload("201221000633", "123456", {
      ...baseConfig,
      templateButtonType: "none",
    });
    expect(payload.template.components).toHaveLength(1);
    expect(payload.template.components[0]).toMatchObject({ type: "body" });
  });

  it("builds copy_code authentication button payload", () => {
    const payload = buildMetaTemplatePayload("201221000633", "123456", {
      ...baseConfig,
      templateButtonType: "copy_code",
    });
    expect(payload.template.components).toHaveLength(2);
    expect(payload.template.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "123456" }],
    });
  });

  it("sends a successful Meta template request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { messages: [{ id: "wamid.TEST123" }] }),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await provider.sendOTP("+201221000633", "ignored", meta);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-access-token",
    });
    expect(info).toHaveBeenCalledWith(
      "[MetaWhatsAppOTPProvider] delivered",
      expect.objectContaining({ provider_message_id: "wamid.TEST123" }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("123456");
  });

  it("does not retry 400 responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: { code: 100, message: "Invalid parameter" } }),
    );
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await expect(provider.sendOTP("+201221000633", "ignored", meta)).rejects.toMatchObject({
      clientError: "delivery_failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 responses up to two times", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: 4 } }))
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: 4 } }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: "wamid.OK" }] }));
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await provider.sendOTP("+201221000633", "ignored", meta);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries 500 responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 1 } }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: "wamid.OK" }] }));
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await provider.sendOTP("+201221000633", "ignored", meta);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries timeouts", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: "wamid.OK" }] }));
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await provider.sendOTP("+201221000633", "ignored", meta);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never exposes access token in thrown errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 100 } }));
    const provider = new MetaWhatsAppOTPProvider({ config: baseConfig, fetchImpl });

    await expect(provider.sendOTP("+201221000633", "ignored", meta)).rejects.toSatisfy((error: unknown) => {
      const text = JSON.stringify(error);
      return !text.includes("test-access-token");
    });
  });

  it("fails closed when Meta env is missing", () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_NAME", "tpl");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_LANGUAGE", "en");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_BUTTON_TYPE", "copy_code");
    expect(() => readMetaWhatsAppConfig()).toThrow(/META_WHATSAPP_ACCESS_TOKEN/);
    vi.unstubAllEnvs();
  });

  it("fails closed for invalid button type", () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_NAME", "tpl");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_LANGUAGE", "en");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_BUTTON_TYPE", "invalid");
    expect(() => readMetaWhatsAppConfig()).toThrow(/META_WHATSAPP_TEMPLATE_BUTTON_TYPE/);
    vi.unstubAllEnvs();
  });

  it("fails closed when button type env is missing", () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_NAME", "tpl");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_LANGUAGE", "en");
    vi.stubEnv("META_WHATSAPP_TEMPLATE_BUTTON_TYPE", "");
    expect(() => readMetaWhatsAppConfig()).toThrow(/META_WHATSAPP_TEMPLATE_BUTTON_TYPE/);
    vi.unstubAllEnvs();
  });
});

describe("resolveOtpProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects mock provider in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "mock");
    const { resolveOtpProvider } = await import("../otpProvider.server");
    await expect(resolveOtpProvider()).rejects.toThrow(/Production requires OTP_PROVIDER=meta/);
  });

  it("allows mock only when explicitly configured in test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OTP_PROVIDER", "mock");
    const { resolveOtpProvider } = await import("../otpProvider.server");
    const provider = await resolveOtpProvider();
    expect(provider.constructor.name).toBe("MockOTPProvider");
  });
});

describe("delivery failure invalidates undelivered OTP row", () => {
  it("aborts the stored OTP when provider delivery fails", async () => {
    const rows: Array<{ phone: string; purpose: string; request_id: string; used_at: string | null }> = [];

    const store = {
      async beginSend(params: any) {
        rows.push({
          phone: params.phone,
          purpose: params.purpose,
          request_id: params.requestId,
          used_at: null,
        });
        return "ok" as const;
      },
      async verifyAndConsume() {
        return "not_found" as const;
      },
      async abortUndeliveredOtp(params: any) {
        const idx = rows.findIndex(
          (r) => r.phone === params.phone && r.purpose === params.purpose && r.request_id === params.requestId,
        );
        if (idx >= 0) rows.splice(idx, 1);
      },
      async deleteExpired() {
        return 0;
      },
    };

    const service = new OtpCoreService({
      store,
      provider: {
        async sendOTP() {
          throw new OtpDeliveryError("delivery_failed");
        },
      },
      randomDigits: () => "123456",
    });

    const result = await service.generateOTP({
      phone: "+201221000633",
      purpose: "SIGNUP",
      requestId: meta.requestId,
    });

    expect(result).toEqual({ ok: false, error: "delivery_failed" });
    expect(rows).toHaveLength(0);
  });
});
