'use strict';

const { NETWORKS, CITIES, PATTERN_KEYS, REPORT_REASONS, NETWORK_BY_KEY, CITY_BY_KEY, UNDER_PRICES, PRICE_TYPES, LINKS } = require('./data');
const util = require('./util');
const { esc, plateDigits, formatNumberPlain, intlToLocal, daysSince, formatPrice } = require('./util');
const config = require('./config');

const ASSET_V = config.assetVersion;

// ---- Small helpers ---------------------------------------------------------

const netName = (ctx, key) => (NETWORK_BY_KEY[key] ? NETWORK_BY_KEY[key][ctx.lang] : key);
const cityName = (ctx, key) => (CITY_BY_KEY[key] ? CITY_BY_KEY[key][ctx.lang] : key);

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

function ageText(ctx, createdAt) {
  const d = daysSince(createdAt);
  if (d === 0) return ctx.t('today');
  if (d === 1 && ctx.lang !== 'ar') return ctx.t('yesterday');
  return ctx.t('days_ago', { n: ctx.lang === 'ar' ? String(d).replace(/\d/g, (c) => '٠١٢٣٤٥٦٧٨٩'[c]) : d });
}

function csrfInput(ctx) {
  return `<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`;
}

// Saudi riyal sign (Lucide "saudi-riyal" icon, ISC licence), drawn inline so it shows on every phone.
const SAR_SIGN = (ctx) =>
  `<svg class="sar" viewBox="0 0 24 24" role="img" aria-label="${esc(ctx.t('sar'))}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 19.5-5.5 1.2"/><path d="M14.5 4v11.22a1 1 0 0 0 1.242.97L20 15.2"/><path d="m2.978 19.351 5.549-1.363A2 2 0 0 0 10 16V2"/><path d="M20 10 4 13.5"/></svg>`;

const ICON = {
  heart: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.8 6.3 4.8c2 0 3.5 1.1 4.2 2.4h3c.7-1.3 2.2-2.4 4.2-2.4 3.6 0 5.4 3.6 3.9 7C19.5 16.4 12 21 12 21z" transform="translate(0 0)"/></svg>',
  logout: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  eye: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  home: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  key: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  user: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-6 8-6s7 1.5 8 6"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/></svg>',
  moon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>',
  sun: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  up: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>',
  help: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  share2: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"/></svg>',
  share: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4"/></svg>',
};

const verifiedMark = (ctx) => `<span class="vmark" title="${esc(ctx.t('verified'))}" aria-label="${esc(ctx.t('verified'))}">✓</span>`;

function priceHtml(ctx, price, big = false) {
  const cls = big ? 'price price-lg' : 'price';
  if (price == null) return `<span class="${cls} ask">${esc(ctx.t('price_ask'))}</span>`;
  return `<span class="${cls}"><bdi>${esc(formatPrice(price))}</bdi>${SAR_SIGN(ctx)}</span>`;
}

function statusBadge(ctx, status) {
  return `<span class="badge badge-${esc(status)}">${esc(ctx.t('status_' + status))}</span>`;
}

function field(ctx, o) {
  const { id, name, label, hint, value = '', type = 'text', error, attrs = '' } = o;
  const hintId = hint ? `${id}-hint` : '';
  const errId = error ? `${id}-err` : '';
  const describedBy = [hintId, errId].filter(Boolean).join(' ');
  return `
  <div class="field${error ? ' has-error' : ''}">
    <label for="${id}">${esc(label)}</label>
    ${hint ? `<p class="hint" id="${hintId}">${esc(hint)}</p>` : ''}
    <input id="${id}" name="${name}" type="${type}" value="${esc(value)}" dir="auto"
      ${describedBy ? `aria-describedby="${describedBy}"` : ''} ${error ? 'aria-invalid="true"' : ''} ${attrs}>
    ${error ? `<p class="error-text" id="${errId}">${esc(ctx.t(error.key || error, error.vars))}</p>` : ''}
  </div>`;
}

function selectField(ctx, o) {
  const { id, name, label, options, value = '', error, placeholder } = o;
  const errId = error ? `${id}-err` : '';
  return `
  <div class="field${error ? ' has-error' : ''}">
    <label for="${id}">${esc(label)}</label>
    <select id="${id}" name="${name}" ${error ? `aria-invalid="true" aria-describedby="${errId}"` : ''}>
      ${placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : ''}
      ${options
        .map(
          (opt) =>
            `<option value="${esc(opt.value)}"${String(opt.value) === String(value) ? ' selected' : ''}>${esc(opt.label)}</option>`
        )
        .join('')}
    </select>
    ${error ? `<p class="error-text" id="${errId}">${esc(ctx.t(error.key || error, error.vars))}</p>` : ''}
  </div>`;
}

const networkOptions = (ctx) => NETWORKS.map((n) => ({ value: n.key, label: n[ctx.lang] }));
const cityOptions = (ctx) => CITIES.map((c) => ({ value: c.key, label: c[ctx.lang] }));

// ---- Layout ----------------------------------------------------------------

function jsonLd(list) {
  return list
    .filter(Boolean)
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
}

function layout(ctx, { title, fullTitle: fullOverride, desc, body, hero = '', canonical, noindex, robots, ld = [], promo = false, liveJs = false }) {
  const { t, lang, user } = ctx;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const siteName = t('site_name');
  const fullTitle = fullOverride || (title ? `${title} | ${siteName}` : `${siteName} | ${t('tagline')}`);
  const description = desc || t('meta_desc');
  const flash = ctx.flash
    ? `<div class="notice ${ctx.flash.type === 'error' ? 'error' : 'ok'}" role="status">${esc(t(ctx.flash.key, ctx.flash.vars))}</div>`
    : '';
  const next = encodeURIComponent(ctx.path || '/');
  const robotsTag = noindex ? 'noindex, nofollow' : robots || '';
  // Tag Manager runs only on public pages, never on login, account, admin or error pages.
  const gtm = !!config.gtmId && !noindex;
  if (gtm) ctx.gtmNonce = ctx.nonce;

  const dark = ctx.theme === 'dark';
  const themeLink = `<a class="theme-toggle" href="/theme/${dark ? 'light' : 'dark'}?next=${next}" rel="nofollow" title="${esc(t(dark ? 'theme_light' : 'theme_dark'))}" aria-label="${esc(t(dark ? 'theme_light' : 'theme_dark'))}">${dark ? ICON.sun : ICON.moon}</a>`;
  const alerts = ctx.alerts ? ` <span class="alert-dot" title="${esc(t('alerts_title'))}">${esc(ctx.alerts)}</span>` : '';
  const isStaff = !!user && util.rankOf(user) >= 1;

  const nav = user
    ? `
      <a href="/my">${esc(t('my_ads'))}</a>
      ${isStaff ? `<a href="/admin">${esc(t('admin'))}${alerts}</a>` : ''}
      <form method="post" action="/logout" class="inline">${csrfInput(ctx)}<button type="submit" class="link-btn">${esc(t('logout'))}</button></form>`
    : `
      <a href="/login">${esc(t('login'))}</a>
      <a href="/register">${esc(t('register'))}</a>`;

  return `<!doctype html>
<html lang="${lang}" dir="${dir}"${dark ? ' data-theme="dark"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#2a1c44">
<meta name="google-site-verification" content="MykcqJrPEQKzSv2c53joA0i9o4uopSuBMZASOHI4mpE">
${robotsTag ? `<meta name="robots" content="${robotsTag}">` : '<meta name="robots" content="index, follow, max-image-preview:large">'}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_SA' : 'en_US'}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ctx.base)}/icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.png" type="image/png" sizes="128x128">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css?v=${esc(ASSET_V)}">
${jsonLd(ld)}
${gtm ? `<!-- Google Tag Manager -->
<script nonce="${esc(ctx.nonce)}">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${esc(config.gtmId)}');</script>
<!-- End Google Tag Manager -->` : ''}
</head>
<body id="top"${ctx.plateStyle && ctx.plateStyle !== 'classic' ? ` data-plate="${esc(ctx.plateStyle)}"` : ''}>
${gtm ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(config.gtmId)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : ''}
<a class="skip" href="#main">${esc(t('skip'))}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="${esc(siteName)}"><img class="brand-mark" src="/brand.png" width="44" height="44" alt="">${esc(siteName)}</a>
    <nav class="nav" aria-label="Main">
      ${nav}
      <a href="/lang/${esc(t('lang_code'))}?next=${next}" hreflang="${esc(t('lang_code'))}" lang="${esc(t('lang_code'))}">${esc(t('lang_switch'))}</a>
      ${themeLink}
      <a class="nav-add" href="/post">${esc(t('post_ad'))}</a>
    </nav>
    ${user ? `<a class="who" href="/profile" title="${esc(t('account_title'))}">${ICON.user}<span>${esc(user.name)}</span></a>` : ''}
  </div>
</header>
${hero}
<main id="main" class="wrap">
${flash}
${ctx.ack || noindex ? '' : `<div class="popup" role="dialog" aria-modal="true" aria-labelledby="pop-t"><div class="popup-box"><strong id="pop-t">${esc(t('notice_title'))}</strong><ul><li>${esc(t('notice_1'))}</li><li>${esc(t('notice_2'))}</li><li>${esc(t('notice_3'))}</li></ul><a class="btn btn-gold" href="/ack?next=${encodeURIComponent(ctx.path || '/')}" rel="nofollow">${esc(t('notice_ok'))}</a></div></div>`}
${body}
${promo && !user ? `<aside class="promo"><div><strong>${esc(t('promo_title'))}</strong><span>${esc(t('promo_body'))}</span></div><a class="btn btn-gold" href="/register">${esc(t('promo_cta'))}</a></aside>` : ''}
</main>
<footer class="foot">
  <div class="wrap foot-links">
    <a href="/new">${esc(t('page_new'))}</a>
    <a href="/faq">${esc(t('page_faq'))}</a>
    <a href="/articles">${esc(t('page_articles'))}</a>
    <a href="/about">${esc(t('page_about'))}</a>
    <a href="/contact">${esc(t('page_contact'))}</a>
  </div>
  <div class="wrap foot-bar">
    <p>${esc(t('footer_note'))}</p>
    <p class="sponsor">${esc(t('sponsor_label'))} <a href="${esc(LINKS.store)}" rel="noopener" target="_blank">${esc(t('sponsor_name'))}</a></p>
  </div>
</footer>
<a class="to-top" href="#top" aria-label="${esc(t('to_top'))}" title="${esc(t('to_top'))}">${ICON.up}</a>
<nav class="tabbar${user ? ' has-out' : ''}" aria-label="${esc(t('tabbar'))}">
  <a href="/">${ICON.home}<span>${esc(t('tab_home'))}</span></a>
  <a class="tab-add" href="${user ? '/post' : '/register'}">${ICON.plus}<span>${esc(t('post_free'))}</span></a>
  ${user ? `<a href="/my">${ICON.list}<span>${esc(t('my_ads'))}</span></a>` : `<a href="/login">${ICON.user}<span>${esc(t('login'))}</span></a>`}
  ${isStaff ? `<a href="/admin">${ICON.shield}<span>${esc(t('admin'))}${alerts}</span></a>` : `<a href="/faq">${ICON.help}<span>${esc(t('page_faq'))}</span></a>`}
  ${user ? `<form method="post" action="/logout" class="tab-out">${csrfInput(ctx)}<button type="submit">${ICON.logout}<span>${esc(t('logout'))}</span></button></form>` : ''}
</nav>
${liveJs || !(ctx.ack || noindex) ? `<script src="/live.js?v=${esc(ASSET_V)}" defer></script>` : ''}
</body>
</html>`;
}

// ---- Plate card ------------------------------------------------------------

