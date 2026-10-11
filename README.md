# 習慣草地

有做就打勾，草越綠點數越多，點數換你自己設計的獎勵券。

純靜態網頁（PWA），資料只存在手機的瀏覽器裡，不需要後端。

- 最多 5 個習慣，每個習慣可以「分等級」或「有做就打勾」，點數自訂
- 總覽草地 + 每個習慣各自的小草地
- 所有習慣共用一個點數錢包，兌換自己設計的獎勵券（可設定張數）
- 忘記打卡可以補登最近 3 天
- 匯出 / 匯入 JSON 備份

## 本機開發

```bash
python3 -m http.server 8123
```

打開 http://localhost:8123

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 頁面結構 |
| `styles.css` | 樣式（淺色 / 深色主題） |
| `app.js` | 所有邏輯與 localStorage 儲存 |
| `sw.js` | Service worker，離線也能打開 |
| `manifest.webmanifest`、`icons/` | 加到主畫面用的設定與圖示 |

## 部署到 GitHub Pages

Repo 的 Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`。
網址會是 `https://matchawu.github.io/habit-grass/`。

## 每天提醒（不用寫推播）

iPhone「捷徑」App → 自動化 → 新增個人自動化 → 特定時間（例如 21:00）→ 動作選「打開 URL」，填上網址。
