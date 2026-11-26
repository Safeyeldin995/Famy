const APP_LINK_HOST = "famy-chi.vercel.app";

/** Android intent-filter pathPrefix values (must end with / to avoid stealing /pay, /pro, etc.). */
const ANDROID_APP_LINK_PATH_PREFIXES = ["/booking/", "/online/lessons/", "/p/", "/provider/"];

function pathMatchesAndroidAppLinkPrefix(pathname) {
  return ANDROID_APP_LINK_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

module.exports = {
  APP_LINK_HOST,
  ANDROID_APP_LINK_PATH_PREFIXES,
  pathMatchesAndroidAppLinkPrefix,
};