function cardActions(ctx, l, { deleteNext } = {}) {
  if (!ctx.user) return '';
  const { t } = ctx;
  const isOwner = ctx.user.id === l.user_id;
  const isAdmin = util.rankOf(ctx.user) >= 2 && util.canActOn(ctx.user, { id: l.user_id, is_admin: l.seller_is_admin, role: l.seller_role });
  if (!isOwner && !isAdmin) return '';
  const next = `<input type="hidden" name="next" value="${esc(ctx.path)}">`;
  const delNext = `<input type="hidden" name="next" value="${esc(deleteNext || ctx.path)}">`;
  const parts = [];
  if (isOwner && l.status !== 'sold') {
    parts.push(`<a class="btn btn-ghost btn-small" href="/n/${l.id}/edit">${esc(t('edit'))}</a>`);
    if (l.status === 'active') {
      parts.push(
        `<form method="post" action="/my/${l.id}/sold">${csrfInput(ctx)}${next}<button class="btn btn-ghost btn-small" type="submit">${esc(t('mark_sold'))}</button></form>`
      );
    }
    parts.push(
      `<form method="post" action="/my/${l.id}/delete">${csrfInput(ctx)}${delNext}<button class="btn btn-danger btn-small" type="submit">${esc(t('delete'))}</button></form>`
    );
  }
  if (isAdmin && l.status === 'active') {
    const act = l.pinned ? 'unpin' : 'pin';
    parts.push(
      `<form method="post" action="/admin/l/${l.id}/${act}">${csrfInput(ctx)}${next}<button class="btn btn-gold btn-small" type="submit">${esc(t(act))}</button></form>`
    );
    const fa = l.featured ? 'unfeature' : 'feature';
    parts.push(
      `<form method="post" action="/admin/l/${l.id}/${fa}">${csrfInput(ctx)}${next}<button class="btn btn-gold btn-small" type="submit">${esc(t(fa))}</button></form>`
    );
  }
  return parts.length ? `<div class="plate-actions">${parts.join('')}</div>` : '';
}

// The number plate: network on top, big number, then city, price and age in one row.
// With `links`, the network, city and price are links to the matching results; `numHref` makes the whole card open the ad.
// A sold number is shown with its last two digits hidden, so nobody can copy it. The owner and the staff still see it whole.
const shownNumber = (ctx, l) => {
  const mine = ctx.user && (ctx.user.id === l.user_id || util.rankOf(ctx.user) >= 1);
  return l.status === 'sold' && !mine ? String(l.number).slice(0, -2) + '**' : l.number;
};

function plateFace(ctx, l, tag = 'span', { links = false, numHref = '' } = {}) {
  const net = esc(netName(ctx, l.network));
  const city = esc(cityName(ctx, l.city));
  const label = esc(formatNumberPlain(shownNumber(ctx, l)));
  const price = priceHtml(ctx, l.price);
  const numAttrs = `class="p-num" dir="ltr" aria-label="${label}"`;
  const numEl = numHref
    ? `<a ${numAttrs} href="${esc(numHref)}">${esc(shownNumber(ctx, l))}</a>`
    : `<${tag} ${numAttrs}>${esc(shownNumber(ctx, l))}</${tag}>`;
  return `
    ${links ? `<a class="p-net" href="/network/${esc(l.network)}">${net}</a>` : `<span class="p-net">${net}</span>`}
    ${numEl}
    <span class="p-foot">
      ${links ? `<a class="p-city" href="/city/${esc(l.city)}">${city}</a>` : `<span class="p-city">${city}</span>`}
      ${links && l.price != null ? `<a class="price-link" href="/price/${esc(l.price)}">${price}</a>` : price}
      <span class="p-age">${esc(ageText(ctx, l.created_at))}</span>
    </span>`;
}

// Dark tab under the plate with the advertiser's name.
// Long names get a smaller class so the name always fits inside the tab.
const advSize = (name) => {
  const n = [...String(name)].length;
  return n <= 16 ? '' : n <= 22 ? ' adv-m' : n <= 30 ? ' adv-s' : ' adv-xs';
};
const advTab = (ctx, l) =>
  l.seller
    ? `<a class="adv${advSize(l.seller)}" href="/u/${esc(l.user_id)}" title="${esc(l.seller)}">${esc(l.seller)}${l.seller_verified ? verifiedMark(ctx) : ''}</a>`
    : '';

const plateBadges = (ctx, l) =>
  (l.pinned && l.status === 'active' ? `<span class="pin-badge">${esc(ctx.t('pinned_badge'))}</span>` : '') +
  (l.featured && l.status === 'active' && !l.pinned ? `<span class="pin-badge feat-badge">★ ${esc(ctx.t('featured_badge'))}</span>` : '') +
  (l.status === 'active' && l.price != null && l.price_drop_at && Date.now() - util.parseDbDate(l.price_drop_at).getTime() < 7 * 86400000
    ? `<span class="pin-badge drop-badge">${esc(ctx.t('drop_badge'))}</span>`
    : '') +
  `<span class="views-chip" title="${esc(ctx.t('views'))}">${ICON.eye}<bdi>${esc(l.views || 0)}</bdi></span>` +
  (l.status === 'sold' ? `<span class="sold-stamp">${esc(ctx.t('sold_stamp'))}</span>` : '');

const cardClass = (l, extra = '') =>
  `plate-card${extra}${l.pinned && l.status === 'active' ? ' is-pinned' : ''}${l.featured && l.status === 'active' ? ' is-featured' : ''}${l.status === 'sold' ? ' is-sold' : ''}`;

