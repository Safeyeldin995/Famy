# Customer booking v1: visual and behavior spec

The visual reference is `customer-booking-v1.html`; `customer-booking-v1.png` is a screenshot of it. It uses the same tokens, type scale and components as `PROVIDER_APPLY_SPEC.md`. Where this spec and the HTML differ, the HTML wins for visuals and this spec wins for behavior.

## Goal
Replace the current booking wizard on `/book/$providerId`, which has up to 8 steps (service, duration, schedule, address, forWhom, requirements, summary, payment), with **4 screens**. Each screen asks one question, and the running total is always visible on the CTA.

## Screens
1. **"عايز ايه من {first name}؟"**: what you want from the provider.
   - A provider mini card: avatar, name, rating, completed bookings and area.
   - The provider's bookable services as `ServiceCard`s, single select.
   - For an hourly service, the selected card expands a `NumberStepper` for hours, using the service's existing min/max duration rules.
   - Fixed packages (full day, overnight) show their package label and fixed price, with no stepper.
   - **Tutoring:**
     - this screen shows "لمين؟" (family member chips) first;
     - then the provider's approved subject groups as cards ("رياضيات · المنهج المصري · الصف الرابع · 450 ج.م / حصة"), filtered by the child's grade where the current logic does so;
     - then session duration chips from the allowed durations.
   - CTA: "التالي · {total}".
2. **"امتى؟"**:
   - a horizontal, scrollable row of date pills for the next 14 days (day name + date). Days with no availability are dimmed and not selectable;
   - time chips in a 3-column grid. Unavailable slots are struck through and disabled;
   - fixed-start packages show only their allowed start times (reuse `filterFixedStartSlots`);
   - a brand-tint summary line: "{day} {date} · من {start} لحد {end}".
3. **"فين ولمين؟"**:
   - the saved address list as radio rows, with the default preselected, plus "+ عنوان جديد" (existing add-address flow, returning here);
   - for non-tutoring bookings, "مين هيكون مع {first name}؟" family member chips plus "+ ضيف طفل";
   - booking requirements (the old requirements step) shown inline as checkboxes, only when the service has any;
   - optional notes.
4. **"راجع وأكد"**:
   - review rows (service, time, address and who), each with "تعديل" jumping back to that screen;
   - a price breakdown from the existing quote ("4 ساعات × 250 ج.م", promo discount if any, total);
   - an optional "عندك كود خصم؟" collapsible row reusing the existing promo logic;
   - payment methods as radio rows from the existing active payment methods;
   - CTA "أكد الحجز · {total}".

## Rules
- **Pricing, quotes, commission, slot checks, fixed-package validation, payment and promo logic are unchanged.** Reuse the existing hooks and server calls; only the layout and step grouping change. Never store raw card details.
- Bookings created must be identical in data to today's for the same choices.
- Header: `StepHeader` with 4 segments and the back button. Back on screen 1 returns to the provider page.
- Mobile first at 390px, touch targets at least 44px, no horizontal page overflow (only the date row scrolls).
- No Arabic diacritics. The app font is inherited.
