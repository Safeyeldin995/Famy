import {
  KEYBOARD_FOCUS_GAP,
  KEYBOARD_PRIMARY_INLINE_OFFSET,
  KEYBOARD_PRIMARY_STICKY_RESERVE,
} from "./keyboardFormConstants";

/** Reserve used until the sticky footer has been measured on layout. */
export function keyboardStickyFooterReserve(footerHeight: number): number {
  return footerHeight > 0 ? footerHeight : KEYBOARD_PRIMARY_STICKY_RESERVE;
}

/** Scroll inset so focused fields sit above the sticky footer and keyboard gap. */
export function keyboardStickyBottomOffset(footerHeight: number): number {
  return keyboardStickyFooterReserve(footerHeight) + KEYBOARD_FOCUS_GAP;
}

/** Bottom padding so scroll content can move above the sticky footer. */
export function keyboardStickyScrollPaddingBottom(footerHeight: number): number {
  return keyboardStickyFooterReserve(footerHeight);
}

export function keyboardInlineBottomOffset(): number {
  return KEYBOARD_PRIMARY_INLINE_OFFSET;
}
