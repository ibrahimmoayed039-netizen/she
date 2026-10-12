# نظام الشكاوى (تطبيق المواطن + تطبيق الموظف + برنامج الحاسوب)

## 1) إعداد Firebase (مرة واحدة)
1. أنشئ مشروعاً في https://console.firebase.google.com
2. **Authentication ← Sign-in method**: فعّل **Anonymous** و **Email/Password**.
3. **Firestore Database**: أنشئ قاعدة بيانات، ثم من تبويب Rules الصق محتوى `firestore.rules` واضغط Publish.
4. أضف تطبيقي أندرويد للمشروع بهذين الاسمين بالضبط:
   - `com.shakawi.citizen`  ← نزّل ملفه `google-services.json`
   - `com.shakawi.staff`    ← نزّل ملفه `google-services.json`
5. ضع الملفين داخل المشروع قبل الرفع:
   - ملف `com.shakawi.citizen` ← `citizen-app/app/google-services.json`
   - ملف `com.shakawi.staff` ← `staff-app/app/google-services.json`

## 2) البناء
ارفع محتويات المجلد إلى جذر المستودع (بما فيه المجلد المخفي `.github`) في فرع `main`، ثم من تبويب **Actions** ستجد 3 مهام. بعد نجاحها حمّل من الأسفل (Artifacts):
- `citizen-app-apk`  (تطبيق المواطن)
- `staff-app-apk`    (تطبيق الموظف)
- `desktop-installer` (مثبّت برنامج الحاسوب .exe)

> ملفات APK الناتجة موقّعة بمفتاح debug وتعمل للتثبيت المباشر. للنشر على Google Play تحتاج توقيع Release.

## 3) حسابات الموظفين
1. Firebase ← Authentication ← Users ← Add user (بريد + كلمة مرور).
2. انسخ **User UID** للحساب.
3. Firestore ← أنشئ مجموعة `staff` ← مستند رقمه = UID، وفيه حقل نصي `department` باسم القسم (مثال: `الكهرباء`).
   يجب أن يطابق اسم القسم تماماً ما هو مكتوب في إعدادات برنامج الحاسوب.

## 4) برنامج الحاسوب
1. ثبّته وافتح **الإعدادات**.
2. الصق مفتاح Claude API.
3. من Firebase ← Project settings ← Service accounts ← Generate new private key، ثم اختر الملف في البرنامج.
4. اضبط قائمة الأقسام واضغط **حفظ وإعادة الاتصال**. ستُحلَّل الشكاوى الجديدة وتُوجَّه تلقائياً.

## ملاحظات
- الصور تُصغَّر وتُحفظ داخل Firestore (لا حاجة لـ Storage المدفوع).
- التخزين المحلي: Firestore يحفظ كاشاً على الجهاز يبقى بعد الإغلاق ويعمل دون إنترنت، وإعدادات المواطن في SharedPreferences، وإعدادات الحاسوب في electron-store.
- مفتاح Claude وحساب الخدمة موجودان في برنامج الحاسوب فقط، لا في أي APK.
