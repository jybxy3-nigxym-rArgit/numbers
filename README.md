# بصمة عميل (Basmat Ameel)

موقع إعلانات مجاني للأرقام المميزة (مثل حراج، لكن للأرقام فقط). عربي وإنجليزي.

**وش يسوي الموقع**
- أي أحد يسجّل حساب برقم الجوال وينشر إعلان رقم مميز (الرقم، الشبكة، المدينة، السعر).
- المشتري يبحث بالأرقام أو بالأنماط (555، 5555، تسلسل 1234، نهاية معكوسة...) ويفلتر بالشبكة والمدينة والسعر.
- زر واتساب مباشر للبائع، وزر بلاغ. ثلاثة أشخاص يبلّغون = الإعلان ينخفي لين تراجعه.
- لوحة إدارة لك: موافقة، إخفاء، حذف، وحظر مستخدمين.
- الموقع **ما يحجز فلوس**. فيه تنبيه أمان واضح في كل إعلان.

**ما يحتاج مكتبات خارجية.** يحتاج بس Node.js نسخة 22.13 أو أحدث.

## تشغيل على جهازك

```
node --disable-warning=ExperimentalWarning server.js
```

افتح http://localhost:3000

لتحديد حساب الإدارة (سجّل في الموقع بنفس الرقم بعدها):

```
ADMIN_PHONE=0555123456 node --disable-warning=ExperimentalWarning server.js
```

## الإعدادات

كلها في ملف `.env.example` مع الشرح. أهمها:

| الإعداد | وش يسوي |
|---|---|
| `ADMIN_PHONE` | رقم المدير. اللي يسجّل بهذا الرقم يصير مدير |
| `REQUIRE_APPROVAL` | `true` = كل إعلان جديد ينتظر موافقتك |
| `BASE_URL` | عنوان موقعك (للسيتماب) |
| `DATA_DIR` | مكان قاعدة البيانات. لازم يكون على قرص يبقى بعد إعادة التشغيل |

## النشر

الموقع يشتغل بطريقتين من نفس الكود:

**1) Cloudflare (مجاني، بدون بطاقة)**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jybxy3-nigxym-rArgit/numbers)

الزر ينسخ المشروع لحسابك في GitHub وينشره على Cloudflare Workers وينشئ قاعدة البيانات (D1) لوحده. الإعدادات في `wrangler.jsonc` (رقم المدير `ADMIN_PHONE` وغيره). نقطة الدخول `worker.mjs`.

**2) سيرفر عادي (Oracle أو أي VPS)**

- مجلد `deploy/` فيه سكربت تثبيت يسوي كل شي لوحده (Node و HTTPS وخدمة تشتغل دايم ونسخ احتياطي يومي). الملف `deploy/cloud-init.yaml` تلصقه وقت إنشاء السيرفر.
- أو Docker: الملف `Dockerfile` جاهز.
- أو منصة مثل Render أو Railway: لازم تضيف قرص دائم (Disk/Volume) وتوجّه `DATA_DIR` له.

كل المنطق في `app.js`، و`store.js` فيه كل استعلامات قاعدة البيانات. `server.js` يوصّله بـ Node و`worker.mjs` يوصّله بـ Cloudflare.

## الاختبارات

```
node --disable-warning=ExperimentalWarning test/e2e.js
TARGET=worker node --disable-warning=ExperimentalWarning test/e2e.js   # نسخة Cloudflare (بقاعدة تجريبية بدل D1)
```

## ملاحظات مهمة

- رقم جوال البائع **غير موثّق برسالة SMS** حالياً. لو تبي توثيق، نضيف شركة رسائل لاحقاً.
- الحماية: كلمات المرور مشفّرة (scrypt)، حماية من CSRF، تحديد محاولات الدخول، وتنظيف كل المدخلات.
- قاعدة البيانات SQLite، تكفي لآلاف الإعلانات. خذ نسخة احتياطية من مجلد `DATA_DIR` بشكل دوري.

## Free WhatsApp alerts to the owner (optional)

The site can message the owner on WhatsApp for free through CallMeBot (https://www.callmebot.com): new member, login, new ad and report.

1. Activate CallMeBot once from the owner's WhatsApp (follow the steps on callmebot.com) and keep the API key it sends back.
2. In Cloudflare add a secret named `CALLMEBOT_KEY` with that key (Workers > numbers > Settings > Variables and Secrets).
3. If the number that activated CallMeBot is not the admin phone, also add `CALLMEBOT_PHONE` (international digits, e.g. 966599900079).

Without `CALLMEBOT_KEY` nothing is sent. CallMeBot is a third-party free service and can change or stop.

Other optional settings: `RENEW_DAYS` (default 3), `REPOST_PENALTY_DAYS` (default 5), `POST_PER_HOUR` (default 30).

## Link with the Salla store (souq3rb.com)

Every number added to the store appears here; quantity 0 (or hidden/deleted) hides it here.
1. Cloudflare: Workers -> numbers -> Settings -> Variables and Secrets -> add secret `SALLA_WEBHOOK_SECRET` (any long random text).
2. Salla dashboard: Webhooks -> add `https://basmatameel.com/webhook/salla`, events `product.*` (created, updated, deleted, quantity), security strategy "Token" with the same secret (or "Signature").
3. The numbers already in the store are added once from Admin -> add many numbers; after that the link keeps them in sync.
