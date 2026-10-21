# Submission checklist / قائمة النشر

This is a preparation draft, not a claim that either store form is ready to submit. / دي مسودة تجهيز، مش تأكيد إن النموذجين جاهزين للتقديم.

## العربية

| المالك | المطلوب قبل التقديم |
| --- | --- |
| صاحب التطبيق | تفعيل حساب Apple Developer وApp Store Connect، إنشاء سجل التطبيق والاتفاقيات المطلوبة. |
| صاحب التطبيق | تفعيل حساب Google Play Console، إنشاء سجل التطبيق ومتطلبات الاختبار/التحقق للحساب. |
| صاحب التطبيق | إنشاء مشروع EAS وربطه بالتطبيق، وإدارة شهادات iOS وتوقيع Android وبيانات الإرسال خارج Git؛ استبدال القيم التجريبية في [eas.json](../../mobile/eas.json) وقت الإرسال. |
| صاحب التطبيق | تحديد نطاق رسمي ثابت وصفحة سياسة الخصوصية ورابط عام لطلب حذف الحساب؛ مراجعة إعدادات رابط الويب للدفع والتسجيل. |
| صاحب التطبيق | اعتماد اسم الشركة وبيانات الدعم والجهة القانونية وسياسة الاحتفاظ بالبيانات. |
| صاحب التطبيق | توفير حسابي اختبار عميل ومقدم خدمة، وحجز/سيناريو دفع تجريبي وتعليمات المراجعة في حقول المتاجر الخاصة فقط. |
| صاحب التطبيق | تصوير لقطات عربية وإنجليزية فعلية للأجهزة المطلوبة، مراجعة الأيقونة وأصول المتجر والوصف النهائي. |
| Claude/المطورون | تنفيذ حذف الحساب وطلب حذف البيانات داخل التطبيق وخارجه، ثم اختبار المسارين وتحديث الإفصاحات. |
| Claude/المطورون | نقل إنشاء حساب الهاتف وOTP وإعادة ضبطه إلى التطبيق بدل التحويل للويب. [الحالة الحالية](../../mobile/src/app/login.tsx). |
| Claude/المطورون | إضافة Sign in with Apple على iOS إذا قدم Google sign-in داخل التطبيق وطلبت إرشادات Apple ذلك؛ تأكيد خيارات الدخول النهائية قبل المراجعة. [Google على الويب](../../src/lib/auth/oauth.ts). |
| Claude/المطورون | تدقيق الحزمة النهائية وSDKs والمكتبات ضد Data safety وApp Privacy، ثم اختبار بناء Android/iOS وإرسال تجريبي. |
| Claude/المطورون | التأكد من أن وصف الأذونات النهائي في إعدادات التطبيق يطابق استخدام الموقع والصور والملفات، ومن أن رابط الخصوصية والحذف يعملان. |

## English

| Owner | Required before submission |
| --- | --- |
| App owner | Activate Apple Developer and App Store Connect, create the app record and complete required agreements. |
| App owner | Activate Google Play Console, create the listing and satisfy account verification/testing requirements. |
| App owner | Create/link the EAS project; manage iOS certificates, Android signing and submission credentials outside Git; replace [eas.json](../../mobile/eas.json) placeholders at submission time. |
| App owner | Provide a stable official domain, live privacy-policy page and public account-deletion request URL; verify web sign-up/payment origins. |
| App owner | Approve company, legal and support details and a data-retention policy. |
| App owner | Provide customer/provider review accounts, safe sample booking/payment path and private store-review instructions only. |
| App owner | Capture real Arabic/English screenshots for required device sizes; approve icon, store assets and final copy. |
| Claude/developers | Implement and test in-app account deletion plus an external deletion-request path; update disclosures afterward. |
| Claude/developers | Bring phone/OTP sign-up and reset into the app instead of the current web handoff. [Current flow](../../mobile/src/app/login.tsx). |
| Claude/developers | Add Sign in with Apple on iOS if Google sign-in is offered in the app and Apple's rules require it; verify final sign-in options. [Web Google flow](../../src/lib/auth/oauth.ts). |
| Claude/developers | Audit final bundled SDK behavior against both privacy forms, then test Android/iOS builds and a dry-run submission. |
| Claude/developers | Ensure final permission text matches location/photos/files behavior and verify live privacy/deletion URLs. |

EAS configuration follows [Expo build profiles](https://docs.expo.dev/build/eas-json/) and [Expo submission profiles](https://docs.expo.dev/submit/eas-json/). Development is an internal installable build, not an Expo development-client build (that package is not in this repository); preview is an internal Android APK; production uses store defaults. / إعداد development نسخة تثبيت داخلية، وليس development-client لأن الحزمة غير موجودة؛ preview ملف APK داخلي وproduction بإعدادات المتجر.
