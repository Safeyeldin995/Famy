const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || undefined;
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY?.trim() || undefined;

const applePayMerchantId =
  process.env.APPLE_PAY_MERCHANT_ID?.trim() ||
  process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID?.trim() ||
  undefined;

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
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? "./GoogleService-Info.plist",
  },
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    blockedPermissions: [
      ...(config.android?.blockedPermissions ?? []),
      "android.permission.SYSTEM_ALERT_WINDOW",
    ].filter((permission, index, all) => all.indexOf(permission) === index),
  },
});
