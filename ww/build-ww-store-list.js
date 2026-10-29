#!/usr/bin/env node
/**
 * 屈臣氏酒窖 Watsons Wine 分店地址頁（中英雙語）
 * 藍本: https://www.watsonswine.com/zh-hk/store-finder
 * 資料來源: https://api.watsonswine.com/api/v2/wwhk/stores/watStores
 * 用法: node build-ww-store-list.js [輸出目錄]
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.argv[2] || __dirname;
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const OUT_JSON = path.join(OUT_DIR, 'ww-stores.json');

const BASE = 'https://api.watsonswine.com/api/v2/wwhk/stores/watStores?currentPage=0&pageSize=500&fields=FULL&isCceOrCc=false&isPayCollect=false';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'application/json',
  Referer: 'https://www.watsonswine.com/zh-hk/store-finder',
};

/** 解析營業時間: ^zt^星期一至日^10am - 8pm → 星期一至日 10am - 8pm */
function parseHours(raw) {
  if (!raw) return '';
  const parts = String(raw).split('^').filter(p => p && p.trim());
  if (parts.length && /^(zt|en)$/i.test(parts[0].trim())) parts.shift();
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const label = parts[i].trim();
    const time = (parts[i + 1] || '').trim();
    out.push(time ? `${label} ${time}` : label);
  }
  return out.join('；');
}

/** 中文地區由 town 轉換 */
function townZh(town) {
  const map = { '香港': '香港島', '九龍': '九龍', '新界': '新界', '澳門': '澳門' };
  return map[town] || town || '';
}

