'use strict';

// Text of the trust pages: privacy policy, terms of use, and the extra sections of "About".
// One entry per language. Blocks: { h } heading, { p } paragraph, { ul } list (same shapes as the articles).
// Everything written here matches what the site really does (see store.js / app.js); change both together.

const UPDATED = '2026-11-01';

const PAGES = {
  privacy: {
    ar: {
      title: 'سياسة الخصوصية',
      desc: 'كيف تجمع بصمة عميل بياناتك وتستخدمها وتحميها: الاسم ورقم الجوال والإعلانات وملفات تعريف الارتباط.',
      lede: 'نجمع أقل قدر من البيانات اللازمة لتشغيل موقع إعلانات الأرقام المميزة، ولا نبيع بياناتك لأي جهة.',
      blocks: [
        { h: 'البيانات التي نجمعها' },
        {
          ul: [
            'عند التسجيل: الاسم ورقم الجوال وكلمة المرور. كلمة المرور تُحفظ مشفّرة ولا يمكن لأحد قراءتها.',
            'عند نشر إعلان: الرقم والسعر والمدينة والوصف ورقم التواصل الذي تكتبه.',
            'بيانات للحماية: معرّف جهاز في ملف تعريف الارتباط يساعدنا على منع الحسابات المخالفة من العودة، وعنوان الاتصال يُستخدم لتحديد المحاولات المتكررة ومنع إساءة الاستخدام.',
            'إحصاءات عامة: عدد مشاهدات الإعلانات وعدد زيارات الموقع.',
          ],
        },
        { h: 'كيف نستخدم بياناتك' },
        {
          ul: [
            'تشغيل حسابك وعرض إعلاناتك.',
            'تمكين المشتري من التواصل معك عبر واتساب.',
            'مراجعة الإعلانات والبلاغات ومنع الاحتيال.',
            'فهم كيفية استخدام الموقع وتحسينه.',
          ],
        },
        { h: 'ما الذي يراه الزوار؟' },
        {
          p: 'اسمك ورقم التواصل المكتوب في إعلانك يظهران لكل من يفتح الإعلان، لأن الغرض من الموقع هو التواصل المباشر بين المعلن والمشتري. لا تكتب في الإعلان معلومة لا تريد نشرها.',
        },
        { h: 'ملفات تعريف الارتباط (الكوكيز)' },
        {
          p: 'نستخدم ملفات صغيرة في متصفحك لتسجيل دخولك، ولتذكّر اللغة والوضع الليلي ورقم الجوال في صفحة الدخول، ولإخفاء إشعار الموقع بعد قراءته، ولمعرّف الحماية المذكور أعلاه. كما نستخدم Google Tag Manager لقياس الزيارات. يمكنك حذف الكوكيز من إعدادات متصفحك في أي وقت، وقد تحتاج بعدها إلى تسجيل الدخول من جديد.',
        },
        { h: 'مدة الاحتفاظ بالبيانات' },
        {
          p: 'يبقى الإعلان ما دام يُجدَّد، والإعلان الذي لا يُجدَّد لمدة سنة كاملة يُحذف تلقائياً. الإعلانات المباعة تبقى كسجل لصاحبها. بيانات حسابك تبقى ما دام حسابك قائماً.',
        },
        { h: 'حقوقك' },
        {
          p: 'يمكنك في أي وقت طلب تعديل بياناتك أو حذف حسابك وإعلاناتك عبر صفحة «اتصل بنا»، وسنرد عليك في أقرب وقت.',
        },
        { h: 'الأطفال' },
        { p: 'الموقع غير موجّه لمن هم دون 18 سنة.' },
        { h: 'التعديلات' },
        { p: `قد نحدّث هذه السياسة عند الحاجة، ويظهر تاريخ آخر تحديث أسفل الصفحة.` },
      ],
    },
    en: {
      title: 'Privacy policy',
      desc: 'How Basmat Ameel collects, uses and protects your data: name, phone number, ads and cookies.',
      lede: 'We collect only what is needed to run a classifieds site for premium numbers, and we never sell your data.',
      blocks: [
        { h: 'What we collect' },
        {
          ul: [
            'When you register: your name, phone number and password. The password is stored hashed; nobody can read it.',
            'When you post an ad: the number, price, city, description and the contact number you write.',
            'Safety data: a device identifier in a cookie that helps us keep banned accounts out, and the connection address, used to limit repeated attempts and abuse.',
            'General statistics: ad views and site visits.',
          ],
        },
        { h: 'How we use it' },
        {
          ul: [
            'To run your account and show your ads.',
            'To let buyers contact you on WhatsApp.',
            'To review ads and reports and prevent fraud.',
            'To understand how the site is used and improve it.',
          ],
        },
        { h: 'What visitors can see' },
        {
          p: 'Your name and the contact number in your ad are visible to anyone who opens it, because the purpose of the site is direct contact between advertiser and buyer. Do not put anything in an ad that you do not want published.',
        },
        { h: 'Cookies' },
        {
          p: 'We use small files in your browser to keep you signed in, to remember your language, dark mode and phone number on the sign-in page, to hide the site notice once read, and for the safety identifier above. We also use Google Tag Manager to measure visits. You can delete cookies in your browser at any time; you may then need to sign in again.',
        },
        { h: 'How long we keep data' },
        {
          p: 'An ad stays as long as it is renewed; an ad that is not renewed for a full year is deleted automatically. Sold ads stay as a record for their owner. Your account data stays while your account exists.',
        },
        { h: 'Your rights' },
        { p: 'You can ask at any time to correct your data or delete your account and ads through the Contact page, and we will reply as soon as we can.' },
        { h: 'Children' },
        { p: 'The site is not aimed at anyone under 18.' },
        { h: 'Changes' },
        { p: `We may update this policy when needed.` },
      ],
    },
  },

  terms: {
    ar: {
      title: 'شروط الاستخدام',
      desc: 'شروط استخدام بصمة عميل: طبيعة الموقع، مسؤولية المعلن والمشتري، المحظورات، وصلاحيات الإدارة.',
      lede: 'باستخدامك الموقع أو نشر إعلان فيه فأنت توافق على هذه الشروط.',
      blocks: [
        { h: 'طبيعة الموقع' },
        {
          p: 'بصمة عميل موقع إعلانات مجاني للأرقام المميزة. نحن لا نملك الأرقام المعروضة ولا نبيعها، ولسنا طرفاً في عملية البيع والشراء، ولا نستلم أي أموال. والموقع غير تابع لأي شركة اتصالات.',
        },
        { h: 'مسؤولية المعلن' },
        {
          ul: [
            'أن يكون الرقم المعروض مملوكاً له أو مفوّضاً ببيعه.',
            'أن يكتب السعر والبيانات بصدق ودقة.',
            'أن يحدّث إعلانه أو يشير إلى أنه مباع حين يبيع الرقم.',
          ],
        },
        { h: 'مسؤولية المشتري' },
        {
          ul: [
            'التحقق من الرقم وصاحبه قبل أي دفع.',
            'نقل ملكية الرقم عبر القنوات الرسمية لشركة الاتصالات فقط.',
            'عدم تحويل أي مبلغ قبل الاطمئنان إلى البائع وطريقة النقل.',
          ],
        },
        { h: 'المحظورات' },
        {
          ul: [
            'عرض رقم لا تملكه أو لا تملك حق بيعه.',
            'كتابة سعر أو معلومات مضللة.',
            'وضع وسائل تواصل خارجية أو روابط في وصف الإعلان.',
            'تكرار الإعلان نفسه، أو حذف رقم وإعادة نشره للتحايل على النظام.',
            'الإساءة للآخرين أو استخدام الموقع لغرض مخالف للأنظمة.',
          ],
        },
        { h: 'حدود الإعلانات والمراجعة' },
        {
          p: 'لكل عضو حد أقصى لعدد الإعلانات، ويرتفع للحسابات الموثقة. بعض الأرقام النادرة والأسعار المرتفعة جداً تُراجع من الإدارة قبل ظهورها. يُجدَّد الإعلان بزر التحديث ليبقى في الأعلى، والإعلان الذي لا يُجدَّد لمدة سنة يُحذف.',
        },
        { h: 'صلاحيات الإدارة' },
        {
          p: 'يحق للإدارة مراجعة أي إعلان وإخفاءه أو حذفه، وتعليق أو إيقاف أي حساب مخالف دون إشعار مسبق، وذلك لحماية المستخدمين والموقع.',
        },
        { h: 'إخلاء المسؤولية' },
        {
          p: 'يُقدَّم الموقع كما هو. لا نضمن إتمام أي صفقة ولا دقة كل إعلان، ولا نتحمل أي خسارة تنتج عن التعامل بين المستخدمين. الموقع غير مسؤول عن البيع والشراء.',
        },
        { h: 'الإعلانات الدعائية' },
        {
          p: 'قد يعرض الموقع إعلانات ترويجية، منها إعلان الراعي الرسمي «ابو سارة للارقام المميزة». روابط هذه الإعلانات تفتح مواقع خارجية لا نتحكم في محتواها.',
        },
        { h: 'حقوق الموقع' },
        { p: 'تصميم الموقع ونصوصه وشعاره محفوظة لصاحبه، ولا يجوز نسخها أو إعادة نشرها دون إذن.' },
        { h: 'النظام المطبّق' },
        { p: 'تخضع هذه الشروط لأنظمة المملكة العربية السعودية.' },
        { h: 'التعديلات والتواصل' },
        { p: `قد نعدّل هذه الشروط عند الحاجة، واستمرارك في استخدام الموقع بعد التعديل يعني موافقتك عليه. لأي استفسار تواصل معنا من صفحة «اتصل بنا».` },
      ],
    },
    en: {
      title: 'Terms of use',
      desc: 'Terms of use of Basmat Ameel: what the site is, advertiser and buyer duties, what is not allowed, and the team\'s powers.',
      lede: 'By using the site or posting an ad you agree to these terms.',
      blocks: [
        { h: 'What the site is' },
        {
          p: 'Basmat Ameel is a free classifieds site for premium numbers. We do not own or sell the listed numbers, we are not a party to any sale, and we never receive money. The site is not affiliated with any telecom operator.',
        },
        { h: 'Advertiser duties' },
        {
          ul: [
            'The number must be yours, or you must be authorised to sell it.',
            'Write the price and details honestly and accurately.',
            'Update your ad, or mark it sold, once the number is sold.',
          ],
        },
        { h: 'Buyer duties' },
        {
          ul: [
            'Check the number and its owner before paying anything.',
            'Transfer ownership only through the operator\'s official channels.',
            'Do not send money before you are comfortable with the seller and the transfer method.',
          ],
        },
        { h: 'Not allowed' },
        {
          ul: [
            'Listing a number you do not own or have no right to sell.',
            'Misleading prices or information.',
            'Outside contact details or links in the ad description.',
            'Duplicating the same ad, or deleting and reposting a number to get around the system.',
            'Abusing others or using the site for anything against the law.',
          ],
        },
        { h: 'Ad limits and review' },
        {
          p: 'Each member has a maximum number of ads, higher for verified accounts. Some rare numbers and very high prices are reviewed by the team before they appear. An ad is renewed with the refresh button to stay near the top, and an ad not renewed for a year is deleted.',
        },
        { h: 'The team\'s powers' },
        {
          p: 'The team may review, hide or delete any ad, and suspend or ban any account that breaks these terms, without prior notice, to protect users and the site.',
        },
        { h: 'Disclaimer' },
        {
          p: 'The site is provided as it is. We do not guarantee that any deal will be completed or that every ad is accurate, and we are not liable for losses from dealings between users. The site is not responsible for buying and selling.',
        },
        { h: 'Promotional ads' },
        {
          p: 'The site may show promotions, including the ad of its official sponsor "Abu Sarah Premium Numbers". These links open external sites whose content we do not control.',
        },
        { h: 'Site rights' },
        { p: 'The design, text and logo of the site belong to its owner and may not be copied or republished without permission.' },
        { h: 'Applicable law' },
        { p: 'These terms are governed by the laws of the Kingdom of Saudi Arabia.' },
        { h: 'Changes and contact' },
        { p: `We may change these terms when needed; using the site after a change means you accept it. For any question, use the Contact page.` },
      ],
    },
  },

  // Extra sections shown on the "About" page, under the existing short text.
  about: {
    ar: [
      { h: 'من نحن' },
      {
        p: 'بصمة عميل موقع إعلانات مجاني للأرقام المميزة في السعودية. يديره صاحب متجر «ابو سارة للارقام المميزة»، الراعي الرسمي للموقع، بهدف تسهيل عرض الأرقام على أصحابها والعثور على الرقم المناسب للمشتري.',
      },
      { h: 'كيف يعمل الموقع' },
      {
        ul: [
          'يسجّل صاحب الرقم في الموقع ويضيف إعلانه مجاناً.',
          'يظهر الرقم مع سعره ومدينته وشبكته، ويمكن البحث والتصفح حسب الشبكة والمدينة والنمط والسعر.',
          'يتواصل المشتري مع المعلن مباشرة عبر واتساب ويتفقان على السعر.',
          'ينتقل الرقم باسم المشتري عبر القنوات الرسمية لشركة الاتصالات.',
        ],
      },
      { h: 'كيف نحمي الزوار' },
      {
        ul: [
          'الأرقام النادرة جداً والأسعار المرتفعة جداً تُراجع من الإدارة قبل ظهورها.',
          'يمكن لأي زائر الإبلاغ عن أي إعلان مشكوك فيه.',
          'تُوقف الحسابات المخالفة، ويُمنع وضع وسائل تواصل خارجية في الإعلانات.',
          'تقييمات البائعين تُراجع من الإدارة قبل أن تظهر.',
        ],
      },
      { h: 'ما لا نقوم به' },
      {
        p: 'لا نستلم أموالاً ولا نضمن الصفقات ولا نمثل أي شركة اتصالات. تحقق دائماً من الرقم ومن صاحبه قبل الدفع، وانقل الرقم عبر القنوات الرسمية فقط.',
      },
    ],
    en: [
      { h: 'Who we are' },
      {
        p: 'Basmat Ameel is a free classifieds site for premium numbers in Saudi Arabia. It is run by the owner of the store "Abu Sarah Premium Numbers", the official sponsor of the site, to make it easy for owners to list numbers and for buyers to find the right one.',
      },
      { h: 'How the site works' },
      {
        ul: [
          'The owner of a number registers and posts the ad for free.',
          'The number appears with its price, city and network, and can be searched or browsed by network, city, pattern and price.',
          'The buyer contacts the advertiser directly on WhatsApp and they agree on the price.',
          'The number is transferred to the buyer through the operator\'s official channels.',
        ],
      },
      { h: 'How we protect visitors' },
      {
        ul: [
          'Very rare numbers and very high prices are reviewed by the team before they appear.',
          'Any visitor can report a suspicious ad.',
          'Accounts that break the rules are suspended, and outside contact details are not allowed in ads.',
          'Seller ratings are reviewed by the team before they appear.',
        ],
      },
      { h: 'What we do not do' },
      {
        p: 'We do not receive money, guarantee deals or represent any telecom operator. Always check the number and its owner before paying, and transfer the number only through official channels.',
      },
    ],
  },
};

module.exports = { PAGES, UPDATED };
