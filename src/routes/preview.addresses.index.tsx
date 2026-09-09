import { createFileRoute } from "@tanstack/react-router";
import { Route as AddressesIndexRoute } from "./addresses.index";

const Addresses = AddressesIndexRoute.options.component!;

export const Route = createFileRoute("/preview/addresses/")({ component: Addresses });
