import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PhoneFrame, TopBar, ErrorState } from "@/components/famio/ui";
import { AddressForm, addressFormValueToInput, addressRowToFormValue, emptyAddressFormValue, type AddressFormValue } from "@/components/famio/AddressForm";
import { useAddress, useUpdateAddress } from "@/lib/db/queries";

export const Route = createFileRoute("/addresses/$id")({ component: EditAddress });

function EditAddress() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const addressQ = useAddress(id);
  const updateAddress = useUpdateAddress();
  const [value, setValue] = useState<AddressFormValue>(emptyAddressFormValue());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (addressQ.data && !loaded) {
      setValue(addressRowToFormValue(addressQ.data));
      setLoaded(true);
    }
  }, [addressQ.data, loaded]);

  const submit = async () => {
    try {
      await updateAddress.mutateAsync({ id, ...addressFormValueToInput(value) });
      toast.success(t("addresses.saved", "Address saved"));
      nav({ to: "/addresses" });
    } catch (e: any) {
      toast.error(e?.message ?? t("setup.saveFailed", "Could not save your profile."));
    }
  };

  if (addressQ.isLoading) {
    return (
      <PhoneFrame>
        <TopBar back={{ to: "/addresses" }} title={t("common.edit")} />
        <div className="grid flex-1 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-navy" /></div>
      </PhoneFrame>
    );
  }
  if (!addressQ.data) {
    return (
      <PhoneFrame>
        <TopBar back={{ to: "/addresses" }} title={t("common.edit")} />
        <ErrorState title={t("addresses.notFound", "Address not found")} />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/addresses" }} title={t("common.edit")} />
      <div className="flex-1 px-6 pb-10 pt-2">
        <AddressForm
          value={value}
          onChange={setValue}
          onSubmit={submit}
          submitting={updateAddress.isPending}
          submitLabel={t("common.save")}
        />
      </div>
    </PhoneFrame>
  );
}
