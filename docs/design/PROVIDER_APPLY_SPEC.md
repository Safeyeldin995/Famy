# Provider apply v1: visual and behavior spec

Approved by the Product Owner on 2026-10-07. The visual reference is `provider-apply-v1.html`; open it in a browser. `provider-apply-v1.png` is a screenshot of it. **Implement to match it.** Where this spec and the HTML differ, the HTML wins for visuals and this spec wins for behavior.

## Design tokens (match the app's existing theme)
| Token | Value |
| --- | --- |
| Arabic font | `Almarai` (already `--font-arabic`), weights 400 / 700 / 800 |
| Brand | `#F10E72` (`--brand`) |
| Brand tint (selected background) | `#FFF0F6` |
| Ink / secondary ink / muted | `#17121A` / `#4D4550` / `#8B8290` |
| Line / fill (input background) | `#ECE8EA` / `#F6F4F5` |
| Success / success tint | `#12A06A` / `#E8F7F0` |
| Waiting / waiting tint | `#B46B00` / `#FFF4E2` |

Map these to the existing CSS variables where they exist. Do not introduce a second palette.

Type scale: **only these sizes**.
- Screen title: 24px / 800.
- Body and input text: 16px.
- Secondary text: 14px.
- Labels: 13px / 700.
- Captions: 12px.

## Components (reusable, in `src/components/famio/`)
1. **`StepHeader`**:
   - a 40px circular back button on the **right** (RTL), with a chevron;
   - "N من 3" in 12px muted;
   - a segmented progress bar of 3 segments, 4px high, 6px gap, filled from the right in RTL.
2. **`StickyCta`**:
   - a full-width primary button fixed at the bottom, 56px high, 18px radius, 16px/800;
   - a disabled state;
   - safe-area padding.
3. **`TextField`**:
   - label above (13px/700);
   - 56px high, 16px radius, fill background;
   - focus state is a 2px brand inset ring with a white background.
4. **`CheckChip`** (multi-select): a 44px pill. When selected it gets the brand-tint background, a 1.5px brand ring, and a small filled brand circle with a white check before the label.
5. **`ServiceCard`**:
   - a 44px icon tile, a title (15px/700) and a subtitle (12px muted);
   - a 24px square checkbox at the end;
   - when selected it gets a 2px brand ring and expands to show a `PriceStepper`.
6. **`PriceStepper`**: replaces the chip grid from #123 **everywhere** (onboarding, profile, teaching).
   - Two 44px circular buttons; the value in the middle (22px/800), followed by the unit ("ج.م / ساعة", "ج.م / حصة", or the package unit from #128); below it, "من {min} لحد {max}" (11px muted).
   - RTL mirroring: **minus on the right, plus on the left.**
   - Step: 25 when max − min ≤ 300, 50 when ≤ 1000, otherwise 100. Values stay inside [min, max] and snap to step multiples, with the endpoints always reachable.
   - Default value for a new selection: the midpoint, snapped to the step.
   - Tapping the value opens a `BottomSheetSelect` listing every allowed value, for people who prefer a dropdown.
   - Disable minus at min and plus at max.
   - If min or max is missing, fall back to step 50 from 50 upward, and show no range line.
7. **`BottomSheetSelect`**: replaces native `<select>` in provider screens.
   - Use the existing `vaul` drawer plus `cmdk` for search. No new dependencies.
   - A grab handle, a title (18px/800) and a close button.
   - Show a search field when there are more than 7 options.
   - Rows are 52px with a radio on the end; the selected row is bold.
   - The field that opens it looks like `TextField`: a small label above the value and a chevron-down.
8. **`IdCaptureCard`**:
   - an ID-card illustration, a title and a hint;
   - a dark "صور" pill button that opens `<input type="file" accept="image/*" capture="environment">`;
   - the captured state uses the success tint, "تمام" and a check.
   - Uses the existing secure document upload.

## Phase 1 screens (route `/pro/apply`, plus `/preview/pro/apply` with mock data)
1. **"أهلا بيك في فامي"**
   - Name `TextField`, prefilled from the profile.
   - "بتشتغل في أنهي مناطق؟" with active zones as `CheckChip`s (multi-select), plus the hint "تقدر تختار أكتر من منطقة".
   - Continue needs a name and at least 1 zone.
2. **"بتقدم خدمات ايه؟"**
   - Phase-1 services as `ServiceCard`s.
   - A non-tutoring selected service expands a `PriceStepper`, prefilled with the midpoint or the saved price.
   - Tutoring services show "هتحدد المواد وسعر الحصة بعد الإرسال" instead of a stepper.
   - Continue needs at least 1 service, and every selected non-tutoring service with provider pricing needs a valid price.
3. **"صور البطاقة"**
   - Front and back `IdCaptureCard`s.
   - A privacy note with a lock icon: "البطاقة بيشوفها فريق فامي بس".
   - An agreement checkbox.
   - CTA "ابعت طلبي". Enabled only with both ID sides and agreement checked.

After submit, the user lands on `/pro`. Phase 1 adds a **temporary** checklist card there, listing the remaining items. Each item links to the matching existing onboarding section until Phase 2 replaces them with new small screens.

## Server rules (Phase 1 migration)
- **Submission** needs only: full name, phone, at least 1 active zone, at least 1 phase-1 service (with a valid price where provider pricing applies), ID front and back, and accuracy confirmation.
- **Admin approval stays gated by the full set**, which is the current `provider_onboarding_completion` list (DOB/address, photo, experience, babysitting details, references, ID, and so on). Nobody becomes visible to customers without it.
- While `SUBMITTED` / `UNDER_REVIEW`, the provider can still save the deferred sections: personal extras, photo, experience, babysitting details and references. Identity fields that admin is reviewing stay as they are today.

## Global rules
- **No Arabic diacritics anywhere, including shadda**, in any source file. Extend `qa/check-ar-tashkeel.mjs` to scan `src/**/*.{ts,tsx}`, not only `ar.ts`.
- Mobile first at 390px. Touch targets are at least 44px. No horizontal overflow.
