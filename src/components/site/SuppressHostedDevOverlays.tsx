import { useEffect } from "react";

const OVERLAY_SELECTORS = [
  '[data-lovable-tagger]',
  '[data-lovable-component-tagger]',
  '#vercel-live-feedback',
  '[class*="vercel-live-feedback"]',
  'button[aria-label="Vercel Toolbar"]',
].join(", ");

/**
 * Hides third-party dev/preview chrome (Lovable tagger, Vercel toolbar) in production
 * and on hosted previews so it does not overlap /online content.
 */
export function SuppressHostedDevOverlays() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const root = document.documentElement;
    root.dataset.hideDevOverlays = "1";

    const hide = () => {
      document.querySelectorAll(OVERLAY_SELECTORS).forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.setProperty("display", "none", "important");
          el.setAttribute("aria-hidden", "true");
        }
      });
    };

    hide();
    const observer = new MutationObserver(hide);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      delete root.dataset.hideDevOverlays;
    };
  }, []);

  return null;
}