// The ready WhatsApp message for one number. The number and the price are wrapped so Arabic text does not flip them.
function shareHref(ctx, l) {
  const t = ctx.t;
  const text = t('share_text', {
    number: '\u200e' + formatNumberPlain(l.number) + '\u200e',
    net: netName(ctx, l.network),
    city: cityName(ctx, l.city),
    price: l.price != null ? `\u200e${formatPrice(l.price)}\u200e ${t('sar')}` : t('price_ask'),
    url: `${ctx.base}/n/${l.id}`,
  });
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Stars as text (no inline styles: the page security rules forbid them).
const starsHtml = (avg) => {
  const v = Number(avg) || 0;
  const one = (i) => (v >= i - 0.25 ? '<i class="f">★</i>' : v >= i - 0.75 ? '<i class="h">★</i>' : '<i class="e">★</i>');
  return `<span class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map(one).join('')}</span>`;
};
// Five stars under the advertiser's name: the rating of the person, not of the number.
const sellerStars = (ctx, l) =>
  l.seller_rating_n
    ? `<a class="adv-stars" href="/u/${esc(l.user_id)}#ratings" title="${esc(`${l.seller_rating} / 5 · ${ctx.t('ratings_count', { n: l.seller_rating_n })}`)}" aria-label="${esc(`${l.seller_rating} / 5`)}">${starsHtml(l.seller_rating)}</a>`
    : '';

// The heart: members like an ad with one tap; a visitor is sent to sign in.
function likeButton(ctx, l, { big = false } = {}) {
  const { t } = ctx;
  const liked = !!(ctx.liked && ctx.liked.has(l.id));
  const n = Number(l.likes) || 0;
  const label = ctx.user ? t(liked ? 'like_remove' : 'like_add') : t('like_login');
  const inner = `${ICON.heart}${big ? `<span>${esc(t(liked ? 'like_remove' : 'like_add'))}</span>` : ''}${n ? `<bdi class="like-n">${esc(n)}</bdi>` : ''}`;
  const cls = `${big ? 'btn btn-ghost like-big' : 'like-mini'}${liked ? ' on' : ''}`;
  if (!ctx.user) return `<a class="${cls}" href="/login" rel="nofollow" title="${esc(label)}" aria-label="${esc(label)}">${inner}</a>`;
  const next = ctx.url ? ctx.url.pathname + ctx.url.search : `/n/${l.id}`;
  return `<form method="post" action="/n/${esc(l.id)}/like" class="like-form">${csrfInput(ctx)}<input type="hidden" name="next" value="${esc(next)}"><button class="${cls}" type="submit" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${liked}">${inner}</button></form>`;
}

function plate(ctx, l) {
  const { t } = ctx;
  return `
  <div class="${cardClass(l)}">
    ${plateBadges(ctx, l)}
    <div class="plate">${plateFace(ctx, l, 'span', { links: true, numHref: `/n/${l.id}` })}</div>
    <div class="adv-row">${advTab(ctx, l)}${
      l.status === 'active'
        ? `<span class="mini-acts">${likeButton(ctx, l)}<a class="share-mini" href="${esc(shareHref(ctx, l))}" target="_blank" rel="noopener nofollow" title="${esc(t('share_wa'))}" aria-label="${esc(t('share_wa'))}">${ICON.share2}</a></span>`
        : ''
    }${sellerStars(ctx, l)}</div>
    ${cardActions(ctx, l)}
  </div>`;
}

// ---- Home / search ---------------------------------------------------------

const absNum = (ctx, n) => ctx.base + n;

function landingInfo(ctx, landing) {
  const { t } = ctx;
  if (!landing) {
    return { path: '/', h1: t('home_h1'), fullTitle: t('home_title'), desc: t('meta_desc'), lede: t('home_lede') };
  }
  const key = landing.key;
  if (landing.type === 'price') {
    const p = `${formatPrice(Number(key))} ${t('sar')}`;
    const title = t('price_title', { name: p });
    return { path: `/price/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc: t('price_desc', { name: p }), lede: t('price_desc', { name: p }), name: p };
  }
  if (landing.type === 'under') {
    const p = `${formatPrice(Number(key))} ${t('sar')}`;
    const title = t('under_title', { name: p });
    return { path: `/under/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc: t('under_desc', { name: p }), lede: t('under_desc', { name: p }), name: p };
  }
  if (landing.type === 'new') {
    const title = t('new_title');
    const desc = t('new_desc');
    return { path: '/new', h1: title, fullTitle: `${title} | ${t('site_name')}`, desc, lede: desc, name: title };
  }
  if (landing.type === 'seller') {
    const title = t('seller_title', { name: landing.name });
    const desc = t('seller_desc', { name: landing.name });
    return { path: `/u/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc, lede: desc, name: landing.name };
  }
  if (landing.type === 'netcity') {
    const [nk, ck] = key.split('/');
    const vars = { net: netName(ctx, nk), city: cityName(ctx, ck) };
    const title = t('nc_title', vars);
    const desc = t('nc_desc', vars);
    return { path: `/network/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc, lede: desc, name: title };
  }
  const name = landing.type === 'network' ? netName(ctx, key) : landing.type === 'city' ? cityName(ctx, key) : t('pat_' + key);
  const prefix = landing.type;
  const title = t(`${prefix === 'type' ? 'type' : prefix === 'network' ? 'net' : 'city'}_title`, { name });
  const desc = t(`${prefix === 'type' ? 'type' : prefix === 'network' ? 'net' : 'city'}_desc`, { name });
  return { path: `/${landing.type}/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc, lede: desc, name };
}

function comboLinks(ctx, counts, landing) {
  const { t } = ctx;
  if (!landing || !counts.combo) return '';
  const chip = (href, label, n) => `<a class="chip" href="${href}">${esc(label)} <small>${esc(n)}</small></a>`;
  let head = '';
  let chips = '';
  if (landing.type === 'network') {
    head = t('nc_h_city', { name: netName(ctx, landing.key) });
    chips = CITIES.filter((c) => c.key !== 'other' && counts.combo[`${landing.key}/${c.key}`])
      .map((c) => chip(`/network/${landing.key}/${c.key}`, c[ctx.lang], counts.combo[`${landing.key}/${c.key}`]))
      .join('');
  } else if (landing.type === 'city') {
    head = t('nc_h_net', { name: cityName(ctx, landing.key) });
    chips = NETWORKS.filter((n) => counts.combo[`${n.key}/${landing.key}`])
      .map((n) => chip(`/network/${n.key}/${landing.key}`, n[ctx.lang], counts.combo[`${n.key}/${landing.key}`]))
      .join('');
  }
  return chips ? `<nav class="browse"><h2>${esc(head)}</h2><div class="chips">${chips}</div></nav>` : '';
}

function browseLinks(ctx, counts) {
  const { t } = ctx;
  const TOP = 5;
  // Rectangles: the 5 with the most ads are on show; the rest stay as ordinary links inside "more" (Google still sees every link).
  const tile = (href, label, n) =>
    `<a class="tile${n === 0 ? ' tile-empty' : ''}" href="${href}"><b>${esc(label)}</b>${n ? `<small>${esc(t(n === 1 ? 'count_one' : 'count', { n: formatPrice(n) }))}</small>` : ''}</a>`;
  const group = (title, items) => {
    if (!items.length) return '';
    const live = (x) => x.n === undefined || x.n > 0; // a group without counts (the number types) counts as all live
    const sorted = items.map((x, k) => ({ ...x, k })).sort((a, b) => (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || (b.n || 0) - (a.n || 0) || a.k - b.k);
    const top = sorted.filter(live).slice(0, TOP);
    const rest = sorted.filter((x) => !top.includes(x));
    const html = (list) => list.map((x) => tile(x.href, x.label, x.n)).join('');
    return `<h2>${esc(title)}</h2><div class="tiles">${html(top)}</div>${
      rest.length ? `<details class="more-tiles"><summary>${esc(t('browse_more', { n: rest.length }))}</summary><div class="tiles">${html(rest)}</div></details>` : ''
    }`;
  };
  const nets = NETWORKS.map((n) => ({ href: `/network/${n.key}`, label: n[ctx.lang], n: counts.network[n.key] || 0 }));
  const cities = CITIES.filter((c) => counts.city[c.key]).map((c) => ({ href: `/city/${c.key}`, label: c[ctx.lang], n: counts.city[c.key] }));
  const types = PATTERN_KEYS.map((k) => ({ href: `/type/${k}`, label: t('pat_' + k) }));
  const unders = UNDER_PRICES.filter((n) => counts.under && counts.under[n]).map((n) => ({ href: `/under/${n}`, label: t('under_chip', { n: formatPrice(n) }), n: counts.under[n] }));
  return `
  <nav class="browse" aria-label="${esc(t('browse_net'))}">
    ${group(t('browse_net'), nets)}
    ${group(t('browse_city'), cities)}
    ${group(t('browse_type'), types)}
    ${group(t('browse_price'), unders)}
  </nav>`;
}

function homePage(ctx, { filters, rows, total, page, pages, siteEmpty, landing, counts }) {
  const { t } = ctx;
  const f = filters;
  const info = landingInfo(ctx, landing);
  const base = { q: f.qRaw, city: landing ? '' : f.city, network: landing ? '' : f.network, pattern: landing ? '' : f.pattern, max: landing && landing.type === 'under' ? '' : f.maxRaw };
  const anyFilter = !!(f.qRaw || (f.maxRaw && !(landing && landing.type === 'under')) || (!landing && (f.city || f.network || f.pattern)));

  const form = `
  <form class="search" method="get" action="/" role="search">
    <div class="search-bar">
      <input id="q" name="q" type="search" inputmode="numeric" autocomplete="off" dir="auto"
        aria-label="${esc(t('search_label'))}" value="${esc(f.qRaw)}" placeholder="${esc(t('search_ph'))}">
      <select id="f-net" name="network" aria-label="${esc(t('network'))}">
        <option value="">${esc(t('all_networks'))}</option>
        ${NETWORKS.map((n) => `<option value="${esc(n.key)}"${n.key === f.network && (!landing || landing.type === 'network') ? ' selected' : ''}>${esc(n[ctx.lang])}</option>`).join('')}
      </select>
      <select id="f-pat" name="pattern" aria-label="${esc(t('number_type'))}">
        <option value="">${esc(t('all_types'))}</option>
        ${PATTERN_KEYS.map((k) => `<option value="${esc(k)}"${k === f.pattern && (!landing || landing.type === 'type') ? ' selected' : ''}>${esc(t('pat_' + k))}</option>`).join('')}
      </select>
      <select id="f-city" name="city" aria-label="${esc(t('city'))}">
        <option value="">${esc(t('all_cities'))}</option>
        ${cityOptions(ctx).map((o) => `<option value="${esc(o.value)}"${o.value === f.city && (!landing || landing.type === 'city') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <input id="f-max" name="max" type="text" inputmode="numeric" autocomplete="off" dir="auto"
        aria-label="${esc(t('max_price'))}" value="${esc(f.maxRaw)}" placeholder="${esc(t('max_price'))}">
      <button class="btn btn-gold" type="submit">${esc(t('search'))}</button>
    </div>
  </form>`;

  let results;
  if (rows.length === 0) {
    results = `
    <div class="empty">
      <h2>${esc(siteEmpty ? t('empty_site_title') : t('empty_title'))}</h2>
      <p>${esc(siteEmpty ? t('empty_site_body') : t('empty_body'))}</p>
      <p><a class="btn" href="/post">${esc(t('post_ad'))}</a></p>
    </div>`;
  } else {
    const pageLink = (p) => info.path + qs({ ...base, page: p > 1 ? p : '' });
    const pager =
      pages > 1
        ? `<nav class="pager" aria-label="Pages">
            ${page > 1 ? `<a class="btn btn-ghost" href="${esc(pageLink(page - 1))}" rel="prev">${esc(t('page_prev'))}</a>` : '<span></span>'}
            <span>${esc(t('page_of', { p: page, n: pages }))}</span>
            ${page < pages ? `<a class="btn btn-ghost" href="${esc(pageLink(page + 1))}" rel="next">${esc(t('page_next'))}</a>` : '<span></span>'}
          </nav>`
        : '';
    results = `<div class="grid">${rows.map((l) => plate(ctx, l)).join('')}</div>${pager}`;
  }

  const hero = `
  <div class="hero-band">
    <section class="wrap hero">
      <h1>${esc(info.h1)}</h1>
      <p class="lede">${esc(info.lede.length > 140 ? t('home_lede') : info.lede)}</p>
      ${form}
      <a class="cta-free" href="${ctx.user ? '/post' : '/register'}"><b>${ICON.plus}<span>${esc(t('post_free'))}</span></b><small>${esc(t('post_free_sub'))}</small></a>
      ${landing && landing.type === 'new' ? '' : `<a class="new-link" href="/new">${ICON.clock}<span>${esc(t('page_new'))}</span></a>`}
      ${counts && counts.total ? `<p class="hero-stats">${esc(t('hero_stats', { n: formatPrice(counts.total), when: ageText(ctx, counts.latest) }))}</p>` : ''}
    </section>
  </div>`;

  const sellerBlock = landing && landing.type === 'seller' && landing.rating ? sellerRatings(ctx, landing) : '';
  const body = `
  ${sellerBlock}
  <section class="results" aria-live="polite">
    <div class="results-head">
      <h2>${esc(total === 1 ? t('count_one') : t('count', { n: formatPrice(total) }))}</h2>
      ${anyFilter ? `<a href="${esc(info.path)}">${esc(t('clear'))}</a>` : ''}
    </div>
    ${results}
  </section>
  ${comboLinks(ctx, counts, landing)}
  ${browseLinks(ctx, counts)}
  <section class="about">
    <h2>${esc(t('about_title'))}</h2>
    <p>${esc(t('about_body'))}</p>
    <p class="about-cta"><a class="btn btn-wa" href="https://wa.me/${esc(LINKS.adminWa)}?text=${encodeURIComponent(t('admin_wa_msg'))}" target="_blank" rel="noopener">${esc(t('admin_wa_btn'))}</a></p>
  </section>`;

  const selfUrl = ctx.base + info.path;
  const canonical = page > 1 ? selfUrl + qs({ page }) : selfUrl;
  const crumbs = landing
    ? {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t('site_name'), item: absNum(ctx, '/') },
          { '@type': 'ListItem', position: 2, name: info.h1, item: selfUrl },
        ],
      }
    : null;
  const ld = [
    landing
      ? null
      : {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: t('site_name'),
          url: absNum(ctx, '/'),
          inLanguage: 'ar',
          potentialAction: {
            '@type': 'SearchAction',
            target: `${ctx.base}/?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
    landing
      ? null
      : {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: t('site_name'),
          url: absNum(ctx, '/'),
          logo: absNum(ctx, '/icon-512.png'),
        },
    crumbs && { '@context': 'https://schema.org', ...crumbs },
    rows.length
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: rows.slice(0, 24).map((l, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absNum(ctx, `/n/${l.id}`),
            name: `${formatNumberPlain(l.number)} - ${netName(ctx, l.network)}`,
          })),
        }
      : null,
  ];

  const thin = landing && total === 0;
  return layout(ctx, {
    fullTitle: info.fullTitle,
    desc: info.desc,
    hero,
    body,
    canonical: anyFilter ? selfUrl : canonical,
    robots: anyFilter || thin || (landing && (landing.type === 'price' || landing.type === 'seller')) ? 'noindex, follow' : '',
    ld,
    promo: true,
    liveJs: true,
  });
}

// Ratings of one seller: the average, the accepted comments, and the form for members.
function sellerRatings(ctx, landing) {
  const { t } = ctx;
  const r = landing.rating;
  const id = landing.key;
  const mine = r.mine;
  const stars = [5, 4, 3, 2, 1]
    .map((n) => `<input type="radio" id="st${n}" name="stars" value="${n}"${mine && mine.stars === n ? ' checked' : ''}><label for="st${n}" title="${n}">★</label>`)
    .join('');
  const mineNote = mine ? `<p class="rate-note rate-${esc(mine.status)}">${esc(t('rate_mine_' + mine.status))}</p>` : '';
  const form = !ctx.user
    ? `<p class="rate-login"><a class="btn btn-ghost" href="/login">${esc(t('rate_login'))}</a></p>`
    : r.canRate
      ? `${mineNote}<form method="post" action="/u/${esc(id)}/rate" class="rate-form">${csrfInput(ctx)}
          <div class="star-pick" role="radiogroup" aria-label="${esc(t('rate_stars'))}">${stars}</div>
          <label class="rate-label" for="rate-comment">${esc(t('rate_comment'))}</label>
          <textarea id="rate-comment" name="comment" rows="2" maxlength="200" dir="auto">${esc(mine ? mine.comment : '')}</textarea>
          <button class="btn" type="submit">${esc(t(mine ? 'rate_update' : 'rate_send'))}</button>
        </form>`
      : '';
  const list = r.list.length
    ? `<ul class="rate-list">${r.list
        .map((x) => `<li><div class="rate-top">${starsHtml(x.stars)}<b>${esc(x.rater)}</b><small>${esc(ageText(ctx, x.created_at))}</small></div>${x.comment ? `<p>${esc(x.comment)}</p>` : ''}</li>`)
        .join('')}</ul>`
    : `<p class="rate-none">${esc(t('ratings_none'))}</p>`;
  return `<section class="rate-box" id="ratings">
    <div class="rate-head"><h2>${esc(t('ratings_title'))}</h2>${r.n ? `<div class="rate-sum">${starsHtml(r.avg)}<b>${esc(r.avg)}</b><small>${esc(t('ratings_count', { n: r.n }))}</small></div>` : ''}</div>
    ${form}
    ${list}
  </section>`;
}

// ---- Listing page ----------------------------------------------------------

function listingPage(ctx, l, { canManage, similar = [] }) {
  const { t } = ctx;
  const waText = t('wa_message', { number: shownNumber(ctx, l) });
  const wa = `https://wa.me/${encodeURIComponent(l.contact)}?text=${encodeURIComponent(waText)}`;
  const isLive = l.status === 'active';

  const notices = [];
  if (l.status === 'sold') notices.push(`<div class="notice">${esc(t('sold_notice'))}</div>`);
  if (canManage && l.status !== 'active' && l.status !== 'sold') {
    notices.push(`<div class="notice">${esc(t('owner_view_notice'))} ${statusBadge(ctx, l.status)}</div>`);
  }

  const reasonOptions = REPORT_REASONS.map((r) => ({ value: r, label: t('r_' + r) }));
  const shareUrl = shareHref(ctx, l);

  const body = `
  <article class="listing">
    ${notices.join('')}
    <div class="${cardClass(l, ' plate-big')}">
      ${plateBadges(ctx, l)}
      <div class="plate">${plateFace(ctx, l, 'h1', { links: true })}</div>
      ${advTab(ctx, l)}
      ${cardActions(ctx, l, { deleteNext: '/my' })}
    </div>

    <div class="listing-side">
      ${
        isLive
          ? `<a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener nofollow">${esc(t('whatsapp'))}</a>
             <a class="btn btn-ghost btn-share" href="${esc(shareUrl)}" target="_blank" rel="noopener nofollow">${ICON.share} ${esc(t('share_wa'))}</a>
             ${likeButton(ctx, l, { big: true })}`
          : ''
      }
      <p class="copy-hint">${esc(t('copy_hint'))}</p>
      <p class="copy-num" dir="ltr">${esc(shownNumber(ctx, l))}</p>
      <dl class="facts">
        <div><dt>${esc(t('network'))}</dt><dd><a href="/network/${esc(l.network)}">${esc(netName(ctx, l.network))}</a></dd></div>
        <div><dt>${esc(t('city'))}</dt><dd><a href="/city/${esc(l.city)}">${esc(cityName(ctx, l.city))}</a></dd></div>
        ${l.price != null && l.price_type ? `<div><dt>${esc(t('price_word'))}</dt><dd>${esc(t('pt_' + l.price_type))}</dd></div>` : ''}
        <div><dt>${esc(t('seller'))}</dt><dd><a href="/u/${esc(l.user_id)}">${esc(l.seller)}</a>${l.seller_verified ? ` ${verifiedMark(ctx)} <small>${esc(t('verified'))}</small>` : ''}${l.seller_rating_n ? `<br>${sellerStars(ctx, l)}` : ''}</dd></div>
        <div><dt>${esc(t('ad_ref'))}</dt><dd dir="ltr">#${esc(l.id)}</dd></div>
        <div><dt>${esc(t('posted'))}</dt><dd>${esc(ageText(ctx, l.created_at))}</dd></div>
        <div><dt>${esc(t('views'))}</dt><dd>${esc(l.views)}</dd></div>
      </dl>
      ${l.description ? `<div class="desc"><h2>${esc(t('details'))}</h2><p>${esc(l.description).replace(/\n/g, '<br>')}</p></div>` : ''}
      <div class="desc about-num"><h2>${esc(t('about_num_title'))}</h2><p>${esc(t('about_num_1', { n: '\u0001', net: netName(ctx, l.network), city: cityName(ctx, l.city) })).replace('\u0001', `<bdi dir="ltr">${esc(String(shownNumber(ctx, l)).replace(/\s/g, ''))}</bdi>`)}</p>${(() => {
        const key = PATTERN_KEYS.find((k) => util.patternTags(l.number).includes(` ${k} `));
        const last = String(l.number).slice(-4);
        return `<p>${esc(t('about_ends', { n: '\u0001' })).replace('\u0001', `<bdi dir="ltr">${esc(last)}</bdi>`)}${key ? ' ' + esc(t('about_pat_' + key)) : ''}</p>`;
      })()}<p>${esc(t('about_num_2'))}</p></div>
      ${isLive ? `<ul class="policy-note"><li>${esc(t('policy_1'))}</li><li>${esc(t('policy_2'))}</li><li>${esc(t('policy_3'))}</li></ul>` : ''}
    </div>


    ${
      isLive
        ? `<details class="report">
      <summary>${esc(t('report_title'))}</summary>
      <form method="post" action="/n/${l.id}/report">
        ${csrfInput(ctx)}
        ${selectField(ctx, { id: 'report-reason', name: 'reason', label: t('report_reason'), options: reasonOptions, value: 'scam' })}
        <button class="btn btn-ghost" type="submit">${esc(t('send_report'))}</button>
      </form>
    </details>`
        : ''
    }
    ${similar.length ? `<section class="similar"><h2>${esc(t(isLive ? 'similar_title' : 'similar_sold'))}</h2><div class="grid">${similar.map((x) => plate(ctx, x)).join('')}</div></section>` : ''}
  </article>`;

  const plain = formatNumberPlain(shownNumber(ctx, l));
  const priceText = l.price != null ? `${formatPrice(l.price)} ${t('sar')}` : '';
  // Keep the whole page title within about 60 characters (the city stays in the description and the heading).
  const baseTitle = `${t('listing_title_word', { n: plain })} | ${netName(ctx, l.network)}`;
  const withPrice = priceText ? `${baseTitle} | ${priceText}` : baseTitle;
  const title = `${withPrice} | ${t('site_name')}`.length <= 60 ? withPrice : baseTitle;
  const desc = t('listing_desc', {
    n: plain,
    net: netName(ctx, l.network),
    city: cityName(ctx, l.city),
    price: priceText || t('price_ask'),
    seller: l.seller,
  });
  const url = `${ctx.base}/n/${l.id}`;
  const validUntil = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  // Google needs a price for a product: an ad without one only gets the breadcrumb data (no half-filled product).
  const ld = [
    ...(l.price == null ? [] : [{
      '@context': 'https://schema.org',
      '@type': 'Product',
      sku: `basma-${l.id}`,
      mpn: `basma-${l.id}`,
      name: `${plain} - ${netName(ctx, l.network)}`,
      description: desc,
      category: 'Phone number',
      image: [`${ctx.base}/og.png`],
      brand: { '@type': 'Brand', name: netName(ctx, l.network) },
      url,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'SAR',
        price: String(l.price),
        validFrom: String(l.renewed_at || l.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        priceValidUntil: validUntil,
        itemCondition: 'https://schema.org/NewCondition',
        availability: isLive ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
        seller: { '@type': 'Person', name: l.seller },
        // A phone number is handed over by the seller, not shipped: free, no delivery time, no returns.
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'SAR' },
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'SA' },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
            transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          },
        },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy',
          applicableCountry: 'SA',
          returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        },
      },
    }]),
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('site_name'), item: absNum(ctx, '/') },
        { '@type': 'ListItem', position: 2, name: netName(ctx, l.network), item: absNum(ctx, `/network/${l.network}`) },
        { '@type': 'ListItem', position: 3, name: plain, item: url },
      ],
    },
  ];
  return layout(ctx, {
    fullTitle: `${title} | ${t('site_name')}`,
    desc,
    body,
    noindex: !isLive && l.status !== 'sold',
    canonical: url,
    ld,
    promo: true,
  });
}

