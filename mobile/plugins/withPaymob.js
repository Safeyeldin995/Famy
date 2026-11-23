const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withEntitlementsPlist,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const PAYMOB_LIBS = 'url = rootProject.projectDir.toURI().resolve("../node_modules/paymob-reactnative/android/libs")';

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

function withPaymob(config, props = {}) {
  const merchantId =
    props.applePayMerchantId ??
    process.env.APPLE_PAY_MERCHANT_ID ??
    process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID;
  config = withPaymobProjectGradle(config);
  config = withPaymobAppGradle(config);
  return withApplePayMerchant(config, merchantId?.trim() || undefined);
}

module.exports = createRunOncePlugin(withPaymob, "with-paymob", "1.0.0");