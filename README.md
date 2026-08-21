# 豐澤 Fortress 分店一覽（每日自動更新）

此專案自動抓取 [豐澤官方網站店舖位置頁](https://www.fortress.com.hk/zh-hk/store-locator) 的分店資料（店名、地址、營業時間），按分區整理成靜態 HTML，並透過 GitHub Actions 每日自動更新、部署至 GitHub Pages。

## 線上查閱

- GitHub Pages 網址部署後顯示於本 repo 的 Settings → Pages。
- 一般格式：`https://<username>.github.io/fortress-store-list/`

## 本地執行

```bash
node build-fortress-html.js .   # 抓取官方 API 並生成 index.html + fortress-stores.json
```

## 每日自動更新

`.github/workflows/update-and-deploy.yml` 設定每日 UTC 00:00（香港時間 08:00）自動執行：
1. 抓取官方 API
2. 重新生成 `index.html` 與 `fortress-stores.json`
3. 若有變更則 commit + push
4. 部署至 GitHub Pages

也可在 Actions 頁面手動觸發（workflow_dispatch）。

## 資料來源

- API: `https://api.fortress.com.hk/api/v2/ftrhk/stores/watStores`
- 官方店舖位置頁: `https://www.fortress.com.hk/zh-hk/store-locator`

## 注意

- 資料僅供參考，實際營業時間以豐澤官方為準。
- 本專案與豐澤 / Fortress / 屈臣氏集團無任何關聯，僅為公開資料的自動整理。
