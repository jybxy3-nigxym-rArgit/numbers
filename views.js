'use strict';

const { NETWORKS, CITIES, PATTERN_KEYS, REPORT_REASONS, NETWORK_BY_KEY, CITY_BY_KEY } = require('./data');
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

function priceHtml(ctx, price, big = false) {
  const cls = big ? 'price price-lg' : 'price';
  if (price == null) return `<span class="${cls} ask">${esc(ctx.t('price_ask'))}</span>`;
  return `<span class="${cls}"><bdi>${esc(formatPrice(price))}</bdi> <small>${esc(ctx.t('sar'))}</small></span>`;
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

function layout(ctx, { title, fullTitle: fullOverride, desc, body, hero = '', canonical, noindex, robots, ld = [] }) {
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

  const nav = user
    ? `
      <a href="/my">${esc(t('my_ads'))}</a>
      ${util.rankOf(user) >= 1 ? `<a href="/admin">${esc(t('admin'))}</a>` : ''}
      <form method="post" action="/logout" class="inline">${csrfInput(ctx)}<button type="submit" class="link-btn">${esc(t('logout'))}</button></form>`
    : `
      <a href="/login">${esc(t('login'))}</a>
      <a href="/register">${esc(t('register'))}</a>`;

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
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
<link rel="icon" href="/favicon.png" type="image/png" sizes="192x192">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lalezar&amp;family=Tajawal:wght@400;500;700;900&amp;display=swap">
<link rel="stylesheet" href="/style.css?v=${esc(ASSET_V)}">
${jsonLd(ld)}
</head>
<body>
<a class="skip" href="#main">${esc(t('skip'))}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="${esc(siteName)}"><img class="brand-mark" src="/brand.png" width="44" height="44" alt="">${esc(siteName)}</a>
    <nav class="nav" aria-label="Main">
      ${nav}
      <a href="/lang/${esc(t('lang_code'))}?next=${next}" hreflang="${esc(t('lang_code'))}" lang="${esc(t('lang_code'))}">${esc(t('lang_switch'))}</a>
      <a class="nav-add" href="/post">${esc(t('post_ad'))}</a>
    </nav>
  </div>
</header>
${hero}
<main id="main" class="wrap">
${flash}
${body}
</main>
<footer class="foot">
  <div class="wrap foot-bar">
    <p>${esc(t('footer_note'))}</p>
  </div>
</footer>
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
  }
  return parts.length ? `<div class="plate-actions">${parts.join('')}</div>` : '';
}

// The number plate: network on top, big number, then city, price and age in one row.
function plateFace(ctx, l, tag = 'span') {
  return `
    <span class="p-net">${esc(netName(ctx, l.network))}</span>
    <${tag} class="p-num" dir="ltr" aria-label="${esc(formatNumberPlain(l.number))}">${esc(l.number)}</${tag}>
    <span class="p-foot">
      <span class="p-city">${esc(cityName(ctx, l.city))}</span>
      ${priceHtml(ctx, l.price)}
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
  l.seller ? `<span class="adv${advSize(l.seller)}" title="${esc(l.seller)}">${esc(l.seller)}</span>` : '';

const plateBadges = (ctx, l) =>
  (l.pinned && l.status === 'active' ? `<span class="pin-badge">${esc(ctx.t('pinned_badge'))}</span>` : '') +
  (l.status === 'sold' ? `<span class="sold-stamp">${esc(ctx.t('sold_stamp'))}</span>` : '');

const cardClass = (l, extra = '') =>
  `plate-card${extra}${l.pinned && l.status === 'active' ? ' is-pinned' : ''}${l.status === 'sold' ? ' is-sold' : ''}`;

function plate(ctx, l) {
  return `
  <div class="${cardClass(l)}">
    ${plateBadges(ctx, l)}
    <a class="plate" href="/n/${l.id}">${plateFace(ctx, l)}</a>
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
  const name = landing.type === 'network' ? netName(ctx, key) : landing.type === 'city' ? cityName(ctx, key) : t('pat_' + key);
  const prefix = landing.type;
  const title = t(`${prefix === 'type' ? 'type' : prefix === 'network' ? 'net' : 'city'}_title`, { name });
  const desc = t(`${prefix === 'type' ? 'type' : prefix === 'network' ? 'net' : 'city'}_desc`, { name });
  return { path: `/${landing.type}/${key}`, h1: title, fullTitle: `${title} | ${t('site_name')}`, desc, lede: desc, name };
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
  return `
  <nav class="browse" aria-label="${esc(t('browse_net'))}">
    <h2>${esc(t('browse_net'))}</h2><div class="chips">${nets}</div>
    ${cities ? `<h2>${esc(t('browse_city'))}</h2><div class="chips">${cities}</div>` : ''}
    <h2>${esc(t('browse_type'))}</h2><div class="chips">${types}</div>
  </nav>`;
}

