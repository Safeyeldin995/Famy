import {
  buildExpoPushMessages,
  chunkExpoMessages,
  expoTicketsNeedingExpiry,
  EXPO_BATCH_SIZE,
} from "./expo-push.ts";

function assertEquals<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const sample = buildExpoPushMessages(
  ["ExponentPushToken[a]", "ExponentPushToken[b]"],
  "Title",
  "Body",
  "/booking/x",
  "notif-1",
);
assertEquals(sample.length, 2, "message count");
assertEquals(sample[0]?.sound, "default", "sound");
assertEquals(sample[0]?.data, { deepLink: "/booking/x", tag: "notif-1" }, "data");

const many = Array.from({ length: EXPO_BATCH_SIZE + 3 }, (_, i) => ({
  to: `ExponentPushToken[${i}]`,
  title: "T",
  body: "B",
  sound: "default" as const,
  data: { deepLink: "/", tag: "t" },
}));
assertEquals(chunkExpoMessages(many).length, 2, "batch count");
assertEquals(chunkExpoMessages(many)[0]?.length, EXPO_BATCH_SIZE, "first batch size");

const expired = expoTicketsNeedingExpiry(
  [
    { status: "ok" },
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", details: { error: "MessageTooBig" } },
  ],
  ["tok-a", "tok-b", "tok-c"],
);
assertEquals(expired, ["tok-b"], "expired tokens");

console.log("PASS: expo-push unit tests");
