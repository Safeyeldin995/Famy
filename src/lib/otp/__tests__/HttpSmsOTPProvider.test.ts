import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpDeliveryError } from "../OtpDeliveryError";
import {
  HttpSmsOTPProvider,
  getJsonPathValue,
  readHttpSmsConfig,
  renderHttpSmsBodyTemplate,
  renderSmsMessageTemplate,
} from "../HttpSmsOTPProvider.server";

const baseConfig = {
  url: "https://sms.example.com/send",
  method: "POST" as const,
  authHeaderName: "Authorization",
  authHeaderValue: "secret-api-key",
  bodyTemplate: '{"to":"{{phone}}","from":"{{sender}}","text":"{{message}}"}',
  senderId: "Famy",
  messageTemplateAr: "رمز فامي: {{code}}",
  messageTemplateEn: "Your Famy code is {{code}}",
  messageLang: "ar" as const,
  timeoutMs: 15_000,
};

const meta = {
  purpose: "SIGNUP" as const,
  otp: "654321",
  timestamp: new Date("2026-07-22T12:00:00.000Z"),
  requestId: "22222222-2222-2222-2222-222222222222",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpSmsOTPProvider helpers", () => {
  it("renders message and body templates", () => {
    expect(renderSmsMessageTemplate("Code {{code}}", "123456")).toBe("Code 123456");
    expect(
      renderHttpSmsBodyTemplate('{"msg":"{{message}}","n":"{{phone}}"}', {
        message: 'say "hi"',
        phone: "+201012345678",
      }),
    ).toBe('{"msg":"say \\"hi\\"","n":"+201012345678"}');
  });

  it("reads nested json path values", () => {
    expect(getJsonPathValue({ data: { status: "OK" } }, "data.status")).toBe("OK");
    expect(getJsonPathValue({ data: { status: "OK" } }, "$.data.status")).toBe("OK");
  });

  it("requires success value when json path is configured", () => {
    vi.stubEnv("SMS_HTTP_URL", "https://sms.example.com/send");
    vi.stubEnv("SMS_HTTP_BODY_TEMPLATE", "{}");
    vi.stubEnv("SMS_SENDER_ID", "Famy");
    vi.stubEnv("SMS_MESSAGE_TEMPLATE_AR", "ar {{code}}");
    vi.stubEnv("SMS_MESSAGE_TEMPLATE_EN", "en {{code}}");
    vi.stubEnv("SMS_HTTP_SUCCESS_JSONPATH", "status");
    expect(() => readHttpSmsConfig()).toThrow(/SMS_HTTP_SUCCESS_VALUE/);
    vi.unstubAllEnvs();
  });
});

describe("HttpSmsOTPProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a successful HTTP SMS request with rendered templates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = new HttpSmsOTPProvider({ config: baseConfig, fetchImpl });

    await provider.sendOTP("+201012345678", "ignored", meta);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sms.example.com/send");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "secret-api-key",
      "Content-Type": "application/json",
    });
    const requestBody = JSON.parse(String((init as RequestInit).body));
    expect(requestBody.to).toBe("+201012345678");
    expect(requestBody.from).toBe("Famy");
    expect(requestBody.text).toBe("رمز فامي: 654321");

    expect(info).toHaveBeenCalledWith(
      "[HttpSmsOTPProvider] delivered",
      expect.objectContaining({ http_status: 202, phone_suffix: "5678" }),
    );
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("654321");
    expect(logged).not.toContain("+201012345678");
    expect(logged).not.toContain("secret-api-key");
  });

  it("does not retry 4xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const provider = new HttpSmsOTPProvider({ config: baseConfig, fetchImpl });

    await expect(provider.sendOTP("+201012345678", "ignored", meta)).rejects.toMatchObject({
      clientError: "delivery_failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx responses then fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const provider = new HttpSmsOTPProvider({ config: baseConfig, fetchImpl });

    await expect(provider.sendOTP("+201012345678", "ignored", meta)).rejects.toBeInstanceOf(
      OtpDeliveryError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries timeouts then fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    const provider = new HttpSmsOTPProvider({ config: baseConfig, fetchImpl });

    await expect(provider.sendOTP("+201012345678", "ignored", meta)).rejects.toMatchObject({
      clientError: "temporarily_unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses json path success detection when configured", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { status: "OK", id: "msg-1" } }));
    const provider = new HttpSmsOTPProvider({
      config: {
        ...baseConfig,
        successJsonPath: "data.status",
        successExpectedValue: "OK",
      },
      fetchImpl,
    });

    await provider.sendOTP("+201012345678", "ignored", meta);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("resolveOtpProvider http_sms", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows http_sms in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "http_sms");
    const { resolveOtpProviderKind } = await import("../otpProviderKind.server");
    expect(resolveOtpProviderKind()).toBe("http_sms");
  });

  it("resolves HttpSmsOTPProvider when configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OTP_PROVIDER", "http_sms");
    vi.stubEnv("SMS_HTTP_URL", "https://sms.example.com/send");
    vi.stubEnv("SMS_HTTP_BODY_TEMPLATE", '{"to":"{{phone}}"}');
    vi.stubEnv("SMS_SENDER_ID", "Famy");
    vi.stubEnv("SMS_MESSAGE_TEMPLATE_AR", "ar {{code}}");
    vi.stubEnv("SMS_MESSAGE_TEMPLATE_EN", "en {{code}}");
    const { resolveOtpProvider } = await import("../otpProvider.server");
    const provider = await resolveOtpProvider();
    expect(provider.constructor.name).toBe("HttpSmsOTPProvider");
  });
});