function homePage(ctx, { filters, rows, total, page, pages, siteEmpty, landing, counts }) {
  const { t } = ctx;
  const f = filters;
  const info = landingInfo(ctx, landing);
  const base = { q: f.qRaw, city: landing ? '' : f.city, max: f.maxRaw };
  const anyFilter = !!(f.qRaw || f.maxRaw || (!landing && f.city));

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
    robots: anyFilter || thin ? 'noindex, follow' : '',
    ld,
  });
}

// ---- Listing page ----------------------------------------------------------

function listingPage(ctx, l, { canManage }) {
  const { t } = ctx;
  const waText = t('wa_message', { number: l.number });
  const wa = `https://wa.me/${encodeURIComponent(l.contact)}?text=${encodeURIComponent(waText)}`;
  const isLive = l.status === 'active';

  const notices = [];
  if (l.status === 'sold') notices.push(`<div class="notice">${esc(t('sold_notice'))}</div>`);
  if (canManage && l.status !== 'active' && l.status !== 'sold') {
    notices.push(`<div class="notice">${esc(t('owner_view_notice'))} ${statusBadge(ctx, l.status)}</div>`);
  }

  const reasonOptions = REPORT_REASONS.map((r) => ({ value: r, label: t('r_' + r) }));

  const body = `
  <article class="listing">
    ${notices.join('')}
    <div class="${cardClass(l, ' plate-big')}">
      ${plateBadges(ctx, l)}
      <div class="plate">${plateFace(ctx, l, 'h1')}</div>
      ${advTab(ctx, l)}
      ${cardActions(ctx, l, { deleteNext: '/my' })}
    </div>

    <div class="listing-side">
      ${
        isLive
          ? `<a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener nofollow">${esc(t('whatsapp'))}</a>`
          : ''
      }
      <dl class="facts">
        <div><dt>${esc(t('network'))}</dt><dd><a href="/network/${esc(l.network)}">${esc(netName(ctx, l.network))}</a></dd></div>
        <div><dt>${esc(t('city'))}</dt><dd><a href="/city/${esc(l.city)}">${esc(cityName(ctx, l.city))}</a></dd></div>
        <div><dt>${esc(t('seller'))}</dt><dd>${esc(l.seller)}</dd></div>
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
  </article>`;

  const plain = formatNumberPlain(l.number);
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
    noindex: !isLive,
    canonical: url,
    ld,
  });
}

// ---- Post form -------------------------------------------------------------

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
      ${field(ctx, { id: 'number', name: 'number', label: t('f_number'), hint: t('f_number_hint'), value: v.number, error: errors.number, attrs: 'inputmode="numeric" autocomplete="off" required' })}
      ${selectField(ctx, { id: 'network', name: 'network', label: t('f_network'), options: networkOptions(ctx), value: v.network, error: errors.network, placeholder: t('f_choose') })}
      ${selectField(ctx, { id: 'city', name: 'city', label: t('f_city'), options: cityOptions(ctx), value: v.city, error: errors.city, placeholder: t('f_choose') })}
      ${field(ctx, { id: 'price', name: 'price', label: t('f_price'), hint: t('f_price_hint'), value: v.price, error: errors.price, attrs: 'inputmode="numeric" autocomplete="off"' })}
      ${field(ctx, { id: 'contact', name: 'contact', label: t('f_contact'), hint: t('f_contact_hint'), value: v.contact, error: errors.contact, attrs: 'inputmode="tel" autocomplete="off"' })}
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
      ${field(ctx, { id: 'contact', name: 'contact', label: t('f_contact'), hint: t('f_contact_hint'), value: v.contact, error: errors.contact, attrs: 'inputmode="tel" autocomplete="off"' })}
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
      ${field(ctx, { id: 'phone', name: 'phone', label: t('f_phone'), hint: t('f_number_hint'), value: v.phone, error: errors.phone, attrs: 'inputmode="tel" autocomplete="tel" required' })}
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
      ${field(ctx, { id: 'phone', name: 'phone', label: t('f_phone'), value: v.phone, attrs: 'inputmode="tel" autocomplete="username" required' })}
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
        </div>
        <div class="my-actions">
          ${
            l.status === 'sold'
              ? `<span class="sold-tag">${esc(t('sold_stamp'))}</span>`
              : `${
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

  const body = `<section><h1>${esc(t('my_title'))}</h1>${list}<p class="alt"><a href="/profile">${esc(t('profile_title'))}</a> · <a href="/password">${esc(t('change_password'))}</a></p></section>`;
  return layout(ctx, { title: t('my_title'), body, noindex: true });
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
  ];
  const tabs = senior ? allTabs : allTabs.filter(([k]) => ['reported', 'all', 'users'].includes(k));
  const tabNav = `<nav class="tabs" aria-label="Admin">${tabs
    .map(([k, label]) => `<a href="/admin?tab=${k}"${tab === k ? ' aria-current="page"' : ''}>${esc(label)}</a>`)
    .join('')}${senior ? `<a href="/admin/import">${esc(t('a_import'))}</a>` : ''}</nav>`;

  const roleBadge = (u) =>
    u.is_admin
      ? ` <span class="badge badge-pin">${esc(t('role_owner'))}</span>`
      : u.role === 'super'
        ? ` <span class="badge badge-pin">${esc(t('role_super'))}</span>`
        : u.role === 'mod'
          ? ` <span class="badge badge-pin">${esc(t('role_mod'))}</span>`
          : '';

  const userForm = (u, action, label, cls = 'btn-ghost', tabName = 'users') =>
    `<form method="post" action="/admin/u/${u.id}/${action}">${csrfInput(ctx)}<input type="hidden" name="tab" value="${esc(tabName)}"><button class="btn ${cls} btn-small" type="submit">${esc(label)}</button></form>`;

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
            if (mayAct) {
              if (u.suspended) {
                if (senior || u.suspended === me.id) acts.push(userForm(u, 'unsuspend', t('unsuspend'), 'btn-ghost', tabName));
              } else acts.push(userForm(u, 'suspend', t('suspend'), 'btn-ghost', tabName));
              if (senior) {
                acts.push(userForm(u, u.banned ? 'unban' : 'ban', t(u.banned ? 'unban' : 'ban'), 'btn-ghost', tabName));
                acts.push(
                  `<form method="post" action="/admin/u/${u.id}/reset">${csrfInput(ctx)}<button class="btn btn-ghost btn-small" type="submit">${esc(t('a_reset_pass'))}</button></form>`
                );
              }
            }
            if (senior && !u.is_admin && mayAct && !mine) {
              const roles = rank >= 3 ? [['user', t('role_user')], ['mod', t('role_mod')], ['super', t('role_super')]] : [['user', t('role_user')], ['mod', t('role_mod')]];
              acts.push(
                `<form method="post" action="/admin/u/${u.id}/role" class="name-edit">${csrfInput(ctx)}<select name="role" aria-label="${esc(t('a_role'))}">
                  ${roles.map(([k, label]) => `<option value="${k}"${(u.role || 'user') === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}
                </select><button class="btn btn-ghost btn-small" type="submit">${esc(t('save'))}</button></form>`
              );
            }
            return `<tr>
          <td>${nameCell}${roleBadge(u)}${u.banned ? ` ${statusBadge(ctx, 'hidden')}` : ''}${u.suspended ? ` <span class="badge badge-pending">${esc(t('suspended_badge'))}</span>` : ''}${u.banned_devices ? ` <small>${esc(t('a_device_banned'))}</small>` : ''}${u.suspended_by_name ? `<br><small>${esc(t('suspended_by', { name: u.suspended_by_name }))}</small>` : ''}</td>
          <td dir="ltr">0${esc(u.phone)}</td>
          <td>${u.ads ?? ''}</td>
          <td>${esc(String(u.created_at).slice(0, 10))}</td>
          <td><div class="actions">${acts.join('')}</div></td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<p>${esc(t('a_nothing'))}</p>`;

  const listingsTable = (listings) => {
    const act = (l, action, label, cls = 'btn-ghost') =>
      `<form method="post" action="/admin/l/${l.id}/${action}">${csrfInput(ctx)}<input type="hidden" name="tab" value="${esc(tab)}"><button class="btn ${cls} btn-small" type="submit">${esc(label)}</button></form>`;
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
          <td>${statusBadge(ctx, l.status)}${l.pinned ? ` <span class="badge badge-pin">${esc(t('pinned_badge'))}</span>` : ''}${l.hidden_by ? `<br><small>${esc(t('hidden_by_mod'))}</small>` : ''}${l.report_count ? `<br><small>${esc(t('reports_n', { n: l.report_count }))}</small>` : ''}</td>
          <td class="actions">${acts.join('')}</td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : `<p>${esc(t('a_nothing'))}</p>`;
  };

  let content = '';
  if (tab === 'stats') {
    const s = data.stats;
    content = `<div class="stats">
      <div><strong>${s.active}</strong><span>${esc(t('a_total_ads'))}</span></div>
      <div><strong>${s.pending}</strong><span>${esc(t('a_pending'))}</span></div>
      <div><strong>${s.reports}</strong><span>${esc(t('a_total_reports'))}</span></div>
      <div><strong>${s.users}</strong><span>${esc(t('a_total_users'))}</span></div>
    </div>`;
  } else if (tab === 'users') {
    content = usersTable(data.users, 'users');
  } else if (tab === 'review') {
    content = `<p class="lede">${esc(t('a_review_intro'))}</p>
      <h2>${esc(t('a_review_ads'))}</h2>${listingsTable(data.listings)}
      <h2>${esc(t('a_review_users'))}</h2>${usersTable(data.suspended, 'review')}`;
  } else {
    content = listingsTable(data.listings);
  }

  const body = `<section><h1>${esc(t('admin_title'))}</h1>${tabNav}${content}</section>`;
  return layout(ctx, { title: t('admin_title'), body, noindex: true });
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
};