// ---- Post form ----

// Under the price: "negotiable / final" choice, and the "yes the price is right" box after a strange price.
function priceExtra(ctx, v, errors) {
  const warn = errors.price && errors.price.key === 'warn_price';
  return `<p class="hint-line high-price">${esc(ctx.t('high_price_note', { n: config.highPrice.toLocaleString('en-US') }))}</p>${selectField(ctx, {
    id: 'price_type',
    name: 'price_type',
    label: ctx.t('f_price_type'),
    options: PRICE_TYPES.map((k) => ({ value: k, label: ctx.t('pt_' + k) })),
    value: v.priceType || '',
    placeholder: ctx.t('pt_none'),
  })}
  ${warn ? `<label class="check"><input type="checkbox" name="price_ok" value="1"> ${esc(ctx.t('price_ok_label'))}</label>` : ''}
  ${!warn && v.priceOk === '1' ? '<input type="hidden" name="price_ok" value="1">' : ''}`;
}

function postPage(ctx, v = {}, errors = {}) {
  const { t } = ctx;
  const hasErrors = Object.keys(errors).length > 0;
  const body = `
  <section class="narrow post-center">
    <h1>${esc(t('post_title'))}</h1>
    <div class="notice warn" role="note">${esc(t('post_legal'))}</div>
    <p class="lede">${esc(t('post_intro'))}</p>
    ${hasErrors ? `<div class="notice error" role="alert">${esc(t('err_fix'))}</div>` : ''}
    <form method="post" action="/post" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'number', name: 'number', label: t('post_number_label'), value: v.number, error: errors.number, attrs: 'inputmode="numeric" autocomplete="off" maxlength="10" placeholder="05xxxxxxxx" required' })}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('f_network'), options: networkOptions(ctx), value: v.network, error: errors.network, placeholder: t('f_choose') })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('f_city'), options: cityOptions(ctx), value: v.city, error: errors.city, placeholder: t('f_choose') })}
      ${field(ctx, { id: 'price', name: 'price', label: t('f_price'), hint: t('f_price_hint'), value: v.price, error: errors.price, attrs: 'inputmode="numeric" autocomplete="off"' })}
      ${priceExtra(ctx, v, errors)}
      ${field(ctx, { id: 'contact', name: 'contact', label: t('f_contact'), hint: t('f_contact_hint'), value: v.contact, error: errors.contact, attrs: 'inputmode="numeric" autocomplete="off" maxlength="10" placeholder="05xxxxxxxx"' })}
      <div class="field${errors.description ? ' has-error' : ''}">
        <label for="description">${esc(t('f_desc'))}</label>
        <p class="hint" id="description-hint">${esc(t('f_desc_hint'))}</p>
        <textarea id="description" name="description" rows="4" maxlength="400" dir="auto" aria-describedby="description-hint">${esc(v.description)}</textarea>
        ${errors.description ? `<p class="error-text">${esc(t(errors.description))}</p>` : ''}
      </div>
      <button class="btn" type="submit">${esc(t('publish'))}</button>
    </form>
  </section>`;
  return layout(ctx, { title: t('post_title'), body, noindex: true });
}