async function fetchLang(lang) {
  const r = await fetch(`${BASE}&lang=${lang}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`${lang} HTTP ${r.status}`);
  const j = await r.json();
  return j.stores || [];
}

async function main() {
  console.log('抓取中英雙語店舖資料...');
  const [zhList, enList] = await Promise.all([fetchLang('zh_HK'), fetchLang('en')]);
  console.log(`中文 ${zhList.length} 間 / 英文 ${enList.length} 間`);

  const enMap = new Map(enList.map(s => [s.elabStoreNumber, s]));

  const records = zhList.map(z => {
    const e = enMap.get(z.elabStoreNumber) || {};
    const za = z.address || {};
    const ea = e.address || {};
    const features = (z.elabFeatures || []).map(f => ({ code: f.code || '', zh: f.name || '' }));
    return {
      storeNo: z.elabStoreNumber || '',
      nameZh: (z.displayName || '').trim(),
      nameEn: (e.displayName || z.displayName || '').trim(),
      townZh: townZh(za.town),
      townEn: (ea.town || '').trim(),
      districtZh: (za.district || '').trim(),
      districtEn: (ea.district || za.district || '').trim(),
      addressZh: (za.line1 || za.displayAddress1 || '').trim(),
      addressEn: (ea.line1 || ea.displayAddress1 || '').trim(),
      hoursZh: parseHours(z.openingHours && z.openingHours.name),
      hoursEn: parseHours(e.openingHours && e.openingHours.name),
      phone: (za.phone || za.phone1 || '').trim(),
      features,
      geo: z.geoPoint ? { lat: z.geoPoint.latitude, lng: z.geoPoint.longitude } : null,
      url: z.url || '',
    };
  });

  // 排序: 地區（香港島→九龍→新界→澳門）→ 分區 → 店名
  const townOrder = ['香港島', '九龍', '新界', '澳門'];
  records.sort((a, b) => {
    const ta = townOrder.indexOf(a.townZh), tb = townOrder.indexOf(b.townZh);
    if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
    if (a.districtEn !== b.districtEn) return a.districtEn.localeCompare(b.districtEn, 'en');
    return a.nameEn.localeCompare(b.nameEn, 'en');
  });

  fs.writeFileSync(OUT_JSON, JSON.stringify({ fetchedAt: new Date().toISOString(), count: records.length, stores: records }, null, 2), 'utf8');

  const fetchedAt = new Date();
  const dateStr = fetchedAt.toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' });

  // 篩選選項
  const towns = [...new Set(records.map(r => r.townZh))].filter(Boolean);
  const districts = [...new Set(records.map(r => r.districtZh))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en'));

  const card = (r) => {
    const mapLink = r.geo ? `https://www.google.com/maps?q=${r.geo.lat},${r.geo.lng}` : '#';
    const feats = r.features.length
      ? `<div class="tags">${r.features.map(f => `<span class="tag" title="${esc(f.code)}">${esc(f.zh || f.code)}</span>`).join('')}</div>`
      : '';
    return `<article class="store-card" data-town="${esc(r.townZh)}" data-district="${esc(r.districtZh)}" data-store-no="${esc(r.storeNo)}" data-search="${esc([r.storeNo, r.nameZh, r.nameEn, r.addressZh, r.addressEn, r.districtZh, r.districtEn].join(' ').toLowerCase())}">
  <div class="card-head">
    <span class="store-no">${esc(r.storeNo)}</span>
    <div class="names">
      <div class="name-zh">${esc(r.nameZh)}</div>
      <div class="name-en">${esc(r.nameEn)}</div>
    </div>
  </div>
  <dl class="fields">
    <div class="field">
      <dt>地址 Address</dt>
      <dd><span class="zh">${esc(r.addressZh)}</span><span class="en">${esc(r.addressEn)}</span></dd>
    </div>
    <div class="field">
      <dt>營業時間 Opening Hours</dt>
      <dd><span class="zh">${esc(r.hoursZh)}</span><span class="en">${esc(r.hoursEn)}</span></dd>
    </div>
    ${r.phone ? `<div class="field"><dt>電話 Tel</dt><dd><span class="zh">${esc(r.phone)}</span><span class="en">${esc(r.phone)}</span></dd></div>` : ''}
    <div class="field">
      <dt>地區 District</dt>
      <dd><span class="zh">${esc(r.townZh)} · ${esc(r.districtZh)}</span><span class="en">${esc(r.townEn)} · ${esc(r.districtEn)}</span></dd>
    </div>
  </dl>
  ${feats}
  <div class="links">
    <a href="${mapLink}" target="_blank" rel="noopener">地圖 Map</a>
    ${r.url ? `<a href="https://www.watsonswine.com${esc(r.url)}" target="_blank" rel="noopener">官方頁面 Store page</a>` : ''}
  </div>
</article>`;
  };

  // 按地區分組
  const grouped = new Map();
  for (const r of records) {
    if (!grouped.has(r.townZh)) grouped.set(r.townZh, []);
    grouped.get(r.townZh).push(r);
  }
  const sections = [...grouped.entries()].map(([town, list]) => {
    const townEn = list[0].townEn || '';
    const districtBlocks = [];
    const byDistrict = new Map();
    for (const r of list) {
      if (!byDistrict.has(r.districtZh)) byDistrict.set(r.districtZh, []);
      byDistrict.get(r.districtZh).push(r);
    }
    for (const [d, dl] of byDistrict) {
      districtBlocks.push(`<div class="district"><h3>${esc(d)} <span class="count">${dl.length}</span></h3><div class="cards">${dl.map(card).join('\n')}</div></div>`);
    }
    return `<section class="town" data-town="${esc(town)}"><h2>${esc(town)} <span class="en-title">${esc(townEn)}</span> <span class="count">${list.length}</span></h2>${districtBlocks.join('\n')}</section>`;
  });

  const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>屈臣氏酒窖 分店地址 | Watsons Wine Store Finder</title>
<meta name="description" content="屈臣氏酒窖 Watsons Wine 全港分店地址、營業時間及電話，中英雙語對照，按地區分區整理，每日自動更新。">
<style>
:root { --primary:#00a3a3; --accent:#0b7d7d; --bg:#fff; --fg:#1f2430; --muted:#6b7280; --card:#fff; --border:#e5e7eb; --tag:#e8f7f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1418; --fg:#e5e7eb; --muted:#9ca3af; --card:#17202a; --border:#2a3540; --tag:#123b3b; } }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; padding:1rem; }
header { max-width:1100px; margin:0 auto 1.25rem; }
h1 { font-size:1.5rem; color:var(--primary); }
h1 .en-title { font-size:1rem; color:var(--muted); font-weight:400; }
.sub { color:var(--muted); font-size:.84rem; margin-top:.3rem; }
main { max-width:1100px; margin:0 auto; }
.filters { position:sticky; top:0; z-index:10; background:var(--bg); border:1px solid var(--border); border-radius:.5rem; padding:.8rem .9rem; margin-bottom:1.25rem; display:flex; flex-wrap:wrap; gap:.7rem; align-items:flex-end; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.filters label { display:flex; flex-direction:column; gap:.2rem; font-size:.76rem; color:var(--muted); }
.filters select, .filters input { background:var(--card); color:var(--fg); border:1px solid var(--border); border-radius:.35rem; padding:.38rem .5rem; font-size:.88rem; min-width:150px; }
.filters input { min-width:230px; }
.filter-reset { background:transparent; color:var(--primary); border:1px solid var(--primary); border-radius:.35rem; padding:.38rem .7rem; font-size:.84rem; cursor:pointer; }
.filter-reset:hover { background:var(--primary); color:#fff; }
.filter-count { font-size:.8rem; color:var(--muted); margin-left:auto; align-self:center; }
.town { margin-bottom:2rem; }
.town h2 { font-size:1.2rem; color:var(--accent); border-bottom:2px solid var(--primary); padding-bottom:.3rem; margin-bottom:.7rem; }
.town h2 .en-title { font-size:.82rem; color:var(--muted); font-weight:400; margin-left:.3rem; }
.count { color:var(--muted); font-weight:400; font-size:.82rem; }
.district { margin:.5rem 0 1.1rem; }
.district h3 { font-size:1rem; margin-bottom:.45rem; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:.75rem; }
.store-card { background:var(--card); border:1px solid var(--border); border-radius:.5rem; padding:.85rem .95rem; display:flex; flex-direction:column; gap:.5rem; }
.card-head { display:flex; gap:.6rem; align-items:baseline; }
.store-no { background:var(--primary); color:#fff; font-size:.72rem; font-weight:700; padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.names { flex:1; }
.name-zh { font-weight:600; font-size:1.02rem; }
.name-en { font-size:.85rem; color:var(--muted); }
.fields { display:flex; flex-direction:column; gap:.4rem; }
.field dt { font-size:.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
.field dd { display:flex; flex-direction:column; gap:.05rem; }
.field .zh { font-size:.9rem; }
.field .en { font-size:.8rem; color:var(--muted); }
.tags { display:flex; flex-wrap:wrap; gap:.3rem; }
.tag { background:var(--tag); color:var(--accent); font-size:.7rem; padding:.12rem .45rem; border-radius:.25rem; }
.links { display:flex; gap:.9rem; }
.links a { color:var(--primary); font-size:.82rem; text-decoration:none; }
.links a:hover { text-decoration:underline; }
footer { max-width:1100px; margin:2rem auto 0; color:var(--muted); font-size:.78rem; border-top:1px solid var(--border); padding-top:.7rem; }
@media (max-width:680px) { .cards { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <h1>屈臣氏酒窖 分店地址 <span class="en-title">Watsons Wine Store Finder</span></h1>
  <div class="sub">資料來源：屈臣氏酒窖官方網站 store finder（中英雙語對照）・最後更新：${dateStr}・共 ${records.length} 間分店</div>
</header>
<main>
<div class="filters">
  <label>地區 Region
    <select id="filter-town">
      <option value="">全部 All</option>
${towns.map(t => {
  const en = (records.find(r => r.townZh === t) || {}).townEn || '';
  return `      <option value="${esc(t)}">${esc(t)} ${esc(en)}</option>`;
}).join('\n')}
    </select>
  </label>
  <label>分區 District
    <select id="filter-district">
      <option value="">全部 All</option>
${districts.map(d => {
  const en = (records.find(r => r.districtZh === d) || {}).districtEn || '';
  return `      <option value="${esc(d)}">${esc(d)}${en ? ' / ' + esc(en) : ''}</option>`;
}).join('\n')}
    </select>
  </label>
  <label>搜尋 Search
    <input id="filter-search" type="search" placeholder="店名 / 地址 Name or address">
  </label>
  <button type="button" class="filter-reset" id="filter-reset">清除 Clear</button>
  <span class="filter-count" id="filter-count">顯示 ${records.length} 間</span>
</div>
${sections.join('\n')}
</main>
<footer>本頁資料自動抓取自屈臣氏酒窖官方網站，僅供參考；實際營業時間以官方為準。中英雙語欄位分別取自官方繁體中文及英文版頁面。抓取時間：${fetchedAt.toISOString()}</footer>
<script>
(function () {
  var townSel = document.getElementById('filter-town');
  var distSel = document.getElementById('filter-district');
  var searchIn = document.getElementById('filter-search');
  var resetBtn = document.getElementById('filter-reset');
  var countEl = document.getElementById('filter-count');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.store-card'));
  var districts = Array.prototype.slice.call(document.querySelectorAll('.district'));
  var towns = Array.prototype.slice.call(document.querySelectorAll('.town'));
  var total = cards.length;

  function apply() {
    var vTown = townSel.value, vDist = distSel.value, vQ = (searchIn.value || '').trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var ok = (!vTown || c.getAttribute('data-town') === vTown) &&
               (!vDist || c.getAttribute('data-district') === vDist) &&
               (!vQ || (c.getAttribute('data-search') || '').indexOf(vQ) !== -1);
      c.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    districts.forEach(function (d) {
      var any = Array.prototype.some.call(d.querySelectorAll('.store-card'), function (x) { return x.style.display !== 'none'; });
      d.style.display = any ? '' : 'none';
    });
    towns.forEach(function (t) {
      var any = Array.prototype.some.call(t.querySelectorAll('.store-card'), function (x) { return x.style.display !== 'none'; });
      t.style.display = any ? '' : 'none';
    });
    countEl.textContent = '顯示 ' + shown + ' / ' + total + ' 間';
  }

  townSel.addEventListener('change', apply);
  distSel.addEventListener('change', apply);
  searchIn.addEventListener('input', apply);
  resetBtn.addEventListener('click', function () {
    townSel.value = ''; distSel.value = ''; searchIn.value = '';
    apply();
  });
})();
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log('已寫入:', OUT_HTML, `(${html.length} bytes, ${records.length} 間分店)`);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
