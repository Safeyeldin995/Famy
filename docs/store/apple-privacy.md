# App Store App Privacy / خصوصية التطبيق في App Store

Draft nutrition-label mapping for the combined customer/provider binary. Apple asks for data collected by the developer **and third-party partners**: [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/). Verify final binary/SDK disclosures before submission.

## العربية

**البيانات المرتبطة بالمستخدم، لغرض وظائف التطبيق:**

| فئة Apple | البيانات الفعلية | الدليل |
| --- | --- | --- |
| معلومات الاتصال | الاسم، رقم الهاتف، العنوان؛ وقد يدخل ولي الأمر رقم طوارئ | [الدخول](../../mobile/src/app/login.tsx)، [العناوين](../../mobile/src/lib/bookingQueries.ts)، [أفراد الأسرة](../../mobile/src/lib/queries.ts) |
| الموقع: دقيق | إحداثيات الجهاز عندما يختار المستخدم إضافتها لعنوانه | [استخدام الموقع](../../mobile/src/app/%28customer%29/addresses/new.tsx) |
| معلومات حساسة | بطاقة هوية المقدم ومراجع طلبه؛ راجعوا تصنيفها النهائي في App Store Connect | [أنواع المستندات](../../mobile/src/lib/provider/onboardingQueries.ts)، [رفعها](../../mobile/src/lib/provider/documentUpload.ts) |
| الصحة واللياقة: صحة | الحساسية والملاحظات الطبية الاختيارية للطفل | [نموذج الطفل](../../mobile/src/lib/familyForm.ts) |
| المحتوى الذي ينشئه المستخدم | المحادثات، ملاحظات الحجز، الصور، المستندات، إيصالات التحويل، التقييمات والتعليقات | [المحادثة](../../mobile/src/lib/chatQueries.ts)، [الإيصال](../../mobile/src/lib/mobilePayments.ts)، [التقييمات](../../mobile/src/lib/bookingQueries.ts) |
| المشتريات / المعلومات المالية الأخرى | الخدمة المحجوزة، المبلغ، طريقة الدفع وحالته؛ **لا يجمع التطبيق رقم البطاقة** لأن إدخاله في صفحة Paymob | [الحجز والدفع](../../mobile/src/lib/bookingQueries.ts)، [Paymob](../../mobile/src/lib/mobilePayments.ts) |
| المعرفات: معرف المستخدم | معرف الحساب والطلبات المرتبطة به | [الجلسة](../../mobile/src/lib/session.tsx)، [حفظ العنوان](../../mobile/src/lib/bookingQueries.ts) |
| معلومات شخصية أخرى | بيانات الطفل، التعليم، خبرة المقدم، المناطق والمراجع | [الأسرة](../../mobile/src/lib/queries.ts)، [طلب المقدم](../../mobile/src/lib/provider/onboardingQueries.ts) |
| بيانات الاستخدام: تفاعلات المنتج | المفضلة وطلبات الحجز وحالة القراءة؛ وظائف التطبيق فقط | [المفضلة](../../mobile/src/lib/queries.ts)، [الحجز](../../mobile/src/lib/bookingQueries.ts)، [المحادثة](../../mobile/src/lib/chatQueries.ts) |

**تتبع بين التطبيقات/المواقع:** لا يظهر استخدام إعلاني أو تتبع في المسارات المفحوصة؛ تأكدوا من إعدادات SDK النهائية. **إعلانات أو تسويق:** لا استخدام مثبت هنا. **بيانات غير مرتبطة بالمستخدم:** لا تفترضوا وجودها أو غيابها قبل مراجعة أدوات SDK والسجلات. **الحذف:** ميزة حذف الحساب داخل التطبيق لم تنفذ بعد.

## English

**Data linked to the user, used for app functionality:**

| Apple category | Actual data | Evidence |
| --- | --- | --- |
| Contact Info | Name, phone, physical address; optional emergency-contact details | [Login](../../mobile/src/app/login.tsx), [addresses](../../mobile/src/lib/bookingQueries.ts), [family members](../../mobile/src/lib/queries.ts) |
| Location: Precise Location | Device coordinates when the user chooses to pin a service address | [Location flow](../../mobile/src/app/%28customer%29/addresses/new.tsx) |
| Sensitive Info | Provider identity documents and application references; confirm exact Connect classification | [Document types](../../mobile/src/lib/provider/onboardingQueries.ts), [upload](../../mobile/src/lib/provider/documentUpload.ts) |
| Health & Fitness: Health | Optional child allergy and medical notes | [Family form](../../mobile/src/lib/familyForm.ts) |
| User Content | Chat, booking notes, photos, documents, transfer receipts, ratings/comments | [Chat](../../mobile/src/lib/chatQueries.ts), [proof](../../mobile/src/lib/mobilePayments.ts), [reviews](../../mobile/src/lib/bookingQueries.ts) |
| Purchases / Other Financial Info | Booked service, amount, payment method/status; **not raw card numbers**, which are entered on Paymob's hosted page | [Bookings/payments](../../mobile/src/lib/bookingQueries.ts), [Paymob](../../mobile/src/lib/mobilePayments.ts) |
| Identifiers: User ID | Account identifier linked to bookings and addresses | [Session](../../mobile/src/lib/session.tsx), [address write](../../mobile/src/lib/bookingQueries.ts) |
| Other Data | Dependent details, education, provider experience/coverage/references | [Family members](../../mobile/src/lib/queries.ts), [onboarding](../../mobile/src/lib/provider/onboardingQueries.ts) |
| Usage Data: Product Interaction | Favorites, booking activity and read state, for app functions | [Favorites](../../mobile/src/lib/queries.ts), [bookings](../../mobile/src/lib/bookingQueries.ts), [chat](../../mobile/src/lib/chatQueries.ts) |

**Cross-app tracking:** No advertising/tracking use is evidenced in the inspected paths; verify bundled SDK behavior before selecting No. **Advertising/marketing:** None evidenced here. **Data not linked to user:** Do not assert a category until final SDK/log review. **Deletion:** In-app account deletion remains unimplemented.