function editPage(ctx, l, v = {}, errors = {}) {
  const { t } = ctx;
  const hasErrors = Object.keys(errors).length > 0;
  const body = `
  <section class="narrow">
    <h1>${esc(t('edit_title'))}</h1>
    <div class="plate-card"><div class="plate">${plateFace(ctx, l)}</div></div>
    <p class="lede">${esc(t('edit_intro'))}</p>
    ${hasErrors ? `<div class="notice error" role="alert">${esc(t('err_fix'))}</div>` : ''}
    <form method="post" action="/n/${l.id}/edit" class="form" novalidate>
      ${csrfInput(ctx)}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('f_network'), options: networkOptions(ctx), value: v.network, error: errors.network, placeholder: t('f_choose') })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('f_city'), options: cityOptions(ctx), value: v.city, error: errors.city, placeholder: t('f_choose') })}
      ${field(ctx, { id: 'price', name: 'price', label: t('f_price'), hint: t('f_price_hint'), value: v.price, error: errors.price, attrs: 'inputmode="numeric" autocomplete="off"' })}
      ${priceExtra(ctx, v, errors)}
      ${field(ctx, { id: 'contact', name: 'contact', label: t('f_contact'), hint: t('f_contact_hint'), value: v.contact, error: errors.contact, attrs: 'inputmode="numeric" autocomplete="off" maxlength="10" placeholder="05xxxxxxxx"' })}
      <div class="field${errors.description ? ' has-error' : ''}">
        <label for="description">${esc(t('f_desc'))}</label>
        <p class="hint" id="description-hint">${esc(t('f_desc_hint'))}</p>
        <textarea id="description" name="description" rows="4" maxlength="400" dir="auto" aria-describedby="description-hint">${esc(v.description)}</textarea>
        ${errors.description ? `<p class="error-text">${esc(t(errors.description))}</p>` : ''}
      </div>
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('save'))}</button>
        <a class="btn btn-ghost" href="/n/${l.id}">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('edit_title'), body, noindex: true });
}

// ---- Auth ------------------------------------------------------------------

function registerPage(ctx, v = {}, errors = {}) {
  const { t } = ctx;
  const hasErrors = Object.keys(errors).length > 0;
  const body = `
  <section class="narrow">
    <h1>${esc(t('reg_title'))}</h1>
    <p class="lede">${esc(t('reg_intro'))}</p>
    ${
      ctx.lastPhone
        ? `<a class="login-card last-card" href="/login">
        <span class="lc-ico">${ICON.user}</span>
        <span class="lc-text"><b>${esc(t('last_phone_note'))} <bdi dir="ltr">${esc(maskPhone(util.toLocal(ctx.lastPhone)))}</bdi></b><small>${esc(t('last_phone_login'))}</small></span>
      </a>`
        : ''
    }
    ${hasErrors ? `<div class="notice error" role="alert">${esc(t('err_fix'))}</div>` : ''}
    <form method="post" action="/register" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'name', name: 'name', label: t('f_name'), value: v.name, error: errors.name, attrs: 'autocomplete="name" required' })}
      ${field(ctx, { id: 'phone', name: 'phone', label: t('f_phone'), hint: t('f_number_hint'), value: v.phone, error: errors.phone, attrs: 'inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="05xxxxxxxx" required' })}
      ${field(ctx, { id: 'password', name: 'password', label: t('f_pass'), hint: t('f_pass_hint'), type: 'password', error: errors.password, attrs: 'autocomplete="new-password" required minlength="8"' })}
      <button class="btn" type="submit">${esc(t('register'))}</button>
    </form>
    <div class="login-cards">
      <a class="login-card" href="/login">
        <span class="lc-ico">${ICON.user}</span>
        <span class="lc-text"><b>${esc(t('have_account'))}</b><small>${esc(t('login_sub'))}</small></span>
      </a>
    </div>
  </section>`;
  return layout(ctx, { title: t('register'), body, noindex: true });
}

// 0599900079 -> 05*****079: enough to recognise, not enough to copy.
const maskPhone = (p) => (String(p).length >= 6 ? p.slice(0, 2) + '*'.repeat(p.length - 5) + p.slice(-3) : p);

function loginPage(ctx, v = {}, errors = {}) {
  const { t } = ctx;
  const remembered = ctx.lastPhone ? util.toLocal(ctx.lastPhone) : '';
  if (v.phone === undefined && remembered) v = { ...v, phone: remembered };
  const body = `
  <section class="narrow">
    <h1>${esc(t('login_title'))}</h1>
    ${
      remembered && v.phone === remembered
        ? `<div class="login-card last-card">
        <span class="lc-ico">${ICON.user}</span>
        <span class="lc-text"><b>${esc(t('last_phone_note'))} <bdi dir="ltr">${esc(remembered)}</bdi></b><small>${esc(t('last_phone_change'))}</small></span>
      </div>`
        : ''
    }
    ${errors.form ? `<div class="notice error" role="alert">${esc(t(errors.form))}</div>` : ''}
    <form method="post" action="/login" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'phone', name: 'phone', label: t('f_phone'), value: v.phone, attrs: 'inputmode="numeric" autocomplete="username" maxlength="10" placeholder="05xxxxxxxx" required' })}
      ${field(ctx, { id: 'password', name: 'password', label: t('f_pass'), type: 'password', attrs: 'autocomplete="current-password" required' })}
      <button class="btn" type="submit">${esc(t('login'))}</button>
    </form>
    <div class="login-cards">
      <a class="login-card" href="/register">
        <span class="lc-ico">${ICON.plus}</span>
        <span class="lc-text"><b>${esc(t('no_account'))}</b><small>${esc(t('register_free'))}</small></span>
      </a>
      ${
        config.adminLocal
          ? `<a class="login-card" href="#forgot">
        <span class="lc-ico">${ICON.key}</span>
        <span class="lc-text"><b>${esc(t('forgot_title'))}</b><small>${esc(t('forgot_sub'))}</small></span>
      </a>`
          : ''
      }
    </div>
    ${
      config.adminLocal
        ? `<div class="pop" id="forgot" role="dialog" aria-modal="true" aria-labelledby="forgot-h">
      <a class="pop-bg" href="#" aria-label="${esc(t('close'))}"></a>
      <div class="pop-card">
        <h2 id="forgot-h">${esc(t('forgot_title'))}</h2>
        <p>${esc(t('forgot_text'))}<br><bdi dir="ltr"><b>${esc(config.adminLocal)}</b></bdi></p>
        <a class="btn btn-wa" href="https://wa.me/${esc(util.toIntl(config.adminLocal.slice(1)))}" target="_blank" rel="noopener">${esc(t('forgot_wa'))}</a>
        <a class="btn btn-ghost" href="#">${esc(t('close'))}</a>
      </div>
    </div>`
        : ''
    }
  </section>`;
  return layout(ctx, { title: t('login'), body, noindex: true });
}

// ---- My ads ----------------------------------------------------------------

function myPage(ctx, rows) {
  const { t } = ctx;
  const DAY = 86400000;
  const renewBtn = (l) => {
    if (l.status !== 'active') return '';
    const left = config.renewDays * DAY - (Date.now() - util.parseDbDate(l.renewed_at || l.created_at).getTime());
    if (left > 0) {
      const d = Math.ceil(left / DAY);
      return `<span class="renew-wait act-renew">${esc(t('renew_wait', { n: d }))}</span>`;
    }
    return `<form class="act-renew" method="post" action="/my/${l.id}/renew">${csrfInput(ctx)}<button class="btn btn-gold btn-small" type="submit">${esc(t('renew'))}</button></form>`;
  };
  const autoInfo = (l) => {
    if (!ctx.user.verified || l.status !== 'active') return '';
    const left = l.auto_until ? util.parseDbDate(l.auto_until).getTime() - Date.now() : 0;
    if (left > 0) return `<span class="auto-on">${esc(t('auto_on', { n: Math.max(1, Math.ceil(left / DAY)) }))}</span>`;
    return `<form method="post" action="/my/${l.id}/auto">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('auto_enable'))}</button></form>`;
  };
  const list = rows.length
    ? `<ul class="my-list">${rows
        .map(
          (l) => `
      <li class="my-item">
        <a class="my-number" href="/n/${l.id}"><span class="digits" dir="ltr">${plateDigits(l.number)}</span></a>
        <div class="my-info">
          ${statusBadge(ctx, l.status)}
          <span class="my-net">${esc(netName(ctx, l.network))} · ${esc(cityName(ctx, l.city))}</span>
          <span class="my-price">${priceHtml(ctx, l.price)}</span>
          <span class="views-inline" title="${esc(t('views'))}">${ICON.eye}<bdi>${esc(l.views || 0)}</bdi></span>
          ${autoInfo(l)}
        </div>
        <div class="my-actions">
          ${
            l.status === 'sold'
              ? `<span class="sold-tag">${esc(t('sold_stamp'))}</span>`
              : `${renewBtn(l)}${
                  l.status === 'active'
                    ? `<form class="act-sold" method="post" action="/my/${l.id}/sold">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('mark_sold'))}</button></form>`
                    : ''
                }
          <form class="act-del" method="post" action="/my/${l.id}/delete">${csrfInput(ctx)}<button class="btn btn-danger btn-small" type="submit">${esc(t('delete'))}</button></form>`
          }
        </div>
      </li>`
        )
        .join('')}</ul>`
    : `<div class="empty"><p>${esc(t('no_ads'))}</p><p><a class="btn" href="/post">${esc(t('post_ad'))}</a></p></div>`;

  const canBulk = ctx.user.verified || util.rankOf(ctx.user) >= 2;
  const body = `<section><h1>${esc(t('my_title'))}${ctx.user.verified ? ` ${verifiedMark(ctx)}` : ''}</h1>
    <p class="hint-line">${esc(t('renew_rule', { n: config.renewDays }))}</p>
    <p class="hint-line">${esc(t('stale_rule'))}</p>
    ${ctx.user.verified ? `<p class="hint-line">${esc(t('auto_rule', { n: config.autoRenewDays }))}</p>` : ''}
    ${canBulk ? `<p><a class="btn btn-ghost btn-small" href="/my/bulk">${esc(t('bulk_link'))}</a></p>` : ''}
    <p><a class="btn btn-ghost btn-small" href="/my/prices">${esc(t('prices_link'))}</a> <a class="btn btn-ghost btn-small" href="/my/sold.csv">${esc(t('export_sold'))}</a></p>
    ${list}<p class="alt"><a href="/profile">${esc(t('profile_title'))}</a> · <a href="/password">${esc(t('change_password'))}</a></p>
    <form method="post" action="/logout" class="logout-form">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('logout'))}</button></form></section>`;
  return layout(ctx, { title: t('my_title'), body, noindex: true });
}

// All prices of the member's ads in one form.
function pricesPage(ctx, rows) {
  const { t } = ctx;
  const list = rows
    .map(
      (l) => `<div class="field"><label for="p_${l.id}"><bdi dir="ltr">${esc(l.number)}</bdi></label>
        <input id="p_${l.id}" name="p_${l.id}" type="text" inputmode="numeric" autocomplete="off" dir="ltr" value="${l.price == null ? '' : esc(l.price)}" placeholder="${esc(t('f_price'))}"></div>`
    )
    .join('');
  const body = `
  <section class="narrow">
    <h1>${esc(t('prices_title'))}</h1>
    <p class="lede">${esc(t('prices_intro'))}</p>
    ${rows.length ? `<form method="post" action="/my/prices" class="form" novalidate>
      ${csrfInput(ctx)}
      ${list}
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('prices_save'))}</button>
        <a class="btn btn-ghost" href="/my">${esc(t('cancel'))}</a>
      </div>
    </form>` : `<div class="empty"><p>${esc(t('no_ads'))}</p></div>`}
  </section>`;
  return layout(ctx, { title: t('prices_title'), body, noindex: true });
}

// Verified advertisers: a few numbers in one go.
function bulkPage(ctx, { max }) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('bulk_title'))}</h1>
    <div class="notice warn" role="note">${esc(t('post_legal'))}</div>
    <p class="lede">${esc(t('bulk_intro', { n: max }))}</p>
    <form method="post" action="/my/bulk" class="form" novalidate>
      ${csrfInput(ctx)}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('import_net'), options: networkOptions(ctx), value: 'stc' })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('import_city'), options: cityOptions(ctx), value: 'riyadh' })}
      <div class="field">
        <label for="lines">${esc(t('import_lines'))}</label>
        <textarea id="lines" name="lines" rows="6" dir="ltr" placeholder="0555123456 5000&#10;0500111222 12000"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('bulk_submit'))}</button>
        <a class="btn btn-ghost" href="/my">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('bulk_title'), body, noindex: true });
}

// "Are you sure?" before anything that cannot be undone. Staff also choose the reason for hide / suspend / ban.
function confirmPage(ctx, { action, fields, what, back, ask }) {
  const { t } = ctx;
  const hidden = fields.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const reasons = ask
    ? `<div class="field"><label for="why">${esc(t('why_label'))}</label>
        <select id="why" name="reason">${['rules', 'fake', 'price', 'sold', 'other'].map((k) => `<option value="${k}">${esc(t('why_' + k))}</option>`).join('')}</select></div>`
    : '';
  const body = `
  <section class="narrow">
    <h1>${esc(t('confirm_title'))}</h1>
    <div class="notice error" role="alert">${esc(t('confirm_' + what))}</div>
    <form method="post" action="${esc(action)}" class="form">
      ${csrfInput(ctx)}${hidden}<input type="hidden" name="confirm" value="1">
      ${reasons}
      <div class="form-actions">
        <button class="btn btn-danger" type="submit">${esc(t('confirm_yes'))}</button>
        <a class="btn btn-ghost" href="${esc(back)}">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('confirm_title'), body, noindex: true });
}

// After a hide / suspend / ban: the message to the member, ready to send on WhatsApp.
function notifyPage(ctx, { user, text, back }) {
  const { t } = ctx;
  const wa = `https://wa.me/${util.toIntl(user.phone)}?text=${encodeURIComponent(text)}`;
  const body = `
  <section class="narrow">
    <h1>${esc(t('notify_title'))}</h1>
    <p>${esc(t('reset_for', { name: user.name }))} · <bdi dir="ltr">0${esc(user.phone)}</bdi></p>
    <blockquote class="msg">${esc(text).replace(/\n/g, '<br>')}</blockquote>
    <p class="form-actions">
      <a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t('notify_send'))}</a>
      <a class="btn btn-ghost" href="${esc(back)}">${esc(t('notify_skip'))}</a>
    </p>
  </section>`;
  return layout(ctx, { title: t('notify_title'), body, noindex: true });
}

