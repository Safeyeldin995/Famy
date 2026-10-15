import { createContext, useContext, type ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

export const AdminPreviewContext = createContext(false);

/** Explicit shell context is identical on the server and first client render. */
export function adminHref(to: string, preview: boolean) {
  const path = to.replace(/^\/preview(?=\/admin(?:\/|$))/, "");
  return preview && /^\/admin(?:\/|$)/.test(path) ? "/preview" + path : path;
}

export const AdminLink = function AdminLink(props: ComponentProps<typeof Link>) {
  const preview = useContext(AdminPreviewContext);
  return (
    <Link
      {...props}
      to={
        typeof props.to === "string" ? (adminHref(props.to, preview) as typeof props.to) : props.to
      }
    />
  );
} as typeof Link;
