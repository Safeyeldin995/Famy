import { View } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import visa from "@/assets/images/pay/visa.png";
import mastercard from "@/assets/images/pay/mastercard.png";
import meeza from "@/assets/images/pay/meeza.png";
import instapay from "@/assets/images/pay/instapay.png";
import vodafone from "@/assets/images/pay/vodafone.png";
import orange from "@/assets/images/pay/orange.png";
import eand from "@/assets/images/pay/eand.png";
import { colors } from "./theme";

/** Official brand artwork (trimmed PNGs, 96px tall), keyed by brand. */
const LOGOS = {
  visa: { src: visa, ratio: 297 / 96 },
  mastercard: { src: mastercard, ratio: 124 / 96 },
  meeza: { src: meeza, ratio: 205 / 96 },
  instapay: { src: instapay, ratio: 733 / 96 },
  vodafone: { src: vodafone, ratio: 1 },
  orange: { src: orange, ratio: 1 },
  eand: { src: eand, ratio: 1 },
} as const;

export type Brand = keyof typeof LOGOS;

export function BrandLogo({ brand, height = 18 }: { brand: Brand; height?: number }) {
  const l = LOGOS[brand];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={brand}
      style={{
        height: height + 10,
        paddingHorizontal: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image source={l.src} style={{ height, width: height * l.ratio }} contentFit="contain" />
    </View>
  );
}

/** Accepted cards for online card payment. */
export function PaymentLogos({ height = 16 }: { height?: number }) {
  return (
    <View style={{ flexDirection: "row", direction: "ltr", gap: 6, alignItems: "center" }}>
      <BrandLogo brand="visa" height={height - 4} />
      <BrandLogo brand="mastercard" height={height} />
      <BrandLogo brand="meeza" height={height} />
    </View>
  );
}

/** Apple Pay mark for demo checkout rows (preview builds only). */
export function ApplePayMark({ height = 20 }: { height?: number }) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Apple Pay"
      style={{
        height: height + 8,
        paddingHorizontal: 8,
        borderRadius: 8,
        backgroundColor: "#000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={height * 2.2} height={height} viewBox="0 0 50 20">
        <Path
          fill="#fff"
          d="M8.2 4.1c-.6.7-1.6 1.3-2.6 1.2-.1-1 .4-2 .9-2.6.6-.7 1.6-1.2 2.5-1.3.1 1-.3 1.9-.8 2.7zm-.7 1.9c-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.4 1.1 8.5.7 1 1.6 2.1 2.7 2 .9 0 1.3-.7 2.4-.7 1.1 0 1.4.7 2.4.7 1 0 1.8-1 2.5-2 .4-.5.6-.8.9-1.4-2.3-1-2.2-4.8.2-5.8-.8-.9-2.1-1.6-3.3-1.1z"
        />
        <Path
          fill="#fff"
          d="M19.5 6.3h2.1l3.1 7.4h-2.2l-.6-1.5h-3.3l-.6 1.5h-2.2l3.7-8.4zm1 2.2-1.1 2.8h2.1L20.5 8.5zm6.2-.2c2.2 0 3.6 1.2 3.6 3.1 0 2.2-1.9 3.3-4.6 3.3h-1.4v3h-2V6.3h4.4zm-2.1 1.6v1.7h1.1c1 0 1.5-.4 1.5-1.1 0-.6-.5-.9-1.4-.9h-1.2zm7.4 6.5c-.8 0-1.5-.3-2-.8v3.2h-2V6.3h1.9v.8c.5-.6 1.2-.9 2.1-.9 1.8 0 3 1.4 3 3.6s-1.2 3.6-3.1 3.6zm-.1-5.2c-.8 0-1.4.7-1.4 1.6s.6 1.6 1.4 1.6 1.4-.7 1.4-1.6-.6-1.6-1.4-1.6zm4.9 5.1V6.3h2v7.9h-2zm5.2-7.9h2v7.9h-2V6.3zm1 9.1c-.7 0-1.2-.5-1.2-1.1s.5-1.1 1.2-1.1 1.2.5 1.2 1.1-.5 1.1-1.2 1.1z"
        />
      </Svg>
    </View>
  );
}

/** Logos for a payment method row (by method_type / code). */
export function PaymentMethodLogos({ code, type }: { code?: string; type?: string }) {
  if (type === "online") return <PaymentLogos height={14} />;
  if (code === "instapay") return <BrandLogo brand="instapay" height={12} />;
  return null;
}

const PAYOUT_BRAND: Record<string, Brand | undefined> = {
  instapay: "instapay",
  vodafone_cash: "vodafone",
  etisalat_cash: "eand",
  orange_cash: "orange",
};

/** Logo for a provider payout method; banks use the caller's icon instead. */
export function payoutBrand(method: string): Brand | undefined {
  return PAYOUT_BRAND[method];
}