function adminResetPage(ctx, user, pass) {
  const { t } = ctx;
  const intl = util.toIntl(user.phone);
  const wa = `https://wa.me/${intl}?text=${encodeURIComponent(t('reset_wa_msg', { pass }))}`;
  const body = `
  <section class="narrow">
    <h1>${esc(t('reset_title'))}</h1>
    <p>${esc(t('reset_for', { name: user.name }))} · <bdi dir="ltr">0${esc(user.phone)}</bdi></p>
    <p class="temp-pass" dir="ltr">${esc(pass)}</p>
    <div class="notice">${esc(t('reset_note'))}</div>
    <p class="form-actions">
      <a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t('reset_send'))}</a>
      <a class="btn btn-ghost" href="/admin?tab=users">${esc(t('back_users'))}</a>
    </p>
  </section>`;
  return layout(ctx, { title: t('reset_title'), body, noindex: true });
}

// One member: everything the staff can do with him, in one place.
function adminUserPage(ctx, u, extra = {}) {
  const { t } = ctx;
  const me = ctx.user;
  const rank = util.rankOf(me);
  const senior = rank >= 2;
  const mine = u.id === me.id;
  const mayAct = !mine && util.canActOn(me, u);
  const btn = (action, label, cls = 'btn-ghost') =>
    `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/u/${u.id}/${action}">${esc(label)}</button>`;
  const roleName = u.is_admin ? t('role_owner') : u.role === 'super' ? t('role_super') : u.role === 'mod' ? t('role_mod') : t('role_user');
  const acts = [];
  if (mayAct) {
    if (u.suspended) {
      if (senior || u.suspended === me.id) acts.push(btn('unsuspend', t('unsuspend')));
    } else acts.push(btn('suspend', t('suspend')));
    if (senior) {
      acts.push(btn(u.banned ? 'unban' : 'ban', t(u.banned ? 'unban' : 'ban')));
      if (!u.is_admin) acts.push(btn(u.verified ? 'unverify' : 'verify', t(u.verified ? 'unverify' : 'verify')));
      acts.push(btn('reset', t('a_reset_pass')));
    }
  }
  const roles = rank >= 3 ? [['user', t('role_user')], ['mod', t('role_mod')], ['super', t('role_super')]] : [['user', t('role_user')], ['mod', t('role_mod')]];
  const block = (title, inner) => `<div class="ud-block"><h2>${esc(title)}</h2>${inner}</div>`;
  const body = `
  <section class="narrow user-detail">
    <p><a href="/admin?tab=users">&larr; ${esc(t('back_users'))}</a></p>
    <h1>${esc(u.name)}${u.verified ? ` ${verifiedMark(ctx)}` : ''}</h1>
    <p class="ud-meta"><bdi dir="ltr">0${esc(u.phone)}</bdi> · ${esc(roleName)} · ${esc(String(u.created_at).slice(0, 10))}
      ${u.banned ? ` ${statusBadge(ctx, 'hidden')}` : ''}${u.suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}</p>
    <p class="form-actions">
      <a class="btn btn-ghost btn-small" href="/u/${u.id}">${esc(t('a_view_ads'))}</a>
      <a class="btn btn-wa btn-small" href="https://wa.me/${esc(util.toIntl(u.phone))}" target="_blank" rel="noopener">${esc(t('a_whatsapp'))}</a>
    </p>
    ${senior && (mine || mayAct) ? block(t('f_name'), `<form method="post" action="/admin/u/${u.id}/name" class="name-edit">${csrfInput(ctx)}<input name="name" value="${esc(u.name)}" maxlength="60" aria-label="${esc(t('f_name'))}" dir="auto"><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`) : ''}
    ${mayAct ? block(t('note_label'), `<form method="post" action="/admin/u/${u.id}/note" class="name-edit note-edit">${csrfInput(ctx)}<input name="note" value="${esc(u.note || '')}" maxlength="300" placeholder="${esc(t('note_ph'))}" aria-label="${esc(t('note_label'))}" dir="auto"><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`) : u.note && !mine ? block(t('note_label'), `<p>${esc(u.note)}</p>`) : ''}
    ${senior && !u.is_admin && mayAct ? block(t('a_ad_limit'), `<form method="post" action="/admin/u/${u.id}/limit" class="name-edit">${csrfInput(ctx)}<input name="limit" type="number" min="0" max="5000" inputmode="numeric" value="${u.ad_limit > 0 ? esc(u.ad_limit) : ''}" placeholder="${esc(t('a_ad_limit_auto'))}" aria-label="${esc(t('a_ad_limit'))}" dir="ltr"><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form><p class="hint-line">${esc(t('a_ad_limit_hint'))}</p>`) : ''}
    ${acts.length ? block(t('a_col_actions'), `<form method="post" action="/admin/u/${u.id}/reset" class="row-actions">${csrfInput(ctx)}<input type="hidden" name="tab" value="users"><div class="actions">${acts.join('')}</div></form>`) : ''}
    ${senior && !u.is_admin && mayAct ? block(t('a_role'), `<form method="post" action="/admin/u/${u.id}/role" class="name-edit">${csrfInput(ctx)}<select name="role" aria-label="${esc(t('a_role'))}">${roles.map(([k, label]) => `<option value="${k}"${(u.role || 'user') === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`) : ''}
  </section>`;
  return layout(ctx, { title: u.name, body, noindex: true });
}

function importPage(ctx, v = {}) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('import_title'))}</h1>
    <p class="lede">${esc(t('import_intro'))}</p>
    <form method="post" action="/admin/import" class="form" novalidate>
      ${csrfInput(ctx)}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('import_net'), options: networkOptions(ctx), value: v.network || 'stc' })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('import_city'), options: cityOptions(ctx), value: v.city || 'riyadh' })}
      <div class="field">
        <label for="lines">${esc(t('import_lines'))}</label>
        <textarea id="lines" name="lines" rows="14" dir="ltr" placeholder="سوا&#10;0555123456 5000&#10;0500111222 12000 الرياض&#10;زين&#10;0590000555 3000 جدة"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('import_submit'))}</button>
        <a class="btn btn-ghost" href="/admin?tab=all">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('import_title'), body, noindex: true });
}

function syncPage(ctx, v = {}) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('sync_title'))}</h1>
    <p class="lede">${esc(t('sync_intro'))}</p>
    <form method="post" action="/admin/sync" class="form" novalidate>
      ${csrfInput(ctx)}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('import_net'), options: networkOptions(ctx), value: v.network || 'stc' })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('import_city'), options: cityOptions(ctx), value: v.city || 'riyadh' })}
      <div class="field">
        <label for="lines">${esc(t('sync_lines'))}</label>
        <textarea id="lines" name="lines" rows="14" dir="ltr" placeholder="0555123456 : 5000&#10;0500111222 : 12000&#10;0590000555 : 3000"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('sync_submit'))}</button>
        <a class="btn btn-ghost" href="/admin?tab=all">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('sync_title'), body, noindex: true });
}

function designPage(ctx) {
  const { t } = ctx;
  const sample = (extra) => ({
    id: 0, number: '0555123456', network: 'stc', city: 'riyadh', price: 15000, status: 'active',
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19), views: 120, seller: t('site_name'), ...extra,
  });
  const card = (l) => `<div class="${cardClass(l)}"><div class="plate">${plateFace(ctx, l, 'span')}</div><span class="adv">${esc(l.seller)}</span></div>`;
  const opts = ['xmin', 'min', 'light', 'classic', 'pro', 'elite']
    .map(
      (k) => `
    <form method="post" action="/admin/design" class="design-opt${ctx.plateStyle === k ? ' is-on' : ''}" data-plate="${k === 'classic' ? '' : k}">
      ${csrfInput(ctx)}
      <h2>${esc(t('design_' + k))}</h2>
      <p>${esc(t('design_' + k + '_d'))}</p>
      <div class="design-prev">${card(sample({}))}${card(sample({ featured: 1, number: '0505000500' }))}</div>
      <button class="btn${ctx.plateStyle === k ? ' btn-ghost' : ''}" type="submit" name="style" value="${k}">${esc(ctx.plateStyle === k ? t('design_current') : t('design_pick'))}</button>
    </form>`
    )
    .join('');
  const body = `
  <section class="narrow">
    <h1>${esc(t('design_title'))}</h1>
    <p class="lede">${esc(t('design_intro'))}</p>
    ${opts}
    <p class="form-actions"><a class="btn btn-ghost" href="/admin?tab=all">${esc(t('cancel'))}</a></p>
  </section>`;
  return layout(ctx, { title: t('design_title'), body, noindex: true });
}

function profilePage(ctx, v = {}, errors = {}, ads = 0) {
  const { t } = ctx;
  const u = ctx.user;
  const rank = util.rankOf(u);
  const roleName = rank >= 3 ? t('role_owner') : rank === 2 ? t('role_super') : rank === 1 ? t('role_mod') : t('role_user');
  const row = (k, val) => `<div class="acc-row"><dt>${esc(k)}</dt><dd>${val}</dd></div>`;
  const body = `
  <section class="narrow">
    <h1>${esc(t('account_title'))}</h1>
    <dl class="acc-card">
      ${row(t('f_name'), esc(u.name))}
      ${row(t('a_col_phone'), `<bdi dir="ltr">0${esc(u.phone)}</bdi>`)}
      ${row(t('acc_type'), `${esc(roleName)}${u.verified ? ` · ${esc(t('verified'))}` : ''}`)}
      ${u.created_at ? row(t('a_col_joined'), esc(String(u.created_at).slice(0, 10))) : ''}
      ${row(t('acc_ads'), esc(ads))}
    </dl>
    <h2>${esc(t('profile_title'))}</h2>
    <form method="post" action="/profile" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'name', name: 'name', label: t('f_name'), value: v.name, error: errors.name, attrs: 'autocomplete="name" required' })}
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('save'))}</button>
        <a class="btn btn-ghost" href="/my">${esc(t('my_ads'))}</a>
        <a class="btn btn-ghost" href="/password">${esc(t('change_password'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('account_title'), body, noindex: true });
}

function passwordPage(ctx, errors = {}) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('pw_title'))}</h1>
    <form method="post" action="/password" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'current', name: 'current', label: t('f_pass_current'), type: 'password', error: errors.current, attrs: 'autocomplete="current-password" required' })}
      ${field(ctx, { id: 'next', name: 'next', label: t('f_pass_new'), type: 'password', error: errors.next, attrs: 'autocomplete="new-password" required' })}
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('save'))}</button>
        <a class="btn btn-ghost" href="/my">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('pw_title'), body, noindex: true });
}

// ---- Admin -----------------------------------------------------------------

