#!/usr/bin/env node
/**
 * Fortress (豐澤) 店舖位置抓取 + HTML 生成器
 * 資料來源: https://api.fortress.com.hk/api/v2/ftrhk/stores/watStores
 * 用法: node build-fortress-html.js [輸出目錄]
 */
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.fortress.com.hk/api/v2/ftrhk/stores/watStores?currentPage=0&pageSize=500&isCceOrCc=false&isPayCollect=false&fields=FULL';
const OUT_DIR = process.argv[2] || __dirname;
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const OUT_JSON = path.join(OUT_DIR, 'fortress-stores.json');

/** 清理營業時間: 取 ^zt^ 之後第一個有意義區段, 去掉 3HK 店中店/電話號碼/店號 */
function parseHours(raw) {
  if (!raw) return '資料從缺';
  let s = String(raw);
  s = s.replace(/^\^zt\^/, '');          // strip leading ^zt^
  const segments = s.split('^').filter(Boolean);
  if (segments.length === 0) return '資料從缺';
  // 第一個 segment 通常是主營業時間; 若含 "店中店" 或其他標記, 過濾純時間段
  let main = segments[0].trim();
  // 若有 3HK 店中店 (segments 含 "3"), 合併主時間+店中店時間
  const idx3 = segments.indexOf('3');
  if (idx3 >= 0 && segments[idx3 + 1]) {
    main = main + '；' + segments[idx3 + 1].trim();
  }
  // 清除殘留電話號碼 (8位數字)
  main = main.replace(/\d{8}/g, '').trim();
  // 清理重複分號與空白
  main = main.replace(/；+/g, '；').replace(/^；|；$/g, '').trim();
  return main || '資料從缺';
}

/** 分區歸類: area (KLN/NT/HK/MO) 對應 九龍/新界/香港島/澳門 */
function regionLabel(area, town) {
  if (town) {
    if (town.includes('九龍')) return '九龍';
    if (town.includes('新界')) return '新界';
    if (town.includes('香港')) return '香港島';
    if (town.includes('澳門')) return '澳門';
  }
  switch (area) {
    case 'KLN': return '九龍';
    case 'NT': return '新界';
    case 'HK': return '香港島';
    case 'MO': return '澳門';
    default: return '其他';
  }
}

