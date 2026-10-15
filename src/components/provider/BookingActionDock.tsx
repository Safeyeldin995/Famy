import { useEffect, useRef, useState, type ReactNode } from "react";

/** Reserve the exact action height and follow the real tab bar, including safe area. */
export function BookingActionDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ actions: 96, nav: 80 });
  useEffect(() => {
    const nav = document.querySelector("nav.pro-surface");
    const measure = () =>
      setSize({
        actions: ref.current?.getBoundingClientRect().height ?? 96,
        nav: nav?.getBoundingClientRect().height ?? 80,
      });
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    if (nav) observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden="true" style={{ height: size.actions + size.nav }} />
      <div
        ref={ref}
        data-testid="booking-action-dock"
        className="fixed inset-x-0 z-30 mx-auto max-w-md border-t border-border bg-surface px-5 py-3"
        style={{ bottom: size.nav }}
      >
        {children}
      </div>
    </>
  );
}
