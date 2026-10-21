# Store review notes / ملاحظات مراجعة المتجر

## العربية

**طريقة الدخول التجريبية (يملأها المالك في حقول المراجعة الخاصة، وليس في المستودع):**
- رقم هاتف عميل الاختبار: `<TEST_CUSTOMER_PHONE>`
- كلمة المرور: `<TEST_CUSTOMER_PASSWORD>`
- رقم هاتف مقدم الخدمة: `<TEST_PROVIDER_PHONE>`
- كلمة المرور: `<TEST_PROVIDER_PASSWORD>`
- رمز التحقق/طريقة الوصول إن طلبها المراجع: `<TEST_OTP_ACCESS_INSTRUCTIONS>`
- بيانات طلب تجريبي جاهز أو خطوات إنشائه: `<REVIEW_BOOKING_STEPS>`
- جهة اتصال المراجعة: `<REVIEW_CONTACT>`

اختاروا "تسجيل الدخول" في التطبيق ثم أدخلوا الهاتف وكلمة المرور. إنشاء الحساب وإعادة ضبط كلمة المرور يفتحان مسار الويب حاليا؛ وفروا حسابات اختبار جاهزة للمراجعين. لا تضعوا أي بيانات دخول حقيقية في Git. [شاشة الدخول](../../mobile/src/app/login.tsx).

**الأذونات:** الموقع الأمامي يستخدم فقط عند ضغط "استخدم موقعي" لإضافة عنوان خدمة، وخانات العنوان النصية متاحة، لكن حفظ العنوان يتطلب تحديد الموقع. الوصول للصور لاختيار صورة الملف أو إيصال دفع؛ اختيار الملفات لإيصالات PDF ومستندات التقديم. لا يستخدم التطبيق الكاميرا أو الميكروفون في المسارات الحالية. [العنوان](../../mobile/src/app/%28customer%29/addresses/new.tsx)، [الإيصالات](../../mobile/src/ui/PaymentBlock.tsx)، [مستندات المقدم](../../mobile/src/ui/provider/DocumentUploadCard.tsx).

**الدفع:** الحجوزات تخص رعاية أطفال ودروسا خصوصية تقدم في العالم الحقيقي، وليست سلعا رقمية داخل التطبيق. النقدي وإنستا باي متاحان حسب إعدادات الدفع، والبطاقة تمر عبر صفحة Paymob المستضافة. لا تطلبوا دفعا حقيقيا من المراجع؛ جهزوا حجز اختبار وطريقة اختبار مناسبة في حسابات المراجعة. [خيارات الدفع](../../mobile/src/lib/bookingQueries.ts)، [Paymob](../../mobile/src/lib/mobilePayments.ts).

## English

**Review login (owner fills these in the private store-review fields, never in Git):**
- Test customer phone: `<TEST_CUSTOMER_PHONE>`
- Password: `<TEST_CUSTOMER_PASSWORD>`
- Test provider phone: `<TEST_PROVIDER_PHONE>`
- Password: `<TEST_PROVIDER_PASSWORD>`
- OTP/reviewer-access instructions if required: `<TEST_OTP_ACCESS_INSTRUCTIONS>`
- Existing test booking or creation steps: `<REVIEW_BOOKING_STEPS>`
- Review contact: `<REVIEW_CONTACT>`

Select Sign in in the app, then enter the phone and password. Sign-up and reset currently hand off to the web, so supply ready review accounts. Never commit live credentials. [Login screen](../../mobile/src/app/login.tsx).

**Permissions:** Foreground location is requested only when choosing Use my location to set a service address. Photo-library access lets users choose a profile image or transfer receipt; file selection supports PDF receipts and provider documents. The current paths do not use camera or microphone. [Address](../../mobile/src/app/%28customer%29/addresses/new.tsx), [receipts](../../mobile/src/ui/PaymentBlock.tsx), [provider documents](../../mobile/src/ui/provider/DocumentUploadCard.tsx).

**Payments:** Babysitting and tutoring are real-world services, not in-app digital goods. Cash/InstaPay availability depends on payment settings; card checkout opens Paymob's hosted page. Give reviewers a safe test booking/payment path that does not require a live charge. [Payment choices](../../mobile/src/lib/bookingQueries.ts), [Paymob](../../mobile/src/lib/mobilePayments.ts).
