# Google Apps Script 即時開票模擬器設定說明

此腳本用於在後端定時（每 1 分鐘）模擬中選會開票進度並寫入 Firestore。
- **測試模擬模式 (`MODE = "simulation"`)**：寫入 `official_results/2026_sim`，並標記 `isSimulated: true`，**不會影響正式開票文件 `official_results/2026`**。
- **正式開票模式 (`MODE = "official"`)**：寫入 `official_results/2026`。

---

## 設定步驟

### 1. 取得 Firebase Service Account 金鑰
1. 前往 [Firebase Console](https://console.firebase.google.com/) → 專案 `election2026-97e12` → 左上角齒輪「專案設定」→「服務帳戶」。
2. 點選「產生新的私密金鑰」，下載 JSON 檔案（**請勿上傳到 GitHub**）。
3. 打開 JSON 檔案，記下 `client_email` 與 `private_key` 兩個欄位的值。

### 2. 建立 Google Apps Script
1. 前往 [script.google.com](https://script.google.com/) → 新增專案。
2. 將 [Code.gs](./Code.gs) 的內容完整貼上並儲存。
3. 點選左側齒輪「專案設定」→ 捲到最下方「指令碼屬性」→ 新增兩筆屬性：
   - `FIREBASE_CLIENT_EMAIL`：填入 JSON 中的 `client_email`
   - `FIREBASE_PRIVATE_KEY`：填入 JSON 中的 `private_key`（可直接貼含 `\n` 的字串）

### 3. 測試寫入與開啟每分鐘排程
1. 回到編輯器上方函式下拉選單，選擇 `runLiveUpdate` → 點「執行」（第一次會跳出 Google 授權視窗，允許即可）。
2. 到 Firebase Console 的 Firestore 確認 `official_results/2026_sim` 已出現，且 `isSimulated: true`。
3. 執行 `setupTriggerEveryMinute` 函式，即可自動每 1 分鐘更新一次模擬數據。
4. 在網站管理員介面（`?admin=1`）建立一場「**測試賽局：GAS 即時開票模擬**」，即可在排行榜即時看到每分鐘跳動的測試排名與進度百分比。
5. **測試完成後**，記得在 GAS 執行 `removeAllTriggers` 關閉排程。
