const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || undefined;
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY?.trim() || undefined;

const applePayMerchantId =
  process.env.APPLE_PAY_MERCHANT_ID?.trim() ||
  process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID?.trim() ||
  undefined;

const {
  APP_LINK_HOST,
  ANDROID_APP_LINK_PATH_PREFIXES,
} = require("./appLinkPrefixes");

const universalLinkData = ANDROID_APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
  scheme: "https",
  host: APP_LINK_HOST,
  pathPrefix,
}));

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    // Writes the keys into the native manifest/plist only; never into JS.
    ["react-native-maps", { androidGoogleMapsApiKey: androidMapsKey, iosGoogleMapsApiKey: iosMapsKey }],
    ["./plugins/withPaymob.js", { applePayMerchantId }],
  ],
  extra: {
    ...config.extra,
    // Expo strips android/ios.config at runtime, so expose only whether a key exists.
    googleMapsConfigured: { android: !!androidMapsKey, ios: !!iosMapsKey },
    applePayMerchantId,
  },
  ios: {
    ...config.ios,
    associatedDomains: [`applinks:${APP_LINK_HOST}`],
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? "./GoogleService-Info.plist",
  },
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: universalLinkData,
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    blockedPermissions: [
      ...(config.android?.blockedPermissions ?? []),
      "android.permission.SYSTEM_ALERT_WINDOW",
      "com.google.android.gms.permission.AD_ID",
    ].filter((permission, index, all) => all.indexOf(permission) === index),
  },
});
