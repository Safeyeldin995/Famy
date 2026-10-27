/** Same customer currency presentation as web src/lib/format, without its DOM i18n dependency. */
export function customerNumber(value: number, language: string) {
  return new Intl.NumberFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-EG").format(
    value,
  );
}
export function customerMoney(value: number | string, language: string, perHour = false) {
  const number = customerNumber(Number(value), language);
  return language.startsWith("ar")
    ? `${number} ج.م${perHour ? "/س" : ""}`
    : `EGP ${number}${perHour ? "/hr" : ""}`;
}
