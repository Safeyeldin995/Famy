import { View } from "react-native";
import { Image } from "expo-image";
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
