# 2026 九合一選舉預測大賽

一個可部署於 **GitHub Pages**、支援 **Firebase Firestore** 即時同步（並內建免設定本機試玩模式）的互動式選舉預測遊戲。

## 功能特色

1. **我要預測**：輸入暱稱，預測各直轄市當選人與候選人得票率（支援滑桿與數字輸入，附一鍵自動配平 100%）。
2. **開票結果輸入（試玩 / 當天結算）**：
   - 目前可手動輸入或一鍵「隨機模擬開票」來試玩計分。
   - 選舉當天只需更新實際開票結果（支援部分縣市先開票），所有玩家成績會即時結算。
3. **即時排行榜與誤差分析**：
   - **計分公式**（每縣市滿分 100 分）：
     - 猜中當選人：`+40 分`
     - 得票率精準度：`max(0, 60 - 各候選人誤差總和 × 1.5)`
   - 誤差越小、分數越高；同分時以總誤差較小者勝出。
   - 可點擊「查看明細」逐一對比每位候選人的預測與實際差距。

## 本機試玩方式

因使用原生 ES Modules (`type="module"`)，請透過本機靜態伺服器開啟（不要直接雙擊 HTML）：

```bash
python3 -m http.server 8080
```

接著打開瀏覽器前往 `http://localhost:8080`，預設即為**本機試玩模式 (LocalStorage)**，可直接測試預測、模擬開票與排行榜！

## 串接 Firebase Firestore（多人連線）

1. 前往 [Firebase Console](https://console.firebase.google.com/) 建立新專案。
2. 左側選單開啟 **Build -> Firestore Database**，建立資料庫（可先選測試模式，或參考下方安全規則）。
3. 在專案設定中新增 **網頁應用程式 (Web)**，複製 `firebaseConfig`。
4. 打開 [firebase-config.js](./firebase-config.js)，將 `firebaseConfig` 貼上存檔即可自動切換為雲端連線。

### Firestore 安全規則參考（選前開放預測、開票結果由管理員控管）

若要避免一般玩家隨意修改開票結果，正式上線時可在 Firestore Rules 設定只允許特定條件寫入 `actual_results`，或於開票前先在 Rules 中鎖定 `predictions` 寫入時間。

## 自訂候選人名單

打開 [data.js](./data.js)，編輯 `CONSTITUENCIES` 陣列即可修改縣市、候選人姓名、政黨與代表色。

## 部署到 GitHub Pages

1. 將此專案推送到 GitHub Repository。
2. 到 Repository 的 **Settings -> Pages**。
3. Source 選擇 `Deploy from a branch`，Branch 選擇 `main` / `/ (root)` 並儲存。
4. 數分鐘後即可透過 `https://<你的帳號>.github.io/<repo名稱>/` 分享給朋友一起玩！
