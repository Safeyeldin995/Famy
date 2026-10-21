import {
  DEVICE_PUSH_TOKEN_CHANNEL,
  deviceTokensFromRows,
  PUSH_SUBSCRIPTION_CHANNEL,
  validateRecipientChannelSpec,
} from "./recipient-channels.ts";

function assertEquals<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

validateRecipientChannelSpec(PUSH_SUBSCRIPTION_CHANNEL);
validateRecipientChannelSpec(DEVICE_PUSH_TOKEN_CHANNEL);

assertEquals(PUSH_SUBSCRIPTION_CHANNEL.select, "endpoint, p256dh, auth_key", "web push columns");
assertEquals(
  PUSH_SUBSCRIPTION_CHANNEL.nullIsFilters.map((f) => f.column),
  ["revoked_at"],
  "web push active filter",
);

assertEquals(DEVICE_PUSH_TOKEN_CHANNEL.select, "token", "device token columns");
assertEquals(
  DEVICE_PUSH_TOKEN_CHANNEL.nullIsFilters.map((f) => f.column),
  ["revoked_at"],
  "device token active filter",
);
assertEquals(
  DEVICE_PUSH_TOKEN_CHANNEL.forbiddenNullIsColumns.includes("expired_at"),
  true,
  "device tokens must not filter expired_at",
);

assertEquals(
  deviceTokensFromRows([{ token: "ExponentPushToken[x]" }, { token: null }]),
  ["ExponentPushToken[x]"],
  "device token rows",
);

console.log("PASS: recipient-channels unit tests");
