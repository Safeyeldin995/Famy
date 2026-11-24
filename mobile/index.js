// Install missing Intl support before Expo Router loads any screens or i18n.
import "./src/lib/intlPluralRules";
import { initMobileSentry } from "./src/lib/sentry";

initMobileSentry();
import "expo-router/entry";
