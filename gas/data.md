# Firebase 開票結果資料儲存格式規格（中選會對接指南）

本文件定義寫入 Firestore 的開票結果 JSON 結構，供開票當天將中選會公開開票資料透過 [`gas/Code.gs`](./Code.gs) 轉換寫入 Firebase 使用。

---

## 1. Firestore 文件路徑

| 用途 | Firestore 路徑 | 說明 |
| :--- | :--- | :--- |
| **正式中選會開票（來源 A）** | `official_results/2026` | 正式開票使用，`isSimulated: false` |
| **GAS 模擬開票（來源 B）** | `official_results/2026_sim` | 測試模擬專用，`isSimulated: true`，與正式資料完全隔離 |

---

## 2. 頂層文件結構

```json
{
  "isSimulated": false,
  "source": "cec-official",
  "countingProgress": 65,
  "updatedAt": "2026-11-28T18:30:00.000Z",
  "cities": {
    "taipei": { "...": "縣市長選區格式" },
    "new-taipei": { "...": "縣市長選區格式" },
    "taichung": { "...": "縣市長選區格式" },
    "tainan": { "...": "縣市長選區格式" },
    "kaohsiung": { "...": "縣市長選區格式" },
    "hsinchu": { "...": "縣市長選區格式" },
    "taoyuan-c1": { "...": "桃園市議員第1選區特別題格式" }
  }
}
```

| 欄位 | 型別 | 必填 | 說明 |
| :--- | :--- | :---: | :--- |
| `isSimulated` | `boolean` | 是 | 正式開票填 `false`；模擬測試填 `true` |
| `source` | `string` | 是 | 資料來源識別（例：`"cec-official"` 或 `"gas-simulation"`） |
| `countingProgress` | `number` | 否 | 整體開票進度百分比（`0` ~ `100`），前端會顯示進度條 |
| `updatedAt` | `string` | 是 | ISO-8601 UTC 時間字串（`new Date().toISOString()`） |
| `cities` | `object` | 是 | 以選區 `cityId` 為 key 的各選區開票物件 |

---

## 3. 選區物件格式

### 3.1 縣市長選區（`taipei` / `new-taipei` / `taichung` / `tainan` / `kaohsiung` / `hsinchu`）

```json
{
  "totalVotes": 980000,
  "winnerId": "tpe-5",
  "winnerShare": 48.2,
  "winnerVotes": 472360,
  "candidates": [
    {
      "id": "tpe-5",
      "no": 5,
      "name": "5號 蔣萬安（國民黨）",
      "party": "中國國民黨",
      "votes": 472360,
      "share": 48.2
    },
    {
      "id": "tpe-3",
      "no": 3,
      "name": "3號 沈伯洋（民進黨）",
      "party": "民主進步黨",
      "votes": 421400,
      "share": 43.0
    }
  ]
}
```

- **必填核心欄位**：`candidates` 陣列，每筆包含 `id`、`no`（號次）、`name`、`party`、`votes`（整數票數）、`share`（得票率百分比，0–100）。
- **前端判定規則**：前端會將 `candidates` 依 `share` 由高到低排序（同率比 `votes`，再比 `no`），自動取第 1 名作為最高得票率候選人進行計分與摘要顯示；收闔展開後即可查看所有候選人票數與得票率。
- `winnerId` / `winnerShare` / `winnerVotes` / `totalVotes` 建議由 GAS 的 `buildCityResultPayload_()` 一併產出寫入，方便直接在 Firebase Console 檢視。

### 3.2 桃園市議員第1選區特別題（`taoyuan-c1`）

```json
{
  "seats": 12,
  "targetCandidateId": "tyc1-12",
  "totalVotes": 185000,
  "winnerId": "no",
  "targetRank": 14,
  "targetVotes": 4200,
  "targetShare": 2.27,
  "candidates": [
    {
      "id": "tyc1-4",
      "no": 4,
      "name": "4號 凌濤（國民黨）",
      "party": "中國國民黨",
      "votes": 18200,
      "share": 9.84
    },
    {
      "id": "tyc1-12",
      "no": 12,
      "name": "12號 王妃天崩開局穿越整頓霸凌者佀廣洋（無黨籍）",
      "party": "無黨籍",
      "votes": 4200,
      "share": 2.27
    }
  ]
}
```

- **當選判定規則**：將 `candidates` 全部 19 位候選人依 `share` 由高到低排序（同率比 `votes`，再比 `no`）。若 12 號王妃（`id: "tyc1-12"` / `no: 12`）排在 **前 `seats`（12）名內**，即判定為 `winnerId: "yes"`（會當選），否則為 `"no"`（不會當選）。
- **前端顯示**：
  - 未展開時顯示「會當選／不會當選」以及王妃當前名次、得票率與票數。
  - 展開後依得票率由高到低列出全部 19 位候選人排名，並於第 12 名與第 13 名之間標示當選門檻線，同時高亮 12 號王妃。

---

## 4. 選區與候選人 ID 對照表

### 台北市市長（`taipei`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `tpe-1` | 1 | 郭璽 | 台灣麻將最大黨 |
| `tpe-2` | 2 | 林志成 | 無黨籍 |
| `tpe-3` | 3 | 沈伯洋 | 民主進步黨 |
| `tpe-4` | 4 | 蕭文乾 | 臺灣SoR無法黨 |
| `tpe-5` | 5 | 蔣萬安 | 中國國民黨 |
| `tpe-6` | 6 | 唐新民 | 三勢團結促進聯盟 |

