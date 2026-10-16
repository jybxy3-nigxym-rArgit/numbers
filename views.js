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
  eye: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  home: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  user: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-6 8-6s7 1.5 8 6"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/></svg>',
  moon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>',
  sun: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  up: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>',
  help: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
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

function layout(ctx, { title, fullTitle: fullOverride, desc, body, hero = '', canonical, noindex, robots, ld = [], promo = false }) {
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
<meta property="og:image" content="${esc(ctx.base)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
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
  </div>
</footer>
<a class="to-top" href="#top" aria-label="${esc(t('to_top'))}" title="${esc(t('to_top'))}">${ICON.up}</a>
<nav class="tabbar" aria-label="${esc(t('tabbar'))}">
  <a href="/">${ICON.home}<span>${esc(t('tab_home'))}</span></a>
  <a class="tab-add" href="/post">${ICON.plus}<span>${esc(t('post_ad'))}</span></a>
  ${user ? `<a href="/my">${ICON.list}<span>${esc(t('my_ads'))}</span></a>` : `<a href="/login">${ICON.user}<span>${esc(t('login'))}</span></a>`}
  ${isStaff ? `<a href="/admin">${ICON.shield}<span>${esc(t('admin'))}${alerts}</span></a>` : `<a href="/faq">${ICON.help}<span>${esc(t('page_faq'))}</span></a>`}
</nav>
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
  `<span class="views-chip" title="${esc(ctx.t('views'))}">${ICON.eye}<bdi>${esc(l.views || 0)}</bdi></span>` +
  (l.status === 'sold' ? `<span class="sold-stamp">${esc(ctx.t('sold_stamp'))}</span>` : '');

const cardClass = (l, extra = '') =>
  `plate-card${extra}${l.pinned && l.status === 'active' ? ' is-pinned' : ''}${l.featured && l.status === 'active' ? ' is-featured' : ''}${l.status === 'sold' ? ' is-sold' : ''}`;

function plate(ctx, l) {
  return `
  <div class="${cardClass(l)}">
    ${plateBadges(ctx, l)}
    <div class="plate">${plateFace(ctx, l, 'span', { links: true, numHref: `/n/${l.id}` })}</div>
    ${advTab(ctx, l)}
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
  const chip = (href, label, n) =>
    `<a class="chip" href="${href}">${esc(label)}${n ? ` <small>${esc(n)}</small>` : ''}</a>`;
  const nets = NETWORKS.map((n) => chip(`/network/${n.key}`, n[ctx.lang], counts.network[n.key])).join('');
  const cities = CITIES.filter((c) => counts.city[c.key])
    .map((c) => chip(`/city/${c.key}`, c[ctx.lang], counts.city[c.key]))
    .join('');
  const types = PATTERN_KEYS.map((k) => chip(`/type/${k}`, t('pat_' + k))).join('');
  const unders = UNDER_PRICES.filter((n) => counts.under && counts.under[n])
    .map((n) => chip(`/under/${n}`, t('under_chip', { n: formatPrice(n) }), counts.under[n]))
    .join('');
  return `
  <nav class="browse" aria-label="${esc(t('browse_net'))}">
    <h2>${esc(t('browse_net'))}</h2><div class="chips">${nets}</div>
    ${cities ? `<h2>${esc(t('browse_city'))}</h2><div class="chips">${cities}</div>` : ''}
    <h2>${esc(t('browse_type'))}</h2><div class="chips">${types}</div>
    ${unders ? `<h2>${esc(t('browse_price'))}</h2><div class="chips">${unders}</div>` : ''}
  </nav>`;
}

function homePage(ctx, { filters, rows, total, page, pages, siteEmpty, landing, counts }) {
  const { t } = ctx;
  const f = filters;
  const info = landingInfo(ctx, landing);
  const base = { q: f.qRaw, city: landing ? '' : f.city, max: landing && landing.type === 'under' ? '' : f.maxRaw };
  const anyFilter = !!(f.qRaw || (f.maxRaw && !(landing && landing.type === 'under')) || (!landing && f.city));

  const form = `
  <form class="search" method="get" action="/" role="search">
    <div class="search-bar">
      <input id="q" name="q" type="search" inputmode="numeric" autocomplete="off" dir="auto"
        aria-label="${esc(t('search_label'))}" value="${esc(f.qRaw)}" placeholder="${esc(t('search_ph'))}">
      <select id="f-city" name="city" aria-label="${esc(t('city'))}">
        <option value="">${esc(t('all_cities'))}</option>
        ${cityOptions(ctx).map((o) => `<option value="${esc(o.value)}"${o.value === f.city && !landing ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
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
      ${landing && landing.type === 'new' ? '' : `<a class="new-link" href="/new">${ICON.clock}<span>${esc(t('page_new'))}</span></a>`}
    </section>
  </div>`;

  const body = `
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
  });
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
  const url0 = `${ctx.base}/n/${l.id}`;
  const shareText = t('share_text', {
    number: shownNumber(ctx, l),
    net: netName(ctx, l.network),
    city: cityName(ctx, l.city),
    price: l.price != null ? `${formatPrice(l.price)} ${t('sar')}` : t('price_ask'),
    url: url0,
  });
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

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
             <a class="btn btn-ghost btn-share" href="${esc(shareUrl)}" target="_blank" rel="noopener nofollow">${ICON.share} ${esc(t('share_wa'))}</a>`
          : ''
      }
      <p class="copy-hint">${esc(t('copy_hint'))}</p>
      <p class="copy-num" dir="ltr">${esc(shownNumber(ctx, l))}</p>
      <dl class="facts">
        <div><dt>${esc(t('network'))}</dt><dd><a href="/network/${esc(l.network)}">${esc(netName(ctx, l.network))}</a></dd></div>
        <div><dt>${esc(t('city'))}</dt><dd><a href="/city/${esc(l.city)}">${esc(cityName(ctx, l.city))}</a></dd></div>
        ${l.price != null && l.price_type ? `<div><dt>${esc(t('price_word'))}</dt><dd>${esc(t('pt_' + l.price_type))}</dd></div>` : ''}
        <div><dt>${esc(t('seller'))}</dt><dd><a href="/u/${esc(l.user_id)}">${esc(l.seller)}</a>${l.seller_verified ? ` ${verifiedMark(ctx)} <small>${esc(t('verified'))}</small>` : ''}</dd></div>
        <div><dt>${esc(t('posted'))}</dt><dd>${esc(ageText(ctx, l.created_at))}</dd></div>
        <div><dt>${esc(t('views'))}</dt><dd>${esc(l.views)}</dd></div>
      </dl>
      ${l.description ? `<div class="desc"><h2>${esc(t('details'))}</h2><p>${esc(l.description).replace(/\n/g, '<br>')}</p></div>` : ''}
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
  const title = `${t('listing_title_word', { n: plain })} | ${netName(ctx, l.network)} | ${cityName(ctx, l.city)}${priceText ? ' | ' + priceText : ''}`;
  const desc = t('listing_desc', {
    n: plain,
    net: netName(ctx, l.network),
    city: cityName(ctx, l.city),
    price: priceText || t('price_ask'),
    seller: l.seller,
  });
  const url = `${ctx.base}/n/${l.id}`;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${plain} - ${netName(ctx, l.network)}`,
      description: desc,
      category: 'Phone number',
      brand: { '@type': 'Brand', name: netName(ctx, l.network) },
      url,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'SAR',
        ...(l.price != null ? { price: String(l.price) } : {}),
        availability: isLive ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
        seller: { '@type': 'Person', name: l.seller },
      },
    },
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
  return `${selectField(ctx, {
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
  <section class="narrow">
    <h1>${esc(t('post_title'))}</h1>
    <p class="lede">${esc(t('post_intro'))}</p>
    ${hasErrors ? `<div class="notice error" role="alert">${esc(t('err_fix'))}</div>` : ''}
    <form method="post" action="/post" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'number', name: 'number', label: t('f_number'), hint: t('f_number_hint'), value: v.number, error: errors.number, attrs: 'inputmode="numeric" autocomplete="off" maxlength="10" placeholder="05xxxxxxxx" required' })}
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
        ? `<div class="notice">${esc(t('last_phone_note'))} <bdi dir="ltr">${esc(util.toLocal(ctx.lastPhone))}</bdi>. <a href="/login">${esc(t('last_phone_login'))}</a></div>`
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
    <p class="alt">${esc(t('have_account'))} <a href="/login">${esc(t('login'))}</a></p>
  </section>`;
  return layout(ctx, { title: t('register'), body, noindex: true });
}

function loginPage(ctx, v = {}, errors = {}) {
  const { t } = ctx;
  const remembered = ctx.lastPhone ? util.toLocal(ctx.lastPhone) : '';
  if (v.phone === undefined && remembered) v = { ...v, phone: remembered };
  const body = `
  <section class="narrow">
    <h1>${esc(t('login_title'))}</h1>
    ${
      remembered && v.phone === remembered
        ? `<div class="notice">${esc(t('last_phone_note'))} <bdi dir="ltr">${esc(remembered)}</bdi>. ${esc(t('last_phone_change'))}</div>`
        : ''
    }
    ${errors.form ? `<div class="notice error" role="alert">${esc(t(errors.form))}</div>` : ''}
    <form method="post" action="/login" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'phone', name: 'phone', label: t('f_phone'), value: v.phone, attrs: 'inputmode="numeric" autocomplete="username" maxlength="10" placeholder="05xxxxxxxx" required' })}
      ${field(ctx, { id: 'password', name: 'password', label: t('f_pass'), type: 'password', attrs: 'autocomplete="current-password" required' })}
      <button class="btn" type="submit">${esc(t('login'))}</button>
    </form>
    <p class="alt">${esc(t('no_account'))} <a href="/register">${esc(t('register'))}</a></p>
    ${
      config.adminLocal
        ? `<p class="forgot">${esc(t('forgot_pass'))} <bdi dir="ltr">${esc(config.adminLocal)}</bdi>
      <a href="https://wa.me/${esc(util.toIntl(config.adminLocal.slice(1)))}" target="_blank" rel="noopener">${esc(t('forgot_wa'))}</a></p>`
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
      return `<span class="renew-wait">${esc(t('renew_wait', { n: d }))}</span>`;
    }
    return `<form method="post" action="/my/${l.id}/renew">${csrfInput(ctx)}<button class="btn btn-gold btn-small" type="submit">${esc(t('renew'))}</button></form>`;
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
          <span>${esc(netName(ctx, l.network))} · ${esc(cityName(ctx, l.city))}</span>
          ${priceHtml(ctx, l.price)}
          <span class="views-inline" title="${esc(t('views'))}">${ICON.eye}<bdi>${esc(l.views || 0)}</bdi></span>
          ${autoInfo(l)}
        </div>
        <div class="my-actions">
          ${
            l.status === 'sold'
              ? `<span class="sold-tag">${esc(t('sold_stamp'))}</span>`
              : `${renewBtn(l)}${
                  l.status === 'active'
                    ? `<form method="post" action="/my/${l.id}/sold">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('mark_sold'))}</button></form>`
                    : ''
                }
          <form method="post" action="/my/${l.id}/delete">${csrfInput(ctx)}<button class="btn btn-danger btn-small" type="submit">${esc(t('delete'))}</button></form>`
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
    ${list}<p class="alt"><a href="/profile">${esc(t('profile_title'))}</a> · <a href="/password">${esc(t('change_password'))}</a></p>
    <form method="post" action="/logout" class="logout-form">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('logout'))}</button></form></section>`;
  return layout(ctx, { title: t('my_title'), body, noindex: true });
}

// Verified advertisers: a few numbers in one go.
function bulkPage(ctx, { max }) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('bulk_title'))}</h1>
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

function syncPage(ctx) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('sync_title'))}</h1>
    <p class="lede">${esc(t('sync_intro'))}</p>
    <form method="post" action="/admin/sync" class="form" novalidate>
      ${csrfInput(ctx)}
      <div class="field">
        <label for="lines">${esc(t('import_lines'))}</label>
        <textarea id="lines" name="lines" rows="14" dir="ltr" placeholder="0555123456 5000 stc riyadh"></textarea>
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

function profilePage(ctx, v = {}, errors = {}) {
  const { t } = ctx;
  const body = `
  <section class="narrow">
    <h1>${esc(t('profile_title'))}</h1>
    <form method="post" action="/profile" class="form" novalidate>
      ${csrfInput(ctx)}
      ${field(ctx, { id: 'name', name: 'name', label: t('f_name'), value: v.name, error: errors.name, attrs: 'autocomplete="name" required' })}
      <div class="form-actions">
        <button class="btn" type="submit">${esc(t('save'))}</button>
        <a class="btn btn-ghost" href="/my">${esc(t('cancel'))}</a>
      </div>
    </form>
  </section>`;
  return layout(ctx, { title: t('profile_title'), body, noindex: true });
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
    ['users', t('a_users')],
    ['blocked', t('a_blocked')],
    ['log', t('a_log')],
  ];
  const tabs = senior ? allTabs : allTabs.filter(([k]) => ['reported', 'all', 'users'].includes(k));
  const tabNav = `<nav class="tabs" aria-label="Admin">${tabs
    .map(([k, label]) => `<a href="/admin?tab=${k}"${tab === k ? ' aria-current="page"' : ''}>${esc(label)}</a>`)
    .join('')}${senior ? `<a href="/admin/import">${esc(t('a_import'))}</a><a href="/admin/sync">${esc(t('a_sync'))}</a><a href="/admin/design">${esc(t('a_design'))}</a><a href="/admin/export/numbers.csv">${esc(t('a_export_numbers'))}</a><a href="/admin/export/users.csv">${esc(t('a_export_users'))}</a>` : ''}</nav>`;

  const roleBadge = (u) =>
    u.is_admin
      ? ` <span class="badge badge-pin">${esc(t('role_owner'))}</span>`
      : u.role === 'super'
        ? ` <span class="badge badge-pin">${esc(t('role_super'))}</span>`
        : u.role === 'mod'
          ? ` <span class="badge badge-pin">${esc(t('role_mod'))}</span>`
          : '';

  // Buttons share one form per row (formaction), which keeps long lists light.
  const userForm = (u, action, label, cls = 'btn-ghost') =>
    `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/u/${u.id}/${action}">${esc(label)}</button>`;

  const usersTable = (users, tabName) =>
    users.length
      ? `<div class="table-wrap"><table>
        <thead><tr><th>${esc(t('a_col_name'))}</th><th>${esc(t('a_col_phone'))}</th><th>${esc(t('a_col_ads'))}</th><th>${esc(t('a_col_joined'))}</th><th>${esc(t('a_col_actions'))}</th></tr></thead>
        <tbody>${users
          .map((u) => {
            const mine = u.id === me.id;
            const mayAct = !mine && util.canActOn(me, u);
            const nameCell =
              senior && (mine || mayAct)
                ? `<form method="post" action="/admin/u/${u.id}/name" class="name-edit">${csrfInput(ctx)}<input name="name" value="${esc(u.name)}" maxlength="60" aria-label="${esc(t('f_name'))}" dir="auto"><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`
                : esc(u.name);
            const acts = [];
            let roleForm = '';
            if (mayAct) {
              if (u.suspended) {
                if (senior || u.suspended === me.id) acts.push(userForm(u, 'unsuspend', t('unsuspend'), 'btn-ghost', tabName));
              } else acts.push(userForm(u, 'suspend', t('suspend'), 'btn-ghost', tabName));
              if (senior) {
                acts.push(userForm(u, u.banned ? 'unban' : 'ban', t(u.banned ? 'unban' : 'ban'), 'btn-ghost', tabName));
                acts.push(userForm(u, 'reset', t('a_reset_pass')));
              }
            }
            if (senior && !u.is_admin && mayAct && !mine) {
              acts.push(userForm(u, u.verified ? 'unverify' : 'verify', t(u.verified ? 'unverify' : 'verify'), 'btn-ghost', tabName));
            }
            if (senior && !u.is_admin && mayAct && !mine) {
              const roles = rank >= 3 ? [['user', t('role_user')], ['mod', t('role_mod')], ['super', t('role_super')]] : [['user', t('role_user')], ['mod', t('role_mod')]];
              roleForm =
                `<form method="post" action="/admin/u/${u.id}/role" class="name-edit">${csrfInput(ctx)}<select name="role" aria-label="${esc(t('a_role'))}">
                  ${roles.map(([k, label]) => `<option value="${k}"${(u.role || 'user') === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}
                </select><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`;
            }
            return `<tr>
          <td>${nameCell}${u.verified ? ` ${verifiedMark(ctx)}` : ''}${roleBadge(u)}${u.banned ? ` ${statusBadge(ctx, 'hidden')}` : ''}${u.suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}${u.banned_devices ? ` <small>${esc(t('a_device_banned'))}</small>` : ''}${u.suspended_by_name ? `<br><small>${esc(t('suspended_by', { name: u.suspended_by_name }))}</small>` : ''}${
            mayAct && !mine
              ? `<form method="post" action="/admin/u/${u.id}/note" class="name-edit note-edit">${csrfInput(ctx)}<input name="note" value="${esc(u.note || '')}" maxlength="300" placeholder="${esc(t('note_ph'))}" aria-label="${esc(t('note_label'))}" dir="auto"><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`
              : u.note && !mine
                ? `<br><small>${esc(u.note)}</small>`
                : ''
          }</td>
          <td dir="ltr">0${esc(u.phone)}</td>
          <td>${u.ads ?? ''}</td>
          <td>${esc(String(u.created_at).slice(0, 10))}</td>
          <td><div class="actions"><form method="post" action="/admin/u/${u.id}/reset" class="row-actions">${csrfInput(ctx)}<input type="hidden" name="tab" value="${esc(tabName)}">${acts.join('')}</form>${roleForm}</div></td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<p>${esc(t('a_nothing'))}</p>`;

  const listingsTable = (listings) => {
    const act = (l, action, label, cls = 'btn-ghost') =>
      `<button class="btn ${cls} btn-small" type="submit" formaction="/admin/l/${l.id}/${action}">${esc(label)}</button>`;
    return listings.length
      ? `<div class="table-wrap"><table>
        <thead><tr><th>${esc(t('a_col_number'))}</th><th>${esc(t('a_col_seller'))}</th><th>${esc(t('a_col_status'))}</th><th>${esc(t('a_col_actions'))}</th></tr></thead>
        <tbody>${listings
          .map((l) => {
            const seller = { id: l.user_id, is_admin: l.seller_is_admin, role: l.seller_role };
            const mayAct = util.canActOn(me, seller);
            const acts = [];
            if (mayAct) {
              if (senior) {
                if (l.status === 'pending') acts.push(act(l, 'approve', t('approve'), 'btn'));
                if (l.status === 'hidden') acts.push(act(l, 'restore', t('restore'), 'btn'));
                if (l.status === 'active') acts.push(act(l, l.pinned ? 'unpin' : 'pin', t(l.pinned ? 'unpin' : 'pin'), 'btn-gold'));
                if (l.status === 'active') acts.push(act(l, l.featured ? 'unfeature' : 'feature', t(l.featured ? 'unfeature' : 'feature'), 'btn-gold'));
                if (l.status === 'active') acts.push(act(l, 'hide', t('hide')));
                acts.push(act(l, 'delete', t('delete'), 'btn-danger'));
              } else {
                if (l.status === 'active') acts.push(act(l, 'hide', t('hide')));
                if (l.status === 'hidden' && l.hidden_by === me.id) acts.push(act(l, 'restore', t('restore'), 'btn'));
              }
            }
            return `<tr>
          <td><a href="/n/${l.id}" dir="ltr">${esc(formatNumberPlain(l.number))}</a><br><small>${esc(netName(ctx, l.network))} · ${esc(cityName(ctx, l.city))} · ${l.price == null ? esc(t('price_ask')) : esc(formatPrice(l.price)) + ' ' + esc(t('sar'))}</small></td>
          <td>${esc(l.seller)}<br><small dir="ltr">0${esc(l.seller_phone)}</small>${l.seller_banned ? ` ${statusBadge(ctx, 'hidden')}` : ''}${l.seller_suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}</td>
          <td>${statusBadge(ctx, l.status)}${l.pinned ? ` <span class="badge badge-pin">${esc(t('pinned_badge'))}</span>` : ''}${l.featured ? ` <span class="badge badge-pin">${esc(t('featured_badge'))}</span>` : ''}${l.price != null && (l.price < 100 || l.price > 3000000) ? ` <span class="badge badge-pending">${esc(t('odd_price'))}</span>` : ''}${l.hidden_by ? `<br><small>${esc(t('hidden_by_mod'))}</small>` : ''}${l.report_count ? `<br><small>${esc(t('reports_n', { n: l.report_count }))}</small>` : ''}</td>
          <td class="actions">${acts.length ? `<form method="post" action="/admin/l/${l.id}/hide" class="row-actions">${csrfInput(ctx)}<input type="hidden" name="tab" value="${esc(tab)}">${acts.join('')}</form>` : ''}</td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<p>${esc(t('a_nothing'))}</p>`;
  };

  let content = '';
  if (tab === 'stats') {
    const s = data.stats;
    const tile = (n, label) => `<div><strong>${esc(formatPrice(n))}</strong><span>${esc(label)}</span></div>`;
    const lines = (rows, f) => (rows.length ? `<ol class="top-list">${rows.map(f).join('')}</ol>` : `<p>${esc(t('a_nothing'))}</p>`);
    content = `<div class="stats">
      ${tile(s.active, t('a_total_ads'))}
      ${tile(s.pending, t('a_pending'))}
      ${tile(s.reports, t('a_total_reports'))}
      ${tile(s.users, t('a_total_users'))}
      ${tile(s.sold, t('a_sold'))}
      ${tile(s.viewsToday, t('a_views_today'))}
      ${tile(s.views7, t('a_views_7'))}
      ${tile(s.viewsAll, t('a_views_all'))}
      ${tile(s.users1, t('a_users_1'))}
      ${tile(s.users7, t('a_users_7'))}
      ${tile(s.ads1, t('a_ads_1'))}
      ${tile(s.ads7, t('a_ads_7'))}
    </div>
    <div class="stats-cols">
      <section><h2>${esc(t('a_top_viewed'))}</h2>${lines(s.top, (r) => `<li><a href="/n/${r.id}" dir="ltr">${esc(formatNumberPlain(r.number))}</a> <small>${ICON.eye} ${esc(r.views)}</small></li>`)}</section>
      <section><h2>${esc(t('a_top_cities'))}</h2>${lines(s.cities, (r) => `<li>${esc(cityName(ctx, r.k))} <small>${esc(r.c)}</small></li>`)}</section>
      <section><h2>${esc(t('a_by_network'))}</h2>${lines(s.networks, (r) => `<li>${esc(netName(ctx, r.k))} <small>${esc(r.c)}</small></li>`)}</section>
    </div>
    <p class="hint-line">${esc(t('a_visitors_note'))}</p>`;
  } else if (tab === 'users') {
    content = usersTable(data.users, 'users');
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
    content = data.log.length
      ? `<div class="table-wrap"><table><thead><tr><th>${esc(t('a_col_when'))}</th><th>${esc(t('a_col_by'))}</th><th>${esc(t('a_col_action'))}</th><th>${esc(t('a_col_target'))}</th></tr></thead><tbody>${data.log
          .map(
            (r) => `<tr><td dir="ltr">${esc(String(r.created_at).slice(0, 16))}</td><td>${esc(r.actor_name)}</td><td>${esc(t('log_' + r.action))}</td><td>${esc(r.target)}${r.detail ? `<br><small>${esc(/^why_/.test(r.detail) ? t(r.detail) : r.detail)}</small>` : ''}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : `<p>${esc(t('a_nothing'))}</p>`;
  } else if (tab === 'review') {
    content = `<p class="lede">${esc(t('a_review_intro'))}</p>
      <h2>${esc(t('a_review_ads'))}</h2>${listingsTable(data.listings)}
      <h2>${esc(t('a_review_users'))}</h2>${usersTable(data.suspended, 'review')}`;
  } else {
    content = listingsTable(data.listings);
  }

  // Search box (number, phone or name) and page links for the long lists.
  const searchable = ['pending', 'reported', 'review', 'all', 'users'].includes(tab);
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
  const pageHref = (p2) => `/admin${qs({ tab, q, page: p2 > 1 ? p2 : '' })}`;
  const pager =
    searchable && data.pages > 1
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

function articlePage(ctx, a, all) {
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
  importPage,
  passwordPage,
  profilePage,
  registerPage,
  loginPage,
  myPage,
  adminPage,
  errorPage,
  bulkPage,
  confirmPage,
  notifyPage,
  aboutPage,
  contactPage,
  faqPage,
  articlesPage,
  articlePage,
};
