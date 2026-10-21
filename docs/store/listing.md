# Store listing / وصف المتجر

## العربية

- **اسم التطبيق:** فامي
- **وصف قصير (أقل من 80 حرفا):** احجز جليسة أطفال أو مدرس خصوصي، وتابع الحجز والدفع من مكان واحد
- **الفئة المقترحة:** نمط الحياة (Lifestyle)
- **كلمات مفتاحية:** فامي، جليسة أطفال، دروس خصوصية، مدرس خصوصي، حجز

### الوصف الكامل

فامي يساعدك تدور على جليسات أطفال ومدرسين خصوصيين في مناطق الخدمة المتاحة داخل التطبيق. اختار مقدم الخدمة والوقت والعنوان المناسب، وتابع طلب الحجز من التطبيق.

تقدر تتواصل مع مقدم الخدمة في محادثة الحجز، وتراجع تفاصيل الخدمة، وتسيب تقييم بعد انتهاء الحجز. طرق الدفع المعروضة حسب الخدمة والإعدادات تشمل النقدي، إنستا باي مع رفع إثبات التحويل، والدفع بالبطاقة من خلال صفحة Paymob. مقدم الخدمة يقدر يدير طلباته ومواعيده وملفه من نفس التطبيق.

توفر الخدمات ومناطقها وطرق الدفع بيتحدد من إعدادات التطبيق وقت الحجز.

## English

- **App name:** Famy
- **Short description (under 80 characters):** Book babysitters and tutors, manage bookings and payments in one app
- **Suggested category:** Lifestyle
- **Keywords:** Famy, babysitter, tutoring, tutor, booking

### Full description

Famy helps you find babysitters and tutors in the service areas available in the app. Choose a provider, time and address, then follow your booking request in the app.

You can chat within a booking, review service details and leave a rating after a completed booking. Available payment methods, depending on the service and current settings, include cash, InstaPay with transfer-proof upload, and card checkout on Paymob's hosted page. Providers can manage requests, availability and their profiles in the same app.

Availability, service areas and payment methods are determined by the app's live settings at booking time.

## Evidence / المصادر

- Service and area settings: [booking queries](../../mobile/src/lib/bookingQueries.ts), [address screen](../../mobile/src/app/%28customer%29/addresses/new.tsx).
- Booking/chat/reviews: [booking flow](../../mobile/src/app/%28customer%29/book/[providerId].tsx), [chat queries](../../mobile/src/lib/chatQueries.ts), [review mutation](../../mobile/src/lib/bookingQueries.ts).
- Payment choices and Paymob: [payment block](../../mobile/src/ui/PaymentBlock.tsx), [hosted checkout](../../mobile/src/lib/mobilePayments.ts).
