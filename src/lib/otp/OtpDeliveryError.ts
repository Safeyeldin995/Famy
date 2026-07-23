export type OtpClientDeliveryError = "delivery_failed" | "temporarily_unavailable";

/** Thrown when OTP delivery fails; safe to map to generic client responses. */
export class OtpDeliveryError extends Error {
  readonly clientError: OtpClientDeliveryError;
  readonly httpStatus?: number;
  readonly metaErrorCode?: number;

  constructor(
    clientError: OtpClientDeliveryError,
    diagnostics?: { httpStatus?: number; metaErrorCode?: number },
  ) {
    super(clientError);
    this.name = "OtpDeliveryError";
    this.clientError = clientError;
    this.httpStatus = diagnostics?.httpStatus;
    this.metaErrorCode = diagnostics?.metaErrorCode;
  }
}
