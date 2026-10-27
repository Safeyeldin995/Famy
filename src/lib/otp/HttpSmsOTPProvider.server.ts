import { OtpDeliveryError } from "./OtpDeliveryError";
import type { OtpSendMeta } from "./OtpProvider";
import type { OTPProvider } from "./OtpProvider";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 300;

export type HttpSmsMessageLang = "ar" | "en";

export type HttpSmsConfig = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  authHeaderName?: string;
  authHeaderValue?: string;
  bodyTemplate: string;
  senderId: string;
  messageTemplateAr: string;
  messageTemplateEn: string;
  messageLang: HttpSmsMessageLang;
  successJsonPath?: string;
  successExpectedValue?: string;
  timeoutMs: number;
};

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseHttpSmsMethod(raw: string | undefined): HttpSmsConfig["method"] {
  const value = (raw?.trim() || "POST").toUpperCase();
  if (value === "GET" || value === "POST" || value === "PUT" || value === "PATCH") {
    return value;
  }
  throw new Error(`Invalid SMS_HTTP_METHOD="${raw}". Allowed: GET, POST, PUT, PATCH.`);
}

export function parseHttpSmsMessageLang(raw: string | undefined): HttpSmsMessageLang {
  const value = (raw?.trim() || "ar").toLowerCase();
  if (value === "ar" || value === "en") {
    return value;
  }
  throw new Error(`Invalid SMS_MESSAGE_LANG="${raw}". Allowed: ar, en.`);
}

