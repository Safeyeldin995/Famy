import { createFileRoute } from "@tanstack/react-router";
import { Route as EditAddressRoute } from "./addresses.$id";

const EditAddress = EditAddressRoute.options.component!;

export const Route = createFileRoute("/preview/addresses/$id")({ component: EditAddress });
