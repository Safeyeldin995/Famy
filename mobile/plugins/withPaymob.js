const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withAndroidManifest,
  withEntitlementsPlist,
  AndroidConfig,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const PAYMOB_LIBS =
  'url = rootProject.projectDir.toURI().resolve("../node_modules/paymob-reactnative/android/libs")';
const PAYMOB_BACK_CALLBACK_ATTR = "android:enableOnBackInvokedCallback";

function withPaymobProjectGradle(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(PAYMOB_LIBS)) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      /allprojects\s*\{\s*\n\s*repositories\s*\{/,
      `allprojects {\n  repositories {\n    maven {\n      ${PAYMOB_LIBS}\n    }\n    maven {\n      url = uri("https://jitpack.io")\n    }`,
    );
    return mod;
  });
}

function withPaymobAppGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes("dataBinding = true")) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      /android\s*\{/,
      "android {\n  buildFeatures {\n    dataBinding = true\n  }",
    );
    return mod;
  });
}

function withApplePayMerchant(config, merchantId) {
  if (!merchantId) return config;
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.in-app-payments"] = [merchantId];
    return mod;
  });
}

/** Paymob's library manifest sets enableOnBackInvokedCallback=true; Famy keeps predictive back disabled. */
function withPaymobAndroidManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(mod.modResults);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const existing = application.$["tools:replace"];
    const merged = new Set(
      (typeof existing === "string" ? existing.split(",") : [])
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    merged.add(PAYMOB_BACK_CALLBACK_ATTR);
    application.$["tools:replace"] = [...merged].join(",");
    mod.modResults = manifest;
    return mod;
  });
}

function withPaymob(config, props = {}) {
  const merchantId =
    props.applePayMerchantId ??
    process.env.APPLE_PAY_MERCHANT_ID ??
    process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID;
  config = withPaymobProjectGradle(config);
  config = withPaymobAppGradle(config);
  config = withPaymobAndroidManifest(config);
  return withApplePayMerchant(config, merchantId?.trim() || undefined);
}

module.exports = createRunOncePlugin(withPaymob, "with-paymob", "1.0.0");