function adminPage(ctx, tab, data) {
  const { t } = ctx;
  const me = ctx.user;
  const rank = util.rankOf(me);
  const senior = rank >= 2;
  const allTabs = [
    ['stats', t('a_stats')],
    ['pending', t('a_pending')],
    ['review', t('a_review')],
    ['reported', t('a_reported')],
    ['all', t('a_all')],
    ['sold', t('a_sold_tab')],
    ['ratings', t('a_ratings')],
    ['users', t('a_users')],
    ['blocked', t('a_blocked')],
    ['log', t('a_log')],
  ];
  const lbl = Object.fromEntries(allTabs);
  const tl = (k) => `<a href="/admin?tab=${k}"${tab === k ? ' aria-current="page"' : ''}>${esc(lbl[k])}${k === 'ratings' && ctx.alertsRatings ? ` <span class="alert-dot">${esc(ctx.alertsRatings)}</span>` : ''}</a>`;
  const pl = (href, label) => `<a href="${href}">${esc(label)}</a>`;
  const grp = (title, links) => `<div class="adm-group"><span class="adm-label">${esc(title)}</span><div class="adm-links">${links.join('')}</div></div>`;
  const tabNav = `<nav class="adm-nav" aria-label="Admin">${
    senior
      ? grp(t('a_grp_general'), [tl('stats'), tl('log')]) +
        grp(t('a_grp_ads'), [tl('pending'), tl('review'), tl('reported'), tl('all'), tl('sold'), tl('ratings')]) +
        grp(t('a_grp_members'), [tl('users'), tl('blocked')]) +
        grp(t('a_grp_tools'), [pl('/admin/import', t('a_import')), pl('/admin/sync', t('a_sync')), pl('/admin/design', t('a_design')), pl('/admin/export/numbers.csv', t('a_export_numbers')), pl('/admin/export/users.csv', t('a_export_users')), pl('/admin/export/sold.csv', t('export_sold'))].concat(rank >= 3 ? [pl('/admin/export/backup.json', t('a_backup'))] : []))
      : grp(t('admin'), [tl('pending'), tl('reported'), tl('all'), tl('sold'), tl('ratings'), tl('users')])
  }</nav>`;

  const roleLabel = (u) => (u.is_admin ? t('role_owner') : u.role === 'super' ? t('role_super') : u.role === 'mod' ? t('role_mod') : t('role_user'));
  const roleBadge = (u) => `<span class="badge ${u.is_admin || u.role === 'super' || u.role === 'mod' ? 'badge-pin' : ''}">${esc(roleLabel(u))}</span>`;

  // Buttons share one form per row (formaction), which keeps long lists light.
  const userForm = (u, action, label, cls = 'btn-ghost') =>
    `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/u/${u.id}/${action}">${esc(label)}</button>`;

  // A clean list: one row per member. Tapping the name opens the member's page with all the options.
  const usersTable = (users) =>
    users.length
      ? `<ul class="user-list">${users
          .map(
            (u) => `<li><a class="user-row" href="/admin/u/${u.id}">
          <span class="ur-name"><b>${esc(u.name)}</b>${u.verified ? verifiedMark(ctx) : ''}</span>
          <span class="ur-role">${roleBadge(u)}</span>
          <span class="ur-phone"><bdi dir="ltr">0${esc(u.phone)}</bdi></span>
          <span class="ur-ads">${esc(t('a_col_ads'))}: ${u.ads ?? 0}</span>
          ${u.banned || u.suspended || u.banned_devices ? `<span class="ur-flags">${u.banned ? statusBadge(ctx, 'hidden') : ''}${u.suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}${u.banned_devices ? ` <small>${esc(t('a_device_banned'))}</small>` : ''}${u.suspended_by_name ? ` <small>${esc(t('suspended_by', { name: u.suspended_by_name }))}</small>` : ''}</span>` : ''}
        </a></li>`,
          )
          .join('')}</ul>`
      : `<p>${esc(t('a_nothing'))}</p>`;

  const listingsTable = (listings) => {
    const act = (l, action, label, cls = 'btn-ghost') =>
      `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/l/${l.id}/${action}">${esc(label)}</button>`;
    return listings.length
      ? `<ul class="adm-ads">${listings
          .map((l) => {
            const seller = { id: l.user_id, is_admin: l.seller_is_admin, role: l.seller_role };
            const mayAct = util.canActOn(me, seller);
            const acts = [];
            if (mayAct) {
              if (senior) {
                if (l.status === 'pending') acts.push(act(l, 'approve', t('approve'), 'btn'));
                if (l.status === 'sold') acts.push(act(l, 'resell', t('resell'), 'btn'));
                if (l.status === 'hidden' && rank >= 3) acts.push(act(l, 'restore', t('restore'), 'btn'));
                if (l.status === 'active') acts.push(act(l, l.pinned ? 'unpin' : 'pin', t(l.pinned ? 'unpin' : 'pin'), 'btn-gold'));
                if (l.status === 'active') acts.push(act(l, l.featured ? 'unfeature' : 'feature', t(l.featured ? 'unfeature' : 'feature'), 'btn-gold'));
                if (l.status === 'active') acts.push(act(l, 'hide', t('hide')));
                acts.push(act(l, 'delete', t('delete'), 'btn-danger'));
              } else {
                if (l.status === 'pending') acts.push(act(l, 'approve', t('approve'), 'btn'));
                if (l.status === 'active') acts.push(act(l, 'hide', t('hide')));
              }
            }
            const badges = `${statusBadge(ctx, l.status)}${l.pinned ? ` <span class="badge badge-pin">${esc(t('pinned_badge'))}</span>` : ''}${l.featured ? ` <span class="badge badge-pin">${esc(t('featured_badge'))}</span>` : ''}${l.price != null && (l.price < 100 || l.price > 3000000) ? ` <span class="badge badge-pending">${esc(t('odd_price'))}</span>` : ''}${l.report_count ? ` <span class="badge badge-pending">${esc(t('reports_n', { n: l.report_count }))}</span>` : ''}`;
            return `<li class="adm-ad">
          <div class="adm-ad-top"><a class="adm-num" href="/n/${l.id}" dir="ltr">${esc(formatNumberPlain(l.number))}</a><span class="adm-badges">${badges}</span></div>
          <p class="adm-meta">${esc(netName(ctx, l.network))} · ${esc(cityName(ctx, l.city))} · ${l.price == null ? esc(t('price_ask')) : esc(formatPrice(l.price)) + ' ' + esc(t('sar'))}${l.hidden_by > 0 ? ` · ${esc(t('hidden_by_mod'))}` : ''}${l.hidden_by === -2 ? ` · ${esc(t('held_badge'))}` : ''}</p>
          <p class="adm-meta adm-seller">${esc(l.seller)} · <bdi dir="ltr">0${esc(l.seller_phone)}</bdi>${l.seller_banned ? ` ${statusBadge(ctx, 'hidden')}` : ''}${l.seller_suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}</p>
          ${acts.length ? `<form method="post" action="/admin/l/${l.id}/hide" class="adm-acts">${csrfInput(ctx)}<input type="hidden" name="tab" value="${esc(tab)}">${acts.join('')}</form>` : ''}
        </li>`;
          })
          .join('')}</ul>`
      : `<p>${esc(t('a_nothing'))}</p>`;
  };

  let content = '';
  if (tab === 'stats') {
    const s = data.stats;
    const tile = (n, label) => `<div><strong>${esc(formatPrice(n))}</strong><span>${esc(label)}</span></div>`;
    const lines = (rows, f) => (rows.length ? `<ol class="top-list">${rows.slice(0, 4).map(f).join('')}</ol>` : `<p>${esc(t('a_nothing'))}</p>`);
    const sg = (title, tiles) => `<section class="stat-group"><h2>${esc(title)}</h2><div class="stats n${tiles.length}">${tiles.join('')}</div></section>`;
    content = `${sg(t('a_grp_ads'), [tile(s.active, t('a_total_ads')), tile(s.pending, t('a_pending')), tile(s.reports, t('a_total_reports')), tile(s.sold, t('a_sold'))])}
    ${sg(t('a_grp_members'), [tile(s.users, t('a_total_users')), tile(s.users1, t('a_users_1')), tile(s.users7, t('a_users_7'))])}
    ${sg(t('a_grp_visits'), [tile(s.viewsToday, t('a_views_today')), tile(s.views7, t('a_views_7')), tile(s.viewsAll, t('a_views_all'))])}
    ${sg(t('a_grp_new'), [tile(s.ads1, t('a_ads_1')), tile(s.ads7, t('a_ads_7'))])}
    <div class="stats-cols">
      <section class="rank-card"><h2>${esc(t('a_top_viewed'))}</h2>${lines(s.top, (r) => `<li><a href="/n/${r.id}" dir="ltr">${esc(formatNumberPlain(r.number))}</a> <small>${ICON.eye} ${esc(r.views)}</small></li>`)}</section>
      <section class="rank-card"><h2>${esc(t('a_top_cities'))}</h2>${lines(s.cities, (r) => `<li>${esc(cityName(ctx, r.k))} <small>${esc(r.c)}</small></li>`)}</section>
      <section class="rank-card"><h2>${esc(t('a_by_network'))}</h2>${lines(s.networks, (r) => `<li>${esc(netName(ctx, r.k))} <small>${esc(r.c)}</small></li>`)}</section>
    </div>
    <p class="hint-line">${esc(t('a_visitors_note'))}</p>`;
  } else if (tab === 'ratings') {
    const rb = (x, action, label, cls) => `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/rating/${x.id}/${action}">${esc(label)}</button>`;
    content = `<p class="lede">${esc(t('a_ratings_intro'))}</p>${
      data.ratings.length
        ? `<ul class="adm-ads">${data.ratings
            .map(
              (x) => `<li class="adm-ad">
          <div class="adm-ad-top"><span class="adm-stars">${starsHtml(x.stars)}</span><span class="adm-badges"><span class="badge ${x.status === 'pending' ? 'badge-pending' : x.status === 'approved' ? 'badge-pin' : ''}">${esc(t('rate_st_' + x.status))}</span></span></div>
          <p class="adm-meta">${esc(t('rate_for'))}: <a href="/u/${esc(x.seller_id)}">${esc(x.seller)}</a> · ${esc(t('rate_by'))}: ${esc(x.rater)}</p>
          ${x.comment ? `<p class="adm-comment">${esc(x.comment)}</p>` : ''}
          <form method="post" action="/admin/rating/${x.id}/approve" class="adm-acts">${csrfInput(ctx)}${x.status !== 'approved' ? rb(x, 'approve', t('rate_accept'), 'btn') : ''}${x.status !== 'rejected' ? rb(x, 'reject', t('rate_reject'), 'btn-danger') : ''}${util.rankOf(ctx.user) >= 3 ? rb(x, 'delete', t('rate_delete'), 'btn-danger') : ''}</form>
        </li>`
            )
            .join('')}</ul>`
        : `<p>${esc(t('a_nothing'))}</p>`
    }`;
  } else if (tab === 'users') {
    content = usersTable(data.users);
  } else if (tab === 'blocked') {
    content = `<p class="lede">${esc(t('a_blocked_intro'))}</p>
      <form method="post" action="/admin/block" class="name-edit block-form">${csrfInput(ctx)}<input name="phone" inputmode="numeric" maxlength="10" placeholder="05xxxxxxxx" aria-label="${esc(t('f_phone'))}" dir="ltr" required><button class="btn btn-danger btn-small" type="submit">${esc(t('a_block'))}</button></form>
      ${
        data.blocked.length
          ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('a_col_phone'))}</th><th>${esc(t('a_col_by'))}</th><th>${esc(t('a_col_when'))}</th><th></th></tr></thead><tbody>${data.blocked
              .map(
                (b) => `<tr><td dir="ltr">0${esc(b.phone)}</td><td>${esc(b.by_name || '')}</td><td>${esc(String(b.created_at).slice(0, 10))}</td>
                <td><form method="post" action="/admin/unblock/${esc(b.phone)}">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('a_unblock'))}</button></form></td></tr>`
              )
              .join('')}</tbody></table></div>`
          : `<p>${esc(t('a_nothing'))}</p>`
      }`;
  } else if (tab === 'log') {
    const f = data.f;
    const base = { tab: 'log', q: f.q, actor: f.actor, action: f.action, from: f.from, to: f.to };
    const th = (key, label) => {
      const on = f.sort === key;
      const nextDir = on && f.dir === 'asc' ? 'desc' : 'asc';
      return `<th aria-sort="${on ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><a class="sort-link${on ? ' on' : ''}" href="${esc('/admin' + qs({ ...base, sort: key, dir: nextDir }))}">${esc(label)}<span class="sort-arrow" aria-hidden="true">${on ? (f.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></a></th>`;
    };
    const opts = (list, cur, label) => list.map((x) => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(label(x))}</option>`).join('');
    const filtered = f.q || f.actor || f.action || f.from || f.to;
    content = `<form method="get" action="/admin" class="log-filters" role="search">
        <input type="hidden" name="tab" value="log"><input type="hidden" name="sort" value="${esc(f.sort)}"><input type="hidden" name="dir" value="${esc(f.dir)}">
        <input name="q" type="search" value="${esc(f.q)}" maxlength="60" dir="auto" placeholder="${esc(t('a_search_log'))}" aria-label="${esc(t('a_search'))}">
        <select name="actor" aria-label="${esc(t('a_col_by'))}"><option value="">${esc(t('log_all_by'))}</option>${opts(data.facets.actors, f.actor, (x) => x)}</select>
        <select name="action" aria-label="${esc(t('a_col_action'))}"><option value="">${esc(t('log_all_actions'))}</option>${opts(data.facets.actions, f.action, (x) => t('log_' + x))}</select>
        <label>${esc(t('log_from'))}<input type="date" name="from" value="${esc(f.from)}" dir="ltr"></label>
        <label>${esc(t('log_to'))}<input type="date" name="to" value="${esc(f.to)}" dir="ltr"></label>
        <button class="btn btn-small" type="submit">${esc(t('search'))}</button>
        ${filtered ? `<a class="btn btn-ghost btn-small" href="/admin?tab=log">${esc(t('clear'))}</a>` : ''}
      </form>
      <p class="hint-line">${esc(t('a_found', { n: formatPrice(data.total || 0) }))}${util.rankOf(ctx.user) >= 3 ? ` · <a href="${esc('/admin/export/log.csv' + qs({ q: f.q, actor: f.actor, action: f.action, from: f.from, to: f.to, sort: f.sort, dir: f.dir }))}">${esc(t('log_export'))}</a>` : ''}</p>
      ${
        data.log.length
          ? `<div class="table-wrap"><table class="log-table"><thead><tr>${th('when', t('a_col_when'))}${th('by', t('a_col_by'))}${th('action', t('a_col_action'))}${th('target', t('a_col_target'))}${th('detail', t('a_col_detail'))}</tr></thead><tbody>${data.log
              .map(
                (r) => `<tr><td dir="ltr">${esc(String(r.created_at).slice(0, 16))}</td><td>${esc(r.actor_name)}</td><td>${esc(t('log_' + r.action))}</td><td>${esc(r.target)}</td><td>${esc(/^why_/.test(r.detail) ? t(r.detail) : r.detail)}</td></tr>`
              )
              .join('')}</tbody></table></div>`
          : `<p>${esc(t('a_nothing'))}</p>`
      }`;
  } else if (tab === 'review') {
    content = `<p class="lede">${esc(t('a_review_intro'))}</p>
      <h2>${esc(t('a_review_ads'))}</h2>${listingsTable(data.listings)}
      <h2>${esc(t('a_review_users'))}</h2>${usersTable(data.suspended)}`;
  } else {
    content = listingsTable(data.listings);
  }

  // Search box (number, phone or name) and page links for the long lists.
  const searchable = ['pending', 'reported', 'review', 'all', 'sold', 'users'].includes(tab);
  const q = data.q || '';
  const searchBox = searchable
    ? `<form method="get" action="/admin" class="admin-search" role="search">
        <input type="hidden" name="tab" value="${esc(tab)}">
        <input name="q" type="search" value="${esc(q)}" maxlength="40" dir="auto" placeholder="${esc(t(tab === 'users' ? 'a_search_users' : 'a_search_ph'))}" aria-label="${esc(t('a_search'))}">
        <button class="btn btn-small" type="submit">${esc(t('search'))}</button>
        ${q ? `<a class="btn btn-ghost btn-small" href="/admin?tab=${esc(tab)}">${esc(t('clear'))}</a>` : ''}
      </form>
      <p class="hint-line">${esc(t('a_found', { n: formatPrice(data.total || 0) }))}</p>`
    : '';
  const pg = data.page || 1;
  const lf = tab === 'log' && data.f ? { q: data.f.q, actor: data.f.actor, action: data.f.action, from: data.f.from, to: data.f.to, sort: data.f.sort === 'when' ? '' : data.f.sort, dir: data.f.dir === 'desc' ? '' : data.f.dir } : { q };
  const pageHref = (p2) => `/admin${qs({ tab, ...lf, page: p2 > 1 ? p2 : '' })}`;
  const pager =
    (searchable || tab === 'log') && data.pages > 1
      ? `<nav class="pager" aria-label="Pages">
          ${pg > 1 ? `<a class="btn btn-ghost" href="${esc(pageHref(pg - 1))}">${esc(t('page_prev'))}</a>` : '<span></span>'}
          <span>${esc(t('page_of', { p: pg, n: data.pages }))}</span>
          ${pg < data.pages ? `<a class="btn btn-ghost" href="${esc(pageHref(pg + 1))}">${esc(t('page_next'))}</a>` : '<span></span>'}
        </nav>`
      : '';
  const body = `<section><h1>${esc(t('admin_title'))}</h1>${tabNav}${searchBox}${content}${pager}</section>`;
  return layout(ctx, { title: t('admin_title'), body, noindex: true });
}

// ---- Information pages ----------------------------------------------------

function crumbsLd(ctx, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: ctx.base + path })),
  };
}

function aboutPage(ctx) {
  const { t } = ctx;
  const body = `
  <article class="narrow prose">
    <h1>${esc(t('about_page_title'))}</h1>
    <p class="lede">${esc(t('about_page_lede'))}</p>
    <p>${esc(t('about_page_p1'))}</p>
    <p>${esc(t('about_page_p2'))}</p>
    <p>${esc(t('footer_note'))}</p>
    <p><a class="btn" href="/post">${esc(t('post_ad'))}</a> <a class="btn btn-ghost" href="/contact">${esc(t('page_contact'))}</a></p>
  </article>`;
  return layout(ctx, {
    fullTitle: `${t('about_page_title')} | ${t('site_name')}`,
    desc: t('about_page_lede'),
    body,
    canonical: ctx.base + '/about',
    ld: [crumbsLd(ctx, [[t('site_name'), '/'], [t('about_page_title'), '/about']])],
    promo: true,
  });
}

function contactPage(ctx) {
  const { t } = ctx;
  const owner = config.adminLocal;
  const wa = owner ? `https://wa.me/${util.toIntl(owner.slice(1))}?text=${encodeURIComponent(t('contact_wa_msg'))}` : '';
  const body = `
  <article class="narrow prose">
    <h1>${esc(t('contact_title'))}</h1>
    <p class="lede">${esc(t('contact_lede'))}</p>
    <ul class="contact-list">
      ${wa ? `<li><a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t('contact_wa'))}</a></li>` : ''}
      <li><a class="btn btn-ghost" href="${esc(LINKS.store)}" target="_blank" rel="noopener">${esc(t('contact_store'))}</a></li>
      <li><a class="btn btn-ghost" href="${esc(LINKS.snap)}" target="_blank" rel="noopener">${esc(t('contact_snap'))}</a></li>
    </ul>
    <p>${esc(t('contact_verify'))}</p>
  </article>`;
  return layout(ctx, {
    fullTitle: `${t('contact_title')} | ${t('site_name')}`,
    desc: t('contact_lede'),
    body,
    canonical: ctx.base + '/contact',
    ld: [crumbsLd(ctx, [[t('site_name'), '/'], [t('contact_title'), '/contact']])],
  });
}