export function readHttpSmsConfig(env: NodeJS.ProcessEnv = process.env): HttpSmsConfig {
  const url = trimOrUndefined(env.SMS_HTTP_URL);
  const bodyTemplate = trimOrUndefined(env.SMS_HTTP_BODY_TEMPLATE);
  const senderId = trimOrUndefined(env.SMS_SENDER_ID);
  const messageTemplateAr = trimOrUndefined(env.SMS_MESSAGE_TEMPLATE_AR);
  const messageTemplateEn = trimOrUndefined(env.SMS_MESSAGE_TEMPLATE_EN);

  const missing = [
    !url ? "SMS_HTTP_URL" : null,
    !bodyTemplate ? "SMS_HTTP_BODY_TEMPLATE" : null,
    !senderId ? "SMS_SENDER_ID" : null,
    !messageTemplateAr ? "SMS_MESSAGE_TEMPLATE_AR" : null,
    !messageTemplateEn ? "SMS_MESSAGE_TEMPLATE_EN" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing HTTP SMS OTP configuration: ${missing.join(", ")}`);
  }

  const successJsonPath = trimOrUndefined(env.SMS_HTTP_SUCCESS_JSONPATH);
  const successExpectedValue = trimOrUndefined(env.SMS_HTTP_SUCCESS_VALUE);
  if (successJsonPath && successExpectedValue === undefined) {
    throw new Error("SMS_HTTP_SUCCESS_VALUE is required when SMS_HTTP_SUCCESS_JSONPATH is set.");
  }

  const timeoutRaw = trimOrUndefined(env.SMS_HTTP_TIMEOUT_MS);
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("SMS_HTTP_TIMEOUT_MS must be a positive number when set.");
  }

  return {
    url: url!,
    method: parseHttpSmsMethod(env.SMS_HTTP_METHOD),
    authHeaderName: trimOrUndefined(env.SMS_HTTP_AUTH_HEADER),
    authHeaderValue: trimOrUndefined(env.SMS_HTTP_AUTH_VALUE),
    bodyTemplate: bodyTemplate!,
    senderId: senderId!,
    messageTemplateAr: messageTemplateAr!,
    messageTemplateEn: messageTemplateEn!,
    messageLang: parseHttpSmsMessageLang(env.SMS_MESSAGE_LANG),
    successJsonPath,
    successExpectedValue,
    timeoutMs,
  };
}

export function renderSmsMessageTemplate(
  template: string,
  code: string,
): string {
  return template.replace(/\{\{code\}\}/g, code);
}

export function pickSmsMessageTemplate(config: HttpSmsConfig, lang?: HttpSmsMessageLang): string {
  const effectiveLang = lang ?? config.messageLang;
  return effectiveLang === "en" ? config.messageTemplateEn : config.messageTemplateAr;
}

/** Inserts string values into a JSON body template without breaking JSON escaping. */
export function renderHttpSmsBodyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key] ?? "";
    return JSON.stringify(value).slice(1, -1);
  });
}

export function getJsonPathValue(body: unknown, path: string): unknown {
  const segments = path
    .replace(/^\$\.?/, "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = body;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function phoneSuffix(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "*");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function normalizeJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export type HttpSmsProviderDeps = {
  config: HttpSmsConfig;
  fetchImpl?: typeof fetch;
};

export class HttpSmsOTPProvider implements OTPProvider {
  private readonly config: HttpSmsConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: HttpSmsProviderDeps) {
    this.config = deps.config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async sendOTP(phone: string, _message: string, meta: OtpSendMeta): Promise<void> {
    const smsText = renderSmsMessageTemplate(
      pickSmsMessageTemplate(this.config),
      meta.otp,
    );
    const body = renderHttpSmsBodyTemplate(this.config.bodyTemplate, {
      phone,
      message: smsText,
      sender: this.config.senderId,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.authHeaderName && this.config.authHeaderValue) {
      headers[this.config.authHeaderName] = this.config.authHeaderValue;
    }

    let lastStatus = 0;
    let lastClientError: "delivery_failed" | "temporarily_unavailable" = "temporarily_unavailable";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
      }

      try {
        const result = await this.sendOnce(body, headers, meta.requestId);
        if (result.ok) {
          console.info("[HttpSmsOTPProvider] delivered", {
            request_id: meta.requestId,
            phone_suffix: phoneSuffix(phone),
            http_status: result.status,
          });
          return;
        }
        lastStatus = result.status;
        lastClientError = result.clientError;
        if (!result.retryable || attempt >= MAX_RETRIES) {
          break;
        }
      } catch {
        lastClientError = "temporarily_unavailable";
        if (attempt >= MAX_RETRIES) {
          break;
        }
      }
    }

    console.error("[HttpSmsOTPProvider] delivery failed", {
      request_id: meta.requestId,
      phone_suffix: phoneSuffix(phone),
      http_status: lastStatus || null,
    });
    throw new OtpDeliveryError(lastClientError, {
      httpStatus: lastStatus || undefined,
    });
  }

  private async sendOnce(
    body: string,
    headers: Record<string, string>,
    _requestId: string,
  ): Promise<{
    ok: boolean;
    status: number;
    retryable: boolean;
    clientError: "delivery_failed" | "temporarily_unavailable";
  }> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: this.config.method,
        headers,
        body: this.config.method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      return {
        ok: false,
        status: 0,
        retryable: true,
        clientError: "temporarily_unavailable",
      };
    }

    const status = response.status;
    if (!this.config.successJsonPath) {
      if (response.ok) {
        return { ok: true, status, retryable: false, clientError: "delivery_failed" };
      }
      const retryable = isRetryableStatus(status);
      return {
        ok: false,
        status,
        retryable,
        clientError: retryable ? "temporarily_unavailable" : "delivery_failed",
      };
    }

    const parsedBody = (await response.json().catch(() => null)) as unknown;
    const actual = normalizeJsonValue(getJsonPathValue(parsedBody, this.config.successJsonPath));
    const expected = this.config.successExpectedValue ?? "";
    if (response.ok && actual === expected) {
      return { ok: true, status, retryable: false, clientError: "delivery_failed" };
    }

    const retryable = isRetryableStatus(status);
    return {
      ok: false,
      status,
      retryable,
      clientError: retryable ? "temporarily_unavailable" : "delivery_failed",
    };
  }
}

export function createHttpSmsOTPProvider(deps?: Partial<HttpSmsProviderDeps>): HttpSmsOTPProvider {
  return new HttpSmsOTPProvider({
    config: deps?.config ?? readHttpSmsConfig(),
    fetchImpl: deps?.fetchImpl,
  });
}
