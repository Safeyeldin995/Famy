import { createFileRoute } from "@tanstack/react-router";
import { Route as HomeRoute } from "./home";
import { CustomerPreview } from "./-customerPreview";

const Home = HomeRoute.options.component!;

export const Route = createFileRoute("/preview/home")({
  component: () => (
    <CustomerPreview>
      <Home />
    </CustomerPreview>
  ),
});