function faqPage(ctx, faq) {
  const { t } = ctx;
  const body = `
  <article class="narrow prose">
    <h1>${esc(t('faq_title'))}</h1>
    <p class="lede">${esc(t('faq_lede'))}</p>
    <div class="faq">${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>
    <p><a class="btn btn-ghost" href="/articles">${esc(t('page_articles'))}</a> <a class="btn btn-ghost" href="/contact">${esc(t('page_contact'))}</a></p>
  </article>`;
  return layout(ctx, {
    fullTitle: `${t('faq_title')} | ${t('site_name')}`,
    desc: t('faq_lede'),
    body,
    canonical: ctx.base + '/faq',
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
      crumbsLd(ctx, [[t('site_name'), '/'], [t('faq_title'), '/faq']]),
    ],
    promo: true,
  });
}

function articlesPage(ctx, articles) {
  const { t } = ctx;
  const body = `
  <section class="narrow prose">
    <h1>${esc(t('articles_title'))}</h1>
    <p class="lede">${esc(t('articles_lede'))}</p>
    <ul class="article-list">${articles
      .map((a) => `<li><a href="/articles/${esc(a.slug)}"><strong>${esc(a.title)}</strong><span>${esc(a.desc)}</span></a></li>`)
      .join('')}</ul>
  </section>`;
  return layout(ctx, {
    fullTitle: `${t('articles_title')} | ${t('site_name')}`,
    desc: t('articles_lede'),
    body,
    canonical: ctx.base + '/articles',
    ld: [crumbsLd(ctx, [[t('site_name'), '/'], [t('articles_title'), '/articles']])],
    promo: true,
  });
}

function articlePage(ctx, a, all, latest = []) {
  const { t } = ctx;
  const block = (b) => {
    if (b.h) return `<h2>${esc(b.h)}</h2>`;
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.ul) return `<ul>${b.ul.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (b.codes) {
      return `<div class="table-wrap"><table class="codes"><tbody>${b.codes
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td dir="ltr"><code>${esc(v)}</code></td></tr>`)
        .join('')}</tbody></table></div>`;
    }
    if (b.links) {
      return `<ul class="type-list">${b.links
        .map(([key, name, about]) => `<li><a href="/type/${esc(key)}"><strong>${esc(name)}</strong></a> ${esc(about)}</li>`)
        .join('')}</ul>`;
    }
    return '';
  };
  const others = all.filter((x) => x.slug !== a.slug);
  const body = `
  <article class="narrow prose">
    <p class="crumb"><a href="/articles">${esc(t('articles_title'))}</a></p>
    <h1>${esc(a.title)}</h1>
    <p class="lede">${esc(a.desc)}</p>
    ${a.blocks.map(block).join('')}
    ${latest.length ? `<section class="similar"><h2>${esc(t('latest_numbers'))}</h2><div class="grid">${latest.map((x) => plate(ctx, x)).join('')}</div></section>` : ''}
    <p><a class="btn" href="/">${esc(t('see_numbers'))}</a></p>
    <h2>${esc(t('more_articles'))}</h2>
    <ul class="article-list small">${others
      .map((x) => `<li><a href="/articles/${esc(x.slug)}"><strong>${esc(x.title)}</strong></a></li>`)
      .join('')}</ul>
  </article>`;
  const url = `${ctx.base}/articles/${a.slug}`;
  return layout(ctx, {
    fullTitle: `${a.title} | ${t('site_name')}`,
    desc: a.desc,
    body,
    canonical: url,
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: a.title,
        description: a.desc,
        datePublished: a.date,
        dateModified: a.date,
        inLanguage: 'ar',
        mainEntityOfPage: url,
        publisher: { '@type': 'Organization', name: t('site_name'), logo: { '@type': 'ImageObject', url: ctx.base + '/icon-512.png' } },
      },
      crumbsLd(ctx, [[t('site_name'), '/'], [t('articles_title'), '/articles'], [a.title, `/articles/${a.slug}`]]),
    ],
    promo: true,
  });
}

// ---- Static pages ----------------------------------------------------------

function errorPage(ctx, status) {
  const { t } = ctx;
  const kind = status === 404 ? 'nf' : status === 429 ? 'rate' : 'srv';
  const title = kind === 'nf' ? t('nf_title') : kind === 'rate' ? t('err_rate') : t('srv_title');
  const text = kind === 'nf' ? t('nf_body') : kind === 'rate' ? '' : t('srv_body');
  const body = `
  <section class="narrow">
    <h1>${esc(title)}</h1>
    ${text ? `<p class="lede">${esc(text)}</p>` : ''}
    <p><a class="btn" href="/">${esc(t('go_home'))}</a></p>
  </section>`;
  return layout(ctx, { title, body, noindex: true });
}

module.exports = {
  syncPage,
  designPage,
  homePage,
  listingPage,
  postPage,
  editPage,
  adminResetPage,
  adminUserPage,
  importPage,
  passwordPage,
  profilePage,
  registerPage,
  loginPage,
  myPage,
  adminPage,
  errorPage,
  bulkPage,
  pricesPage,
  confirmPage,
  notifyPage,
  aboutPage,
  contactPage,
  faqPage,
  articlesPage,
  articlePage,
};
