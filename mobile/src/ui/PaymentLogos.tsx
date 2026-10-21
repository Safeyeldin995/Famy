import { View } from "react-native";
import { Image } from "expo-image";
import Svg, { Path, Circle } from "react-native-svg";
import paymob from "@/assets/images/paymob.png";
import { ui } from "./Page";
/** Official shapes from src/components/famio/PaymentLogos.tsx. */
export function PaymentLogos() {
  return (
    <View style={[ui.wrap, { direction: "ltr" }]}>
      <Image source={paymob} style={{ width: 72, height: 24 }} contentFit="contain" />
      <Svg width={42} height={16} viewBox="0 8 24 8">
        <Path
          fill="#1A1F71"
          d="M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z"
        />
      </Svg>
      <Svg width={32} height={20} viewBox="0 0 32 20">
        <Circle cx="10" cy="10" r="10" fill="#EB001B" />
        <Circle cx="22" cy="10" r="10" fill="#F79E1B" />
        <Path fill="#FF5F00" d="M16 2a10 10 0 0 1 0 16a10 10 0 0 1 0-16z" />
      </Svg>
    </View>
  );
}
