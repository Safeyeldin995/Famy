module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? "./GoogleService-Info.plist",
    config: {
      ...config.ios?.config,
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
    },
  },
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
    blockedPermissions: [
      ...(config.android?.blockedPermissions ?? []),
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ].filter((permission, index, all) => all.indexOf(permission) === index),
  },
});
