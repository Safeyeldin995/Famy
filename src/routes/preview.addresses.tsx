import { createFileRoute } from "@tanstack/react-router";
import { Route as AddressesRoute } from "./addresses";

const Addresses = AddressesRoute.options.component!;

export const Route = createFileRoute("/preview/addresses")({ component: Addresses });
