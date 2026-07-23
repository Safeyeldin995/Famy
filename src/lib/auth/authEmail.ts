/** Deterministic synthetic email used as the auth identifier for a phone. */
export function authEmailForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `phone-${digits}@famio.local`;
}
