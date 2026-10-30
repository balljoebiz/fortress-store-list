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

/** 清理營業時間: 只取 ^zt^ 之後的主店營業時間, 去掉 3HK 店中店/電話號碼/店號等段落 */
function parseHours(raw) {
  if (!raw) return '資料從缺';
  let s = String(raw);
  s = s.replace(/^\^zt\^/, '');          // strip leading ^zt^
  const segments = s.split('^').filter(Boolean);
  if (segments.length === 0) return '資料從缺';
  // 主營業時間 = 第一個 segment; 後續段落（3HK 店中店、電話、店號）一律捨棄
  let main = segments[0].trim();
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
  console.log(`共 ${stores.length} 間店舖（官方現況）`);

  const liveRecords = stores.map((s) => {
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

  // 店鋪分類: Fortress店 / Techlife店 / Techlife店中店 / MI店
  const CATEGORIES = [
    { val: 'fortress', title: 'Fortress店' },
    { val: 'techlife', title: 'Techlife店' },
    { val: 'techlife-instore', title: 'Techlife店中店' },
    { val: 'mi', title: 'MI店' },
  ];
  function classifyStore(name, storeNo) {
    // 店號尾數為 1 者屬 Techlife 家族：
    //   名稱含「店中店」→ Techlife店中店；否則 → Techlife店（含未標示者如 4191、4621）
    if (/1$/.test(String(storeNo || ''))) {
      return /店中店/.test(name) ? 'techlife-instore' : 'techlife';
    }
    if (/小米|\bMI\b/i.test(name)) return 'mi';
    return 'fortress';
  }
  const catOrder = CATEGORIES.map(c => c.val);

  // ── 歷史追蹤：合併「官方現況」與 store-history.json ──────────────────
  const HISTORY_PATH = path.join(OUT_DIR, 'store-history.json');
  let history = { updatedAt: null, stores: {} };
  if (fs.existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch (e) { console.warn('歷史檔讀取失敗，改用空白歷史:', e.message); }
  }
  if (!history.stores) history.stores = {};
  const now = new Date();
  const nowIso = now.toISOString();

  const merged = new Map();
  // 1) 官方現況（在架）
  for (const r of liveRecords) {
    const prev = history.stores[r.storeNo] || {};
    merged.set(r.storeNo, {
      ...r,
      firstSeen: prev.firstSeen || nowIso,
      lastSeen: nowIso,
      removedAt: null,
      state: 'active',
    });
  }
  // 2) 歷史中已消失的店（保留 30 天，之後只留於頁底已閉店）
  for (const [no, h] of Object.entries(history.stores)) {
    if (merged.has(no)) continue;
    const removedAt = h.removedAt || nowIso;   // 首次發現消失即定案，不再重設
    const removedDays = Math.floor((now - new Date(removedAt)) / 86400000);
    merged.set(no, {
      ...h,
      category: h.category || classifyStore(h.name || '', no),
      removedAt,
      removedDays,
      state: removedDays > 30 ? 'closed' : 'removed',
    });
  }

  const records = [...merged.values()];
  for (const r of records) {
    // 在架店在 liveRecords 階段尚無 category，這裡統一補上
    if (!r.category) r.category = classifyStore(r.name, r.storeNo);
    r.isTechLife = r.category === 'techlife' || r.category === 'techlife-instore';
    if (r.state === 'removed') {
      r.removedDays = Math.floor((now - new Date(r.removedAt)) / 86400000);
    }
  }
  const activeCount = records.filter(r => r.state === 'active').length;
  const removedCount = records.filter(r => r.state === 'removed').length;
  const closedCount = records.filter(r => r.state === 'closed').length;
  console.log(`在架 ${activeCount}｜已移除≤30天 ${removedCount}｜已閉店 ${closedCount}`);

  // 地區排序依據：所屬大區地理順序（僅排序用，不顯示）→ 店數多寡 → 地區名
  const regionOrder = ['香港島', '九龍', '新界', '澳門'];
  const districtMeta = new Map();
  for (const r of records) {
    const meta = districtMeta.get(r.district) || { region: r.region, count: 0 };
    meta.count++;
    districtMeta.set(r.district, meta);
  }
  const districtCompare = (a, b) => {
    const ma = districtMeta.get(a), mb = districtMeta.get(b);
    if (!ma || !mb) return a.localeCompare(b, 'zh-HK');
    const ra = regionOrder.indexOf(ma.region), rb = regionOrder.indexOf(mb.region);
    if (ra !== rb) return ra - rb;
    if (ma.count !== mb.count) return mb.count - ma.count;
    return a.localeCompare(b, 'zh-HK');
  };

  // 排序: 店鋪分類 → 具體地區 → 店名（已閉店另排）
  records.sort((a, b) => {
    const ca = catOrder.indexOf(a.category), cb = catOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    const dc = districtCompare(a.district, b.district);
    if (dc) return dc;
    return a.name.localeCompare(b.name, 'zh-HK');
  });

  // 分組: category -> district -> [records]（只含在架 + 已移除≤30天）
  const groups = new Map();
  for (const r of records) {
    if (r.state === 'closed') continue;   // 已閉店只留頁底
    if (!groups.has(r.category)) groups.set(r.category, new Map());
    const rm = groups.get(r.category);
    if (!rm.has(r.district)) rm.set(r.district, []);
    rm.get(r.district).push(r);
  }
  // 已閉店：依移除日期新→舊
  const closedStores = records
    .filter(r => r.state === 'closed')
    .sort((a, b) => String(b.removedAt).localeCompare(String(a.removedAt)));

  // 寫 JSON (供更新/除錯)
  fs.writeFileSync(OUT_JSON, JSON.stringify({ fetchedAt: nowIso, count: stores.length, activeCount, removedCount, closedCount, stores: records }, null, 2), 'utf8');

  // 產生 HTML
  const fetchedAt = now;
  const dateStr = fetchedAt.toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' });
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Hong_Kong' });
  };

  const categoryBlocks = [];
  for (const cat of CATEGORIES) {
    const rm = groups.get(cat.val);
    if (!rm || rm.size === 0) continue;
    const isTech = cat.val === 'techlife' || cat.val === 'techlife-instore';
    const card = (r) => {
      const mapLink = r.geo ? `https://www.google.com/maps?q=${r.geo.lat},${r.geo.lng}` : '#';
      // 店號顯示在店名前: "2010 - 中環分店"
      const displayName = r.storeNo ? `${r.storeNo} - ${r.name}` : r.name;
      const isRemoved = r.state === 'removed';
      const badge = isRemoved
        ? `<span class="badge-removed">原網頁已移除</span>`
        : '';
      const removedNote = isRemoved
        ? `<div class="removed-note">最後於官方出現：${fmtDate(r.lastSeen)}・${fmtDate(r.removedAt)} 起已移除</div>`
        : '';
      return `<div class="store-card${isTech ? ' techlife' : ''}${cat.val === 'mi' ? ' mi' : ''}${isRemoved ? ' is-removed' : ''}" id="store-${esc(r.storeNo)}" data-store-no="${esc(r.storeNo)}" data-district="${esc(r.district)}" data-region="${esc(r.region)}" data-category="${cat.val}" data-state="${r.state}">
  <div class="store-head"><span class="store-name">${esc(displayName)}</span>${badge}</div>
  <div class="store-addr">${esc(r.address)}</div>
  <div class="store-hours">${esc(r.hours)}</div>
${removedNote}  <div class="store-links"><a href="${mapLink}" target="_blank" rel="noopener">查看地圖</a>${r.url ? `<a href="https://www.fortress.com.hk${r.url}" target="_blank" rel="noopener">官方頁面</a>` : ''}</div>
</div>`;
    };
    // 主版不分區：該分類所有店依地區順序直接列出（地區資訊只在左側欄顯示）
    const all = [];
    for (const [, list] of rm) all.push(...list);
    const removedInCat = all.filter(r => r.state === 'removed').length;
    const cntLabel = removedInCat ? `${all.length}（含 ${removedInCat} 已移除）` : `${all.length}`;
    categoryBlocks.push(`<section class="category cat-${cat.val}" data-category-section="${cat.val}"><h2>${esc(cat.title)} <span class="count">${cntLabel}</span></h2><div class="stores">${all.map(card).join('\n')}</div></section>`);
  }

  // 已閉店區塊（頁底，永久保留）
  const closedCard = (r) => {
    const displayName = r.storeNo ? `${r.storeNo} - ${r.name}` : r.name;
    return `<div class="store-card is-closed" id="store-${esc(r.storeNo)}" data-store-no="${esc(r.storeNo)}" data-state="closed">
  <div class="store-head"><span class="store-name">${esc(displayName)}</span><span class="badge-closed">已閉店</span></div>
  <div class="store-addr">${esc(r.address)}</div>
  <div class="store-hours">${esc(r.hours)}</div>
  <div class="removed-note">最後於官方出現：${fmtDate(r.lastSeen)}・${fmtDate(r.removedAt)} 起已移除</div>
</div>`;
  };
  const closedBlock = closedStores.length
    ? `<section class="category cat-closed" data-category-section="closed"><h2>已閉店 <span class="count">${closedStores.length}</span></h2><div class="stores">${closedStores.map(closedCard).join('\n')}</div></section>`
    : '';

  // 左側店號索引：按店鋪分類分組，組內按店號數字排序（已閉店不收錄）
  const sidebarBlocks = CATEGORIES.map(cat => {
    const list = records
      .filter(r => r.category === cat.val && r.storeNo && r.state !== 'closed')
      .sort((a, b) => Number(a.storeNo) - Number(b.storeNo));
    if (!list.length) return '';
    const items = list.map(r =>
      `        <a class="side-item${r.state === 'removed' ? ' is-removed' : ''}" href="#store-${esc(r.storeNo)}" data-store-no="${esc(r.storeNo)}" title="${esc(r.storeNo)} - ${esc(r.name)}｜${esc(r.district)}${r.state === 'removed' ? '（原網頁已移除）' : ''}"><span class="side-no">${esc(r.storeNo)}</span><span class="side-name">${esc(r.name)}</span><span class="side-district">${esc(r.district)}</span></a>`
    ).join('\n');
    return `      <div class="side-group" data-side-cat="${cat.val}">
        <div class="side-group-title">${esc(cat.title)} <span class="count">${list.length}</span></div>
${items}
      </div>`;
  }).filter(Boolean).join('\n');

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
html { scroll-padding-top:100px; scroll-behavior:smooth; }
body { font-family:"Segoe UI", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; padding:1rem; }
header { max-width:1400px; margin:0 auto 1rem; }
h1 { font-size:1.6rem; color:var(--primary); }
.sub { color:var(--muted); font-size:.85rem; margin-top:.25rem; }
/* ── 版面：左側店號索引 + 右側內容 ── */
.layout { display:flex; gap:1.2rem; max-width:1400px; margin:0 auto; align-items:flex-start; }
.sidebar { position:sticky; top:88px; flex:0 0 252px; width:252px; max-height:calc(100vh - 110px); overflow-y:auto; border:1px solid var(--border); border-radius:.5rem; background:var(--card); }
.sidebar-head { position:sticky; top:0; z-index:1; font-weight:700; font-size:.9rem; padding:.55rem .7rem; border-bottom:1px solid var(--border); background:var(--card); }
.sidebar-nav { padding:.25rem .3rem .45rem; }
.side-group-title { font-size:.73rem; font-weight:700; color:var(--primary); padding:.5rem .5rem .22rem; }
.side-item { display:flex; gap:.38rem; align-items:baseline; padding:.2rem .5rem; text-decoration:none; color:var(--fg); font-size:.78rem; border-radius:.25rem; }
.side-item:hover, .side-item:focus { background:rgba(246,144,35,.14); }
.side-item.is-removed { opacity:.55; }
.side-item.is-removed .side-no { color:var(--muted); }
.side-no { flex:0 0 auto; font-weight:700; font-variant-numeric:tabular-nums; color:var(--primary); }
.side-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.side-district { flex:0 0 auto; color:var(--muted); font-size:.69rem; }
main { flex:1 1 auto; min-width:0; }
.category { margin-bottom:2.5rem; }
.category h2 { font-size:1.35rem; border-bottom:2px solid var(--primary); padding-bottom:.35rem; margin-bottom:.75rem; }
/* Techlife 店 + Techlife 店中店 歸同一類目（相同色系與標示） */
.category.cat-techlife h2,
.category.cat-techlife-instore h2 { color:var(--primary); }
.category.cat-techlife h2::after,
.category.cat-techlife-instore h2::after { content:"Techlife 類目"; font-size:.68rem; font-weight:700; background:var(--primary); color:#fff; padding:.12rem .45rem; border-radius:.25rem; margin-left:.5rem; vertical-align:middle; }
/* MI 店（小米系列）獨立色系 */
.category.cat-mi h2 { color:#ff6a00; border-bottom-color:#ff6a00; }
.category.cat-mi h2::after { content:"小米系列"; font-size:.68rem; font-weight:700; background:#ff6a00; color:#fff; padding:.12rem .45rem; border-radius:.25rem; margin-left:.5rem; vertical-align:middle; }
.count { color:var(--muted); font-weight:400; font-size:.9rem; }
.stores { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:.75rem; }
.store-card { background:var(--card); border:1px solid var(--border); border-radius:.5rem; padding:.8rem .9rem; display:flex; flex-direction:column; gap:.3rem; scroll-margin-top:100px; }
.store-card:target { outline:2px solid var(--primary); outline-offset:2px; }
.store-card.techlife { border-color:var(--primary); }
.store-card.mi { border-color:#ff6a00; }
.store-head { display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; flex-wrap:wrap; }
.store-name { font-weight:600; }
/* 已移除（≤30 天）：紅色虛線框 + 徽章 */
.store-card.is-removed { border:1px dashed #d9463f; background:repeating-linear-gradient(135deg, transparent, transparent 10px, rgba(217,70,63,.035) 10px, rgba(217,70,63,.035) 20px); }
.badge-removed { font-size:.66rem; font-weight:700; color:#fff; background:#d9463f; padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.removed-note { font-size:.72rem; color:#d9463f; }
/* 已閉店（>30 天）：灰階、頁底 */
.category.cat-closed { border-top:2px solid var(--border); padding-top:1.2rem; margin-top:2rem; }
.category.cat-closed h2 { color:var(--muted); border-bottom-color:var(--border); }
.store-card.is-closed { opacity:.62; filter:grayscale(1); }
.badge-closed { font-size:.66rem; font-weight:700; color:#fff; background:var(--muted); padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.store-addr { color:var(--muted); font-size:.88rem; }
.store-hours { font-size:.88rem; }
.store-links a { color:var(--primary); font-size:.82rem; margin-right:.8rem; }
footer { max-width:1400px; margin:2rem auto 0; color:var(--muted); font-size:.8rem; border-top:1px solid var(--border); padding-top:.75rem; }
@media (max-width:900px) {
  .layout { flex-direction:column; }
  .sidebar { position:static; flex:0 0 auto; width:100%; max-height:260px; }
  .sidebar-head { position:static; }
}
@media (max-width:640px) { .stores { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <h1>豐澤 Fortress 分店一覽</h1>
  <div class="sub">資料來源：Fortress 官方網站店舖位置頁（每日自動更新）・最後更新：${dateStr}・在架 ${activeCount} 間${removedCount ? `・已移除（30 天內）${removedCount} 間` : ''}${closedCount ? `・已閉店 ${closedCount} 間` : ''}</div>
</header>
<div class="layout">
  <aside class="sidebar" aria-label="店號索引">
    <div class="sidebar-head">店號索引</div>
    <nav class="sidebar-nav">
${sidebarBlocks}
    </nav>
  </aside>
  <main>
${categoryBlocks.join('\n')}
${closedBlock}
  </main>
</div>
<footer>本頁資料自動抓取自豐澤官方網站，僅供參考；實際營業時間以官方為準。抓取時間：${fetchedAt.toISOString()}</footer>
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log('已寫入:', OUT_HTML, `(${html.length} bytes, 在架 ${activeCount}｜已移除 ${removedCount}｜已閉店 ${closedCount})`);

  // 寫回歷史檔（供下次比對；已閉店永久保留）
  const historyOut = {
    updatedAt: nowIso,
    note: '店舖歷史追蹤：記錄每間店最後出現於官方 API 的時間，以及首次發現消失的時間（removedAt）。由 build-fortress-html.js 自動維護。',
    stores: {},
  };
  for (const r of records) {
    historyOut.stores[r.storeNo] = {
      storeNo: r.storeNo,
      name: r.name,
      region: r.region,
      district: r.district,
      town: r.town || '',
      address: r.address,
      hours: r.hours,
      geo: r.geo,
      url: r.url,
      category: r.category,
      firstSeen: r.firstSeen || nowIso,
      lastSeen: r.lastSeen || nowIso,
      removedAt: r.removedAt || null,
    };
  }
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(historyOut, null, 2), 'utf8');
  console.log('已更新歷史檔:', HISTORY_PATH, `(${Object.keys(historyOut.stores).length} 筆)`);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

main().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
