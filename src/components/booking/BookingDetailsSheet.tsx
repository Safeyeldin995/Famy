import { useState } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AddressForm,
  addressFormValueToInput,
  emptyAddressFormValue,
} from "@/components/famio/AddressForm";
import {
  FamilyMemberForm,
  emptyFamilyMemberFormValue,
  familyMemberFormValueToInput,
} from "@/components/famio/FamilyMemberForm";
import { useCreateAddress } from "@/lib/db/queries";
import { useCreateFamilyMember } from "@/lib/db/family-members-queries";
import { familyMemberErrorMessageKey } from "@/lib/db/familyMemberErrors";

/** Keep the booking mounted while using the existing validated add-address/member forms. */
export function BookingDetailsSheet({
  kind,
  firstAddress,
  onClose,
}: {
  kind: "address" | "member";
  firstAddress: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [address, setAddress] = useState(emptyAddressFormValue);
  const [member, setMember] = useState(emptyFamilyMemberFormValue);
  const [error, setError] = useState("");
  const createAddress = useCreateAddress();
  const createMember = useCreateFamilyMember();
  const pending = createAddress.isPending || createMember.isPending;
  const save = async () => {
    setError("");
    try {
      if (kind === "address")
        await createAddress.mutateAsync({
          ...addressFormValueToInput(address),
          is_default: firstAddress || address.isDefault,
        });
      else await createMember.mutateAsync(familyMemberFormValueToInput(member));
      onClose();
    } catch (error: unknown) {
      setError(
        kind === "member"
          ? t(familyMemberErrorMessageKey(error))
          : error instanceof Error
            ? error.message
            : t("setup.saveFailed"),
      );
    }
  };
  return (
    <Drawer.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      dismissible={!pending}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          className="apply-ui apply-sheet"
          dir={i18n.dir()}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-lg font-extrabold">
              {t(kind === "address" ? "addresses.addAddress" : "familyMembers.addMember")}
            </Drawer.Title>
            <button
              type="button"
              disabled={pending}
              className="apply-back"
              onClick={onClose}
              aria-label={t("providerApply.close")}
            >
              <X size={18} />
            </button>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto pb-6">
            {error && (
              <p role="alert" className="booking-error">
                {error}
              </p>
            )}
            {kind === "address" ? (
              <AddressForm
                value={address}
                onChange={setAddress}
                onSubmit={save}
                submitting={pending}
                submitLabel={t("common.save")}
              />
            ) : (
              <FamilyMemberForm
                nestedDatePicker
                value={member}
                onChange={setMember}
                onSubmit={save}
                submitting={pending}
                submitLabel={t("common.save")}
              />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