async function main() {
  console.log('抓取中:', API_URL);
  const resp = await fetch(API_URL, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const stores = data.stores || [];
  console.log(`共 ${stores.length} 間店舖`);

  const records = stores.map((s) => {
    const addr = s.address || {};
    const hours = parseHours(s.openingHours && s.openingHours.name);
    return {
      name: (s.displayName || s.name || '未命名').trim(),
      region: regionLabel(addr.area, addr.town),
      district: (addr.district || '其他').trim(),
      town: (addr.town || '').trim(),
      address: (addr.line1 || addr.displayAddress1 || addr.addressLine1 || addr.formattedAddress || '').trim(),
      hours,
      geo: s.geoPoint ? { lat: s.geoPoint.latitude, lng: s.geoPoint.longitude } : null,
      url: s.url || '',
      storeNo: s.elabStoreNumber || '',
    };
  });

  // 標記 TechLife 店中店/概念店
  for (const r of records) {
    r.isTechLife = /TechLife/.test(r.name);
  }

  // 排序: 先分主店/TechLife 兩大類, 類內按分區順序 + 名稱排序
  const regionOrder = ['香港島', '九龍', '新界', '澳門'];
  records.sort((a, b) => {
    if (a.isTechLife !== b.isTechLife) return a.isTechLife ? 1 : -1;
    const ra = regionOrder.indexOf(a.region), rb = regionOrder.indexOf(b.region);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'zh-HK');
  });

  // 分組: isTechLife -> region -> [records]
  const groups = new Map(); // false -> 主店舖, true -> TechLife 店中店
  for (const r of records) {
    if (!groups.has(r.isTechLife)) groups.set(r.isTechLife, new Map());
    const rm = groups.get(r.isTechLife);
    if (!rm.has(r.region)) rm.set(r.region, []);
    rm.get(r.region).push(r);
  }

  // 寫 JSON (供更新/除錯)
  fs.writeFileSync(OUT_JSON, JSON.stringify({ fetchedAt: new Date().toISOString(), count: stores.length, stores: records }, null, 2), 'utf8');

  // 產生 HTML
  const fetchedAt = new Date();
  const dateStr = fetchedAt.toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' });

  const categoryBlocks = [];
  const categories = [
    { key: false, title: '主店舖', cls: 'cat-main', catVal: 'main' },
    { key: true, title: 'TechLife 店中店', cls: 'cat-techlife', catVal: 'techlife' },
  ];
  for (const cat of categories) {
    const rm = groups.get(cat.key);
    if (!rm || rm.size === 0) continue;
    const card = (r) => {
      const mapLink = r.geo ? `https://www.google.com/maps?q=${r.geo.lat},${r.geo.lng}` : '#';
      // 店號顯示在店名前: "2010 - 中環分店"
      const displayName = r.storeNo ? `${r.storeNo} - ${r.name}` : r.name;
      return `<div class="store-card${r.isTechLife ? ' techlife' : ''}" data-store-no="${esc(r.storeNo)}" data-region="${esc(r.region)}" data-category="${cat.catVal}">
  <div class="store-head"><span class="store-name">${esc(displayName)}</span></div>
  <div class="store-addr">${esc(r.address)}</div>
  <div class="store-hours">${esc(r.hours)}</div>
  <div class="store-links"><a href="${mapLink}" target="_blank" rel="noopener">查看地圖</a>${r.url ? `<a href="https://www.fortress.com.hk${r.url}" target="_blank" rel="noopener">官方頁面</a>` : ''}</div>
</div>`;
    };
    const regionBlocks = [];
    let total = 0;
    for (const [region, list] of rm) {
      total += list.length;
      regionBlocks.push(`<div class="subgroup" data-region-group="${esc(region)}"><h3>${esc(region)} <span class="count">${list.length}</span></h3><div class="stores">${list.map(card).join('\n')}</div></div>`);
    }
    categoryBlocks.push(`<section class="category ${cat.cls}" data-category-section="${cat.catVal}"><h2>${esc(cat.title)} <span class="count">${total}</span></h2>${regionBlocks.join('\n')}</section>`);
  }

  // 篩選表單的選項資料
  const storeNoOptions = [...new Set(records.map(r => r.storeNo).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b))
    .map(no => {
      const r = records.find(x => x.storeNo === no);
      return `<option value="${esc(no)}">${esc(no)} - ${esc(r.name)}</option>`;
    }).join('\n');
  const regionOptions = ['香港島', '九龍', '新界', '澳門']
    .map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('\n');
  const categoryOptions = `
        <option value="main">主店舖</option>
        <option value="techlife">TechLife 店中店</option>`;
  const resultCountLabel = `<span id="filter-result-count"></span>`;

  const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>豐澤 Fortress 分店一覽</title>
<meta name="description" content="豐澤 Fortress 全港分店名稱、地址與營業時間，按分區整理，每日自動更新。">
<style>
:root { --primary:#f69023; --bg:#fff; --fg:#1f2430; --muted:#6b7280; --card:#fff; --border:#e5e7eb; }
@media (prefers-color-scheme: dark) { :root { --bg:#111418; --fg:#e5e7eb; --muted:#9ca3af; --card:#1a1f26; --border:#2a313c; } }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:"Segoe UI", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; padding:1rem; }
header { max-width:1000px; margin:0 auto 1.5rem; }
h1 { font-size:1.6rem; color:var(--primary); }
.sub { color:var(--muted); font-size:.85rem; margin-top:.25rem; }
main { max-width:1000px; margin:0 auto; }
.filters { position:sticky; top:0; z-index:10; background:var(--bg); border:1px solid var(--border); border-radius:.5rem; padding:.8rem .9rem; margin-bottom:1.2rem; display:flex; flex-wrap:wrap; gap:.7rem; align-items:flex-end; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.filters label { display:flex; flex-direction:column; gap:.2rem; font-size:.78rem; color:var(--muted); }
.filters select { background:var(--card); color:var(--fg); border:1px solid var(--border); border-radius:.35rem; padding:.35rem .5rem; font-size:.9rem; min-width:130px; }
.filters select#filter-store-no { min-width:220px; }
.filter-reset { background:transparent; color:var(--primary); border:1px solid var(--primary); border-radius:.35rem; padding:.35rem .7rem; font-size:.85rem; cursor:pointer; }
.filter-reset:hover { background:var(--primary); color:#fff; }
.filter-count { font-size:.82rem; color:var(--muted); margin-left:auto; align-self:center; }
.category { margin-bottom:2.5rem; }
.category h2 { font-size:1.35rem; border-bottom:2px solid var(--primary); padding-bottom:.35rem; margin-bottom:.75rem; }
.category.cat-techlife h2 { color:var(--primary); }
.category.cat-techlife h2::after { content:"（與主店分開顯示）"; font-size:.75rem; color:var(--muted); font-weight:400; margin-left:.5rem; }
.count { color:var(--muted); font-weight:400; font-size:.9rem; }
.subgroup { margin:.6rem 0 1.2rem; }
.subgroup h3 { font-size:1.05rem; margin-bottom:.5rem; color:var(--fg); }
.subgroup:not(:first-of-type) { border-top:1px dashed var(--border); padding-top:.9rem; }
.stores { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:.75rem; }
.store-card { background:var(--card); border:1px solid var(--border); border-radius:.5rem; padding:.8rem .9rem; display:flex; flex-direction:column; gap:.3rem; }
.store-card.techlife { border-color:var(--primary); }
.store-head { display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; }
.store-name { font-weight:600; }
.store-addr { color:var(--muted); font-size:.88rem; }
.store-hours { font-size:.88rem; }
.store-links a { color:var(--primary); font-size:.82rem; margin-right:.8rem; }
footer { max-width:1000px; margin:2rem auto 0; color:var(--muted); font-size:.8rem; border-top:1px solid var(--border); padding-top:.75rem; }
@media (max-width:640px) { .stores { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <h1>豐澤 Fortress 分店一覽</h1>
  <div class="sub">資料來源：Fortress 官方網站店舖位置頁（每日自動更新）・最後更新：${dateStr}・共 ${records.length} 間店舖</div>
</header>
<main>
<div class="filters">
  <label>店號
    <select id="filter-store-no">
      <option value="">全部</option>
${storeNoOptions}
    </select>
  </label>
  <label>地區
    <select id="filter-region">
      <option value="">全部</option>
${regionOptions}
    </select>
  </label>
  <label>店類分類
    <select id="filter-category">
      <option value="">全部</option>
${categoryOptions}
    </select>
  </label>
  <button type="button" class="filter-reset" id="filter-reset">清除篩選</button>
  <span class="filter-count" id="filter-count">顯示 ${records.length} 間</span>
</div>
${categoryBlocks.join('\n')}
</main>
<footer>本頁資料自動抓取自豐澤官方網站，僅供參考；實際營業時間以官方為準。抓取時間：${fetchedAt.toISOString()}</footer>
<script>
(function () {
  var storeNoSel = document.getElementById('filter-store-no');
  var regionSel = document.getElementById('filter-region');
  var catSel = document.getElementById('filter-category');
  var resetBtn = document.getElementById('filter-reset');
  var countEl = document.getElementById('filter-count');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.store-card'));
  var subgroups = Array.prototype.slice.call(document.querySelectorAll('.subgroup'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.category'));
  var totalStores = cards.length;

  function apply() {
    var vStore = storeNoSel.value;
    var vRegion = regionSel.value;
    var vCat = catSel.value;
    var shown = 0;
    cards.forEach(function (card) {
      var ok = (!vStore || card.getAttribute('data-store-no') === vStore) &&
               (!vRegion || card.getAttribute('data-region') === vRegion) &&
               (!vCat || card.getAttribute('data-category') === vCat);
      card.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    // 隱藏空的分區
    subgroups.forEach(function (g) {
      var any = Array.prototype.some.call(g.querySelectorAll('.store-card'), function (c) { return c.style.display !== 'none'; });
      g.style.display = any ? '' : 'none';
    });
    // 隱藏空的類別
    sections.forEach(function (s) {
      var any = Array.prototype.some.call(s.querySelectorAll('.store-card'), function (c) { return c.style.display !== 'none'; });
      s.style.display = any ? '' : 'none';
    });
    countEl.textContent = '顯示 ' + shown + ' / ' + totalStores + ' 間';
  }

  storeNoSel.addEventListener('change', apply);
  regionSel.addEventListener('change', apply);
  catSel.addEventListener('change', apply);
  resetBtn.addEventListener('click', function () {
    storeNoSel.value = ''; regionSel.value = ''; catSel.value = '';
    apply();
  });
})();
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log('已寫入:', OUT_HTML, `(${html.length} bytes, ${records.length} 間店舖)`);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

main().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
