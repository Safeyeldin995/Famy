# OTP delivery providers

Famy supports multiple OTP delivery backends. Production must set **`OTP_PROVIDER`** (server) and **`VITE_OTP_PROVIDER`** (web build) to the same logical provider.

| Provider | `OTP_PROVIDER` / `VITE_OTP_PROVIDER` | Who sends the SMS/code |
| --- | --- | --- |
| Mock (dev/test only) | `mock` | Server logs the code |
| Meta WhatsApp | `meta` | Server via WhatsApp Cloud API |
| HTTP SMS | `http_sms` | Server via your SMS gateway HTTPS API |
| Firebase Phone Auth | `firebase` | Client SDK (reCAPTCHA + Firebase) |

When the provider is **`http_sms`** or **`meta`**, API responses use `delivery: "server"`. The web app does **not** load Firebase reCAPTCHA or client SMS send — users enter the code received on SMS/WhatsApp.

When the provider is **`firebase`**, the server stores intent only; the browser/mobile client sends SMS through Firebase.

## HTTP SMS (`http_sms`)

Use this after company registration with an Egyptian SMS aggregator (Vodafone Business SMS, Cequens, Victory Link, etc.). Famy ships a **provider-agnostic** adapter: you map your vendor’s REST API using environment variables only (no secrets in the repo).

### Required environment variables

Set these on Vercel (or your host) as **server secrets**, not `VITE_` variables:

| Variable | Purpose |
| --- | --- |
| `SMS_HTTP_URL` | Full HTTPS endpoint (e.g. `https://api.cequens.com/sms/v1/messages`) |
| `SMS_HTTP_METHOD` | `POST` (default), or `GET` / `PUT` / `PATCH` if your vendor requires it |
| `SMS_HTTP_BODY_TEMPLATE` | JSON string with placeholders `{{phone}}`, `{{message}}`, `{{sender}}` |
| `SMS_SENDER_ID` | Registered sender name or short code (also passed as `{{sender}}`) |
| `SMS_MESSAGE_TEMPLATE_AR` | Arabic SMS text with `{{code}}` |
| `SMS_MESSAGE_TEMPLATE_EN` | English SMS text with `{{code}}` |
| `SMS_MESSAGE_LANG` | `ar` (default) or `en` — which template is used for `{{message}}` |

Optional auth (recommended):

| Variable | Purpose |
| --- | --- |
| `SMS_HTTP_AUTH_HEADER` | Header name (e.g. `Authorization`, `api-key`, `X-API-KEY`) |
| `SMS_HTTP_AUTH_VALUE` | Secret value (Bearer token, API key, etc.) |

Optional success matching (when 2xx alone is not enough):

| Variable | Purpose |
| --- | --- |
| `SMS_HTTP_SUCCESS_JSONPATH` | Dot path into JSON body (e.g. `status`, `data.code`) |
| `SMS_HTTP_SUCCESS_VALUE` | Required string match for that path (e.g. `0`, `Success`, `OK`) |

Optional tuning:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMS_HTTP_TIMEOUT_MS` | `15000` | Request timeout |

Also set:

```bash
OTP_PROVIDER=http_sms
VITE_OTP_PROVIDER=http_sms
```

### Example body templates

**Cequens-style JSON (illustrative — confirm with your contract):**

```json
{"senderName":"{{sender}}","messageType":"text","recipients":"{{phone}}","messageText":"{{message}}"}
```

**Victory Link / generic REST:**

```json
{"username":"YOUR_USER","password":"SET_IN_VENDOR_PORTAL_NOT_HERE","sender":"{{sender}}","mobile":"{{phone}}","message":"{{message}}"}
```

Prefer putting static vendor fields in the template only when they are **not secrets**. Use `SMS_HTTP_AUTH_*` for tokens and keys.

**Message templates (Arabic default):**

```text
SMS_MESSAGE_TEMPLATE_AR=رمز التحقق من فامي: {{code}}. صالح لمدة 5 دقائق.
SMS_MESSAGE_TEMPLATE_EN=Your Famy verification code is {{code}}. Valid for 5 minutes.
```

### Behaviour and safety

- Retries: up to 2 backoff retries on **5xx** or network/timeout only; **4xx** fails immediately (`delivery_failed`).
- Logging: request id, HTTP status, and **last 4 digits** of phone only — never full phone, OTP, auth values, or raw bodies.
- Switching providers is configuration-only: change env vars and `OTP_PROVIDER` / `VITE_OTP_PROVIDER`; no code deploy required beyond env.

## Meta WhatsApp (`meta`)

See `.env.example` for `META_WHATSAPP_*` variables. Same server-side delivery model as `http_sms`.

## Firebase (`firebase`)

See `.env.example` for `VITE_FIREBASE_*` (client) and `FIREBASE_*` (server Admin for ID token verify). Client sends SMS; server verifies tokens.

## Rollout: move from Firebase to HTTP SMS

1. Obtain production SMS credentials and approved sender ID from your Egyptian provider.
2. In **staging**, set all `SMS_HTTP_*` vars, `OTP_PROVIDER=http_sms`, and `VITE_OTP_PROVIDER=http_sms`. Run a real signup/login OTP and confirm delivery and verify.
3. If the vendor returns a JSON status field, set `SMS_HTTP_SUCCESS_JSONPATH` and `SMS_HTTP_SUCCESS_VALUE` to match their docs.
4. Apply the same env on **Production** Vercel.
5. Flip `OTP_PROVIDER` and `VITE_OTP_PROVIDER` to `http_sms` and redeploy the web app.
6. Keep Firebase env vars in place until you have verified production traffic for at least one full auth journey; then Firebase can remain as a documented fallback by reverting env only.

## Local development

```bash
OTP_PROVIDER=mock
VITE_OTP_PROVIDER=mock
```

Mock logs OTPs in development/test only. To exercise the HTTP adapter locally, point `SMS_HTTP_URL` at a mock server (e.g. webhook.site) with `OTP_PROVIDER=http_sms`.