### 新北市市長（`new-taipei`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `ntp-1` | 1 | 蘇巧慧 | 民主進步黨 |
| `ntp-2` | 2 | 蘇輝湟 | 無黨籍 |
| `ntp-3` | 3 | 李四川 | 中國國民黨 |

### 台中市市長（`taichung`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `txg-1` | 1 | 何欣純 | 民主進步黨 |
| `txg-2` | 2 | 洪麗華 | 司法正義黨 |
| `txg-3` | 3 | 江啟臣 | 中國國民黨 |

### 台南市市長（`tainan`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `tnn-1` | 1 | 蕭燐洪 | 臺灣SoR無法黨 |
| `tnn-2` | 2 | 謝龍介 | 中國國民黨 |
| `tnn-3` | 3 | 陳亭妃 | 民主進步黨 |
| `tnn-4` | 4 | 葉人文 | 無黨籍 |

### 高雄市市長（`kaohsiung`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `khh-1` | 1 | 張靜 | 司法改革黨 |
| `khh-2` | 2 | 王肇民 | 無黨籍 |
| `khh-3` | 3 | 柯志恩 | 中國國民黨 |
| `khh-4` | 4 | 洪方隆 | 無黨籍 |
| `khh-5` | 5 | 賴瑞隆 | 民主進步黨 |

### 新竹市市長（`hsinchu`）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `hsz-1` | 1 | 高虹安 | 無黨籍 |
| `hsz-2` | 2 | 何志勇 | 無黨籍 |
| `hsz-3` | 3 | 莊競程 | 民主進步黨 |

### 桃園市議員第1選區（`taoyuan-c1`，應選 12 席）
| `id` | `no` | 候選人 | 政黨 |
| :--- | :---: | :--- | :--- |
| `tyc1-1` | 1 | 徐千晴 | 台灣民眾黨 |
| `tyc1-2` | 2 | 余信憲 | 民主進步黨 |
| `tyc1-3` | 3 | 張碩芳 | 中國國民黨 |
| `tyc1-4` | 4 | 凌濤 | 中國國民黨 |
| `tyc1-5` | 5 | 陳美梅 | 中國國民黨 |
| `tyc1-6` | 6 | 林政賢 | 中國國民黨 |
| `tyc1-7` | 7 | 黃瓊慧 | 民主進步黨 |
| `tyc1-8` | 8 | 沈佩玲 | 小民參政歐巴桑聯盟 |
| `tyc1-9` | 9 | 于北辰 | 無黨籍 |
| `tyc1-10` | 10 | 黃家齊 | 民主進步黨 |
| `tyc1-11` | 11 | 詹江村 | 中國國民黨 |
| **`tyc1-12`** | **12** | **王妃天崩開局穿越整頓霸凌者佀廣洋（特別題目標）** | **無黨籍** |
| `tyc1-13` | 13 | 李凱倫 | 無黨籍 |
| `tyc1-14` | 14 | 佀廣洋 | 無黨籍 |
| `tyc1-15` | 15 | 李光達 | 民主進步黨 |
| `tyc1-16` | 16 | 李柏瑟 | 民主進步黨 |
| `tyc1-17` | 17 | 黃婉如 | 中國國民黨 |
| `tyc1-18` | 18 | 朱永煇 | 無黨籍 |
| `tyc1-19` | 19 | 許孟祥 | 勞動黨 |

---

## 5. 開票當天與中選會資料對接步驟

1. 在 [`gas/Code.gs`](./Code.gs) 將 `CONFIG.MODE` 改為 `"official"`，並將中選會公開 JSON 端點填入 `CONFIG.CEC_JSON_URL`。
2. 在 `fetchCecOfficialResults_()` 中解析中選會 JSON，依「號次 (`no`)」或「候選人姓名」對應成 `inputMap`：
   - **僅傳票數**：`{ "tpe-5": 472360, "tpe-3": 421400, ... }`
   - **連同中選會官方得票率／當選註記一併傳入（選填）**：`{ "tyc1-12": { votes: 9800, share: 5.12, elected: true }, ... }`（可完美對應婦女保障名額等中選會最終當選註記）
3. 呼叫內建的 `buildCityResultPayload_(cityId, inputMap, { validVotes })`，即會自動完成：
   - **0 票防呆**：若該選區目前全體票數與得票率皆為 `0`，自動設 `winnerId: null`，前端維持顯示「尚未開票」（不會誤判 1 號或王妃當選）
   - 計算各選區 `totalVotes` 與每位候選人的 `share`（避免二次四捨五入誤差）
   - 依得票率由高到低排序 `candidates`
   - 推算縣市長 `winnerId` / `winnerShare` / `winnerVotes`
   - 推算桃園第1選區王妃名次 `targetRank` 與 `winnerId ("yes" | "no")`（若有傳入官方 `elected` 布林值則優先採用）
4. 回傳 `{ isSimulated: false, source: "cec-official", countingProgress, updatedAt, cities }`，由 `runLiveUpdate()`（內建 `LockService` 防重疊鎖與 `CacheService` 50 分鐘 Token 快取）自動寫入 `official_results/2026`。
