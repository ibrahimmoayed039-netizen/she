# نظام الشكاوى (تطبيق المواطن + تطبيق الموظف + برنامج الحاسوب)

## 1) إعداد Firebase (يفعله كل زبون مرة واحدة بحسابه)
1. أنشئ مشروعاً في https://console.firebase.google.com (أوقف Gemini وGoogle Analytics، غير مطلوبين).
2. **Authentication ← Sign-in method**: فعّل **Anonymous** و **Email/Password**.
3. **Firestore Database**: أنشئ قاعدة بيانات، ثم من تبويب Rules الصق محتوى `firestore.rules` واضغط Publish.
4. من Project settings أضف **تطبيق أندرويد واحداً** (أي اسم حزمة) ونزّل `google-services.json`.
5. **تطبيق المواطن (للتوزيع على الجمهور)**: حوّل `google-services.json` إلى Base64 (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json"))`) وأضفه في GitHub ← Settings ← Secrets and variables ← Actions باسم `CITIZEN_GOOGLE_SERVICES`. عند البناء يُدمج داخل الـ APK فيعمل مباشرة دون أي خطوة من المواطن. لكل زبون جديد غيّر قيمة السر وشغّل Actions من جديد.
6. **تطبيق الموظف**: افتحه وفي شاشة «ربط قاعدة البيانات» اختر الملف (أو الصق محتواه)، مرة واحدة لكل جهاز. وزر «تغيير إعدادات الاتصال» في شاشة الدخول لتغيير المشروع.

## 2) البناء (مرة واحدة فقط لكل الزبائن)
ارفع محتويات المجلد إلى جذر المستودع (بما فيه المجلد المخفي `.github`) في فرع `main`، ثم من تبويب **Actions** حمّل من Artifacts:
- `citizen-app-apk`  (تطبيق المواطن)
- `staff-app-apk`    (تطبيق الموظف)
- `desktop-installer` (مثبّت برنامج الحاسوب .exe)

الكود نفسه لجميع الزبائن، والذي يتغير فقط هو سر `CITIZEN_GOOGLE_SERVICES`. لا ترفع `google-services.json` إلى المستودع.

> ملفات APK موقّعة بمفتاح debug وتعمل للتثبيت المباشر. للنشر على Google Play تحتاج توقيع Release.

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

## طريقة التحليل في برنامج الحاسوب (الإعدادات ← طريقة التحليل)
- **Claude**: الأدق، يحتاج مفتاح API ورصيد.
- **محلي (Ollama)**: مجاني ويعمل دون إنترنت. ثبّت Ollama من ollama.com، ونزّل نموذجاً (`ollama pull <الاسم>`)، واكتب اسمه في الإعدادات، واضغط «فحص اتصال Ollama». لا تفعّل خيار الصور إلا لنموذج يفهم الصور.
- **هجين**: يجرّب المحلي أولاً، وإن فشل أو لم يتأكد (اختار «أخرى» أو قسماً غير معروفاً) أرسل الشكوى إلى Claude. الشكاوى المصحوبة بصور تذهب مباشرة إلى Claude ما لم يكن النموذج المحلي يدعم الصور.

## أبسط طريقة لدمج إعدادات الزبون في تطبيق المواطن (بدون Base64 أو أسرار)
1. نزّل `google-services.json` من Firebase (تطبيق أندرويد `com.shakawi.citizen`).
2. غيّر اسمه إلى `fb_config.json`.
3. في GitHub افتح المجلد `citizen-app/app/src/main/assets` ← **Add file ← Upload files** ← ارفع الملف ← Commit. (يُفضّل أن يكون المستودع **Private**.)
4. شغّل Actions ← Run workflow، وحمّل `citizen-app-apk`.
لكل زبون جديد استبدل هذا الملف بملف مشروعه ثم أعد البناء. وإن وُجد السر `CITIZEN_GOOGLE_SERVICES` فإنه يحل محل الملف.
