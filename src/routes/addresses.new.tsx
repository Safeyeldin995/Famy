import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, TopBar } from "@/components/famio/ui";
import { AddressForm, addressFormValueToInput, emptyAddressFormValue } from "@/components/famio/AddressForm";
import { useAddresses, useCreateAddress } from "@/lib/db/queries";

export const Route = createFileRoute("/addresses/new")({ component: NewAddress });

function NewAddress() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const createAddress = useCreateAddress();
  const addressesQ = useAddresses();
  const [value, setValue] = useState(emptyAddressFormValue());

  const submit = async () => {
    try {
      const isFirst = (addressesQ.data?.length ?? 0) === 0;
      await createAddress.mutateAsync({ ...addressFormValueToInput(value), is_default: isFirst || value.isDefault });
      toast.success(t("addresses.saved", "Address saved"));
      nav({ to: "/addresses" });
    } catch (e: any) {
      toast.error(e?.message ?? t("setup.saveFailed", "Could not save your profile."));
    }
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/addresses" }} title={t("addresses.addAddress", "Add address")} />
      <div className="flex-1 px-6 pb-10 pt-2">
        <AddressForm
          value={value}
          onChange={setValue}
          onSubmit={submit}
          submitting={createAddress.isPending}
          submitLabel={t("common.save")}
        />
      </div>
    </PhoneFrame>
  );
}
