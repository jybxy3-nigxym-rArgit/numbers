'use strict';

// Networks and cities offered in forms and filters.
// `key` is what we store in the database; en/ar are display names.

const NETWORKS = [
  { key: 'stc', en: 'STC', ar: 'STC' },
  { key: 'mobily', en: 'Mobily', ar: 'موبايلي' },
  { key: 'zain', en: 'Zain', ar: 'زين' },
  { key: 'virgin', en: 'Virgin Mobile', ar: 'فيرجن موبايل' },
  { key: 'lebara', en: 'Lebara', ar: 'ليبارا' },
  { key: 'salam', en: 'Salam', ar: 'سلام' },
];

const CITIES = [
  { key: 'riyadh', en: 'Riyadh', ar: 'الرياض' },
  { key: 'jeddah', en: 'Jeddah', ar: 'جدة' },
  { key: 'makkah', en: 'Makkah', ar: 'مكة المكرمة' },
  { key: 'madinah', en: 'Madinah', ar: 'المدينة المنورة' },
  { key: 'dammam', en: 'Dammam', ar: 'الدمام' },
  { key: 'khobar', en: 'Khobar', ar: 'الخبر' },
  { key: 'dhahran', en: 'Dhahran', ar: 'الظهران' },
  { key: 'qatif', en: 'Qatif', ar: 'القطيف' },
  { key: 'ahsa', en: 'Al-Ahsa', ar: 'الأحساء' },
  { key: 'jubail', en: 'Jubail', ar: 'الجبيل' },
  { key: 'hafar', en: 'Hafar Al-Batin', ar: 'حفر الباطن' },
  { key: 'taif', en: 'Taif', ar: 'الطائف' },
  { key: 'tabuk', en: 'Tabuk', ar: 'تبوك' },
  { key: 'buraydah', en: 'Buraydah', ar: 'بريدة' },
  { key: 'unaizah', en: 'Unaizah', ar: 'عنيزة' },
  { key: 'hail', en: 'Hail', ar: 'حائل' },
  { key: 'kharj', en: 'Al-Kharj', ar: 'الخرج' },
  { key: 'shaqra', en: 'Shaqra', ar: 'شقراء' },
  { key: 'dawadmi', en: 'Dawadmi', ar: 'الدوادمي' },
  { key: 'majmaah', en: 'Al-Majmaah', ar: 'المجمعة' },
  { key: 'abha', en: 'Abha', ar: 'أبها' },
  { key: 'khamis', en: 'Khamis Mushait', ar: 'خميس مشيط' },
  { key: 'jazan', en: 'Jazan', ar: 'جازان' },
  { key: 'najran', en: 'Najran', ar: 'نجران' },
  { key: 'baha', en: 'Al-Baha', ar: 'الباحة' },
  { key: 'yanbu', en: 'Yanbu', ar: 'ينبع' },
  { key: 'arar', en: 'Arar', ar: 'عرعر' },
  { key: 'sakaka', en: 'Sakaka', ar: 'سكاكا' },
  { key: 'other', en: 'Other', ar: 'مدينة أخرى' },
];

const PATTERN_KEYS = ['triple', 'quad', 'ends_same', 'mirror', 'sequence', 'pairs'];
const REPORT_REASONS = ['scam', 'sold', 'price', 'spam', 'other'];

// Price ceilings that get their own indexed page ("numbers under 500 riyals").
const UNDER_PRICES = [200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
const PRICE_TYPES = ['negotiable', 'final'];
// Public links of the store (used on the contact page).
const LINKS = {
  store: 'https://souq3rb.com',
  group: 'https://chat.whatsapp.com/F2V5yGPdaR68R80hbO6wvu',
  snap: 'https://snapchat.com/t/FdRdXjrK',
  adminWa: '966599900079',
};

const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));

module.exports = {
  NETWORKS,
  CITIES,
  PATTERN_KEYS,
  REPORT_REASONS,
  UNDER_PRICES,
  PRICE_TYPES,
  LINKS,
  NETWORK_BY_KEY: byKey(NETWORKS),
  CITY_BY_KEY: byKey(CITIES),
};
