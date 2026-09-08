import { createFileRoute } from "@tanstack/react-router";
import { Route as NewAddressRoute } from "./addresses.new";

const NewAddress = NewAddressRoute.options.component!;

export const Route = createFileRoute("/preview/addresses/new")({ component: NewAddress });
