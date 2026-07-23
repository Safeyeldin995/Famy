import { OtpDeliveryError } from "./OtpDeliveryError";
import type { OtpSendMeta } from "./OtpProvider";
import type { OTPProvider } from "./OtpProvider";

const GRAPH_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 300;

/** Must match the approved Meta authentication template button type exactly. */
export type MetaTemplateButtonType = "none" | "url" | "copy_code";

export type MetaWhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  templateButtonType: MetaTemplateButtonType;
};

const ALLOWED_BUTTON_TYPES: MetaTemplateButtonType[] = ["none", "url", "copy_code"];

export function parseMetaTemplateButtonType(raw: string | undefined): MetaTemplateButtonType {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      "META_WHATSAPP_TEMPLATE_BUTTON_TYPE is required (none | url | copy_code) and must match the approved Meta template.",
    );
  }
  if (!ALLOWED_BUTTON_TYPES.includes(value as MetaTemplateButtonType)) {
    throw new Error(
      `Invalid META_WHATSAPP_TEMPLATE_BUTTON_TYPE="${value}". Allowed: none, url, copy_code.`,
    );
  }
  return value as MetaTemplateButtonType;
}

export function readMetaWhatsAppConfig(): MetaWhatsAppConfig {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME?.trim();
  const templateLanguage = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE?.trim();
  const missing = [
    !accessToken ? "META_WHATSAPP_ACCESS_TOKEN" : null,
    !phoneNumberId ? "META_WHATSAPP_PHONE_NUMBER_ID" : null,
    !templateName ? "META_WHATSAPP_TEMPLATE_NAME" : null,
    !templateLanguage ? "META_WHATSAPP_TEMPLATE_LANGUAGE" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing Meta WhatsApp OTP configuration: ${missing.join(", ")}`);
  }
  return {
    accessToken: accessToken!,
    phoneNumberId: phoneNumberId!,
    templateName: templateName!,
    templateLanguage: templateLanguage!,
    templateButtonType: parseMetaTemplateButtonType(
      process.env.META_WHATSAPP_TEMPLATE_BUTTON_TYPE,
    ),
  };
}

function phoneSuffix(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "*");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type MetaSendAttempt = {
  status: number;
  metaErrorCode?: number;
  messageId?: string;
  retryable: boolean;
  clientError: "delivery_failed" | "temporarily_unavailable";
};

function buildBodyComponent(otp: string) {
  return {
    type: "body",
    parameters: [{ type: "text", text: otp }],
  };
}

/**
 * One-tap autofill authentication templates (Graph API v21.0).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages/
 */
export function buildMetaUrlButtonComponent(otp: string) {
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: otp }],
  };
}

/**
 * Copy-code authentication templates use the same send-time button payload on Graph API v21.0.
 * @see https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates/
 */
export function buildMetaCopyCodeButtonComponent(otp: string) {
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: otp }],
  };
}

export function buildMetaTemplateComponents(
  otp: string,
  buttonType: MetaTemplateButtonType,
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [buildBodyComponent(otp)];
  if (buttonType === "url") {
    components.push(buildMetaUrlButtonComponent(otp));
  } else if (buttonType === "copy_code") {
    components.push(buildMetaCopyCodeButtonComponent(otp));
  }
  return components;
}

export function buildMetaTemplatePayload(
  recipientWithoutPlus: string,
  otp: string,
  config: MetaWhatsAppConfig,
) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientWithoutPlus,
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: buildMetaTemplateComponents(otp, config.templateButtonType),
    },
  };
}

export type MetaWhatsAppProviderDeps = {
  config: MetaWhatsAppConfig;
  fetchImpl?: typeof fetch;
};

export class MetaWhatsAppOTPProvider implements OTPProvider {
  private readonly config: MetaWhatsAppConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: MetaWhatsAppProviderDeps) {
    this.config = deps.config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async sendOTP(phone: string, _message: string, meta: OtpSendMeta): Promise<void> {
    const recipient = phone.replace(/^\+/, "");
    const payload = buildMetaTemplatePayload(recipient, meta.otp, this.config);
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;

    let lastAttempt: MetaSendAttempt | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
      }

      try {
        lastAttempt = await this.sendOnce(url, payload, meta.requestId);
        if (lastAttempt.messageId) {
          console.info("[MetaWhatsAppOTPProvider] delivered", {
            request_id: meta.requestId,
            phone_suffix: phoneSuffix(phone),
            http_status: lastAttempt.status,
            meta_error_code: lastAttempt.metaErrorCode ?? null,
            provider_message_id: lastAttempt.messageId,
          });
        }
        return;
      } catch (error) {
        const clientError = error instanceof OtpDeliveryError
          ? error.clientError
          : "temporarily_unavailable";
        lastAttempt = {
          status: error instanceof OtpDeliveryError ? (error.httpStatus ?? 0) : 0,
          metaErrorCode: error instanceof OtpDeliveryError ? error.metaErrorCode : undefined,
          retryable: clientError === "temporarily_unavailable",
          clientError,
        };

        const retryable = lastAttempt.retryable && attempt < MAX_RETRIES;
        if (!retryable) {
          console.error("[MetaWhatsAppOTPProvider] delivery failed", {
            request_id: meta.requestId,
            phone_suffix: phoneSuffix(phone),
            http_status: lastAttempt.status || null,
            meta_error_code: lastAttempt.metaErrorCode ?? null,
            provider_message_id: lastAttempt.messageId ?? null,
          });
          throw new OtpDeliveryError(lastAttempt.clientError, {
            httpStatus: lastAttempt.status || undefined,
            metaErrorCode: lastAttempt.metaErrorCode,
          });
        }
      }
    }

    throw new OtpDeliveryError(lastAttempt?.clientError ?? "temporarily_unavailable");
  }

  private async sendOnce(
    url: string,
    payload: ReturnType<typeof buildMetaTemplatePayload>,
    _requestId: string,
  ): Promise<MetaSendAttempt> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new OtpDeliveryError("temporarily_unavailable");
    }

    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string };
    };

    const metaErrorCode = body.error?.code;
    const messageId = body.messages?.[0]?.id;

    if (response.ok && messageId) {
      return {
        status: response.status,
        metaErrorCode,
        messageId,
        retryable: false,
        clientError: "delivery_failed",
      };
    }

    const attempt: MetaSendAttempt = {
      status: response.status,
      metaErrorCode,
      messageId,
      retryable: isRetryableStatus(response.status),
      clientError: isRetryableStatus(response.status) ? "temporarily_unavailable" : "delivery_failed",
    };

    throw new OtpDeliveryError(attempt.clientError, {
      httpStatus: attempt.status,
      metaErrorCode: attempt.metaErrorCode,
    });
  }
}

export function createMetaWhatsAppOTPProvider(deps?: Partial<MetaWhatsAppProviderDeps>): MetaWhatsAppOTPProvider {
  return new MetaWhatsAppOTPProvider({
    config: deps?.config ?? readMetaWhatsAppConfig(),
    fetchImpl: deps?.fetchImpl,
  });
}
