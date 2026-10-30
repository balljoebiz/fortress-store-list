# 豐澤 Fortress 分店一覽（每日自動更新）

此專案自動抓取 [豐澤官方網站店舖位置頁](https://www.fortress.com.hk/zh-hk/store-locator) 的分店資料（店名、地址、營業時間），整理成靜態 HTML，並透過 GitHub Actions 每日自動更新、部署至 GitHub Pages。

## 線上查閱

**https://balljoebiz.github.io/fortress-store-list/**

## 頁面特色

- **左側店號索引**（sticky）：按店鋪分類分組，點擊跳轉至該店卡片
- **店鋪分類**：Fortress店 / Techlife店 / Techlife店中店 / MI店
  - 分類依店號尾數判定：尾數 1 者屬 Techlife 家族（名稱含「店中店」→ Techlife店中店，否則 → Techlife店）
- **店號顯示**於店名之前（例如 `2010 - 中環分店`）
- **已移除店鋪標示**：詳見下方「店鋪生命週期」

## 店鋪生命週期（30 天保留機制）

以官方 API 是否仍回傳該店為判定依據，追蹤資料存於 `store-history.json`：

| 狀態 | 判定 | 顯示方式 |
|---|---|---|
| **在架** | 官方 API 有回傳 | 正常顯示於分類區塊 |
| **已移除（≤30 天）** | 從官方消失 ≤30 天 | 仍留在原分類區塊，卡片加紅色虛線框與 **「原網頁已移除」** 徽章，並顯示最後出現與移除日期；左側欄灰階顯示 |
| **已閉店（>30 天）** | 從官方消失超過 30 天 | 移至頁底 **「已閉店」** 區塊（灰階），**不列入左側欄**，永久保留 |

- 「30 天」自**首次發現該店從官方 API 消失**當天起算
- `removedAt` 只設定一次，之後每日沿用，不會因每日更新而重設計時

## 本地執行

```bash
node build-fortress-html.js .   # 抓取官方 API → index.html + fortress-stores.json + store-history.json
```

## 每日自動更新

`.github/workflows/update-and-deploy.yml` 設定每日 **香港時間 13:31**（UTC 05:31）自動執行：

1. 抓取官方 API
2. 比對 `store-history.json`，更新在架狀態與移除日期
3. 重新生成 `index.html`、`fortress-stores.json`、`store-history.json`
4. 有變更則 commit + push（Pages 自動重新部署）

也可在 Actions 頁面手動觸發（workflow_dispatch）。

## 資料來源

- API: `https://api.fortress.com.hk/api/v2/ftrhk/stores/watStores`
- 官方店舖位置頁: `https://www.fortress.com.hk/zh-hk/store-locator`

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | 生成的分店頁面（部署至 Pages） |
| `fortress-stores.json` | 最近一次產出的完整資料（含狀態） |
| `store-history.json` | 店鋪歷史追蹤（lastSeen / removedAt），**每日更新必保留** |
| `build-fortress-html.js` | 抓取與生成腳本 |
| `.github/workflows/update-and-deploy.yml` | 每日更新排程 |

## 注意

- 資料僅供參考，實際營業時間以豐澤官方為準。
- 本專案與豐澤 / Fortress / 屈臣氏集團無任何關聯，僅為公開資料的自動整理。
