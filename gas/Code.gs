/**
 * 2026 九合一選舉預測大賽｜Google Apps Script 即時開票更新器
 *
 * - 測試模擬模式 (MODE = "simulation")：
 *   寫入 Firestore `official_results/2026_sim`，並標註 `isSimulated: true`，
 *   與正式開票文件 `official_results/2026` 完全隔離。
 * - 正式開票模式 (MODE = "official")：
 *   從中選會公開 JSON 端點抓取實際開票結果，寫入 `official_results/2026`。
 */

const CONFIG = {
  PROJECT_ID: "election2026-97e12",
  MODE: "simulation", // "simulation"（測試模擬）| "official"（正式開票）
  SIM_DOC_PATH: "official_results/2026_sim",
  OFFICIAL_DOC_PATH: "official_results/2026",
  CEC_JSON_URL: "" // 選前/當天取得中選會即時開票 JSON 網址後填入
};

// 與前端 data.js CONSTITUENCIES 對應的候選人清單（供模擬器與中選會對照使用）
const SIM_CANDIDATES = {
  taipei: ["tpe-1", "tpe-2", "tpe-3", "tpe-4", "tpe-5", "tpe-6"],
  "new-taipei": ["ntp-1", "ntp-2", "ntp-3"],
  taichung: ["txg-1", "txg-2", "txg-3"],
  tainan: ["tnn-1", "tnn-2", "tnn-3", "tnn-4"],
  kaohsiung: ["khh-1", "khh-2", "khh-3", "khh-4", "khh-5"],
  "taoyuan-c1": ["yes", "no"]
};

/**
 * 主排程函式：建議設定為每 1 分鐘（測試）或每 5 分鐘（正式）執行一次
 */
function runLiveUpdate() {
  if (CONFIG.MODE === "simulation") {
    const payload = buildSimulatedPayload_();
    writeFirestoreDocument_(CONFIG.SIM_DOC_PATH, payload);
    Logger.log(
      "[SIMULATION] Updated %s | progress=%s%% | cities=%s",
      CONFIG.SIM_DOC_PATH,
      payload.countingProgress,
      JSON.stringify(payload.cities)
    );
    return;
  }

  if (!CONFIG.CEC_JSON_URL) {
    throw new Error("正式模式請先在 CONFIG.CEC_JSON_URL 填入中選會資料來源網址。");
  }
  const payload = fetchCecOfficialResults_();
  writeFirestoreDocument_(CONFIG.OFFICIAL_DOC_PATH, payload);
  Logger.log("[OFFICIAL] Updated %s", CONFIG.OFFICIAL_DOC_PATH);
}

/**
 * 一鍵建立「每 1 分鐘」自動執行觸發器
 */
function setupTriggerEveryMinute() {
  removeAllTriggers();
  ScriptApp.newTrigger("runLiveUpdate")
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log("已建立每 1 分鐘執行一次 runLiveUpdate 的觸發器。");
}

/**
 * 一鍵移除所有排程觸發器（測試結束後務必執行）
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => ScriptApp.deleteTrigger(t));
  Logger.log("已移除 %s 個觸發器。", triggers.length);
}

/**
 * 重設模擬開票進度為 0%
 */
function resetSimulation() {
  PropertiesService.getScriptProperties().deleteProperty("SIM_PROGRESS");
  Logger.log("已重設模擬開票進度。");
}

/**
 * 產生模擬開票數據（每次執行進度 +5%，到 100% 後重新從 5% 循環以便持續測試）
 */
function buildSimulatedPayload_() {
  const props = PropertiesService.getScriptProperties();
  const prev = Number(props.getProperty("SIM_PROGRESS") || "0");
  const nextProgress = prev >= 100 ? 5 : prev + 5;
  props.setProperty("SIM_PROGRESS", String(nextProgress));

  const cities = {};

  // 五都市長：模擬開票中領先者與得票率隨進度微幅變動
  const mayorWeights = {
    taipei: [
      { id: "tpe-5", base: 48 },
      { id: "tpe-3", base: 44 }
    ],
    "new-taipei": [
      { id: "ntp-3", base: 47 },
      { id: "ntp-1", base: 46 }
    ],
    taichung: [
      { id: "txg-3", base: 51 },
      { id: "txg-1", base: 43 }
    ],
    tainan: [
      { id: "tnn-3", base: 53 },
      { id: "tnn-2", base: 41 }
    ],
    kaohsiung: [
      { id: "khh-5", base: 49 },
      { id: "khh-3", base: 45 }
    ]
  };

  Object.keys(mayorWeights).forEach((cityId) => {
    const contenders = mayorWeights[cityId];
    // 加入 ±4% 隨機波動，模擬開票過程中名次拉鋸
    const scored = contenders.map((c) => ({
      id: c.id,
      share: Number((c.base + (Math.random() * 8 - 4)).toFixed(1))
    }));
    scored.sort((a, b) => b.share - a.share);
    cities[cityId] = {
      winnerId: scored[0].id,
      winnerShare: Math.min(99.9, Math.max(1, scored[0].share))
    };
  });

  // 桃園第1選區特別題：隨機模擬暫定是否當選
  cities["taoyuan-c1"] = {
    winnerId: Math.random() >= 0.45 ? "yes" : "no"
  };

  return {
    isSimulated: true,
    source: "gas-simulation",
    countingProgress: nextProgress,
    updatedAt: new Date().toISOString(),
    cities: cities
  };
}

/**
 * 正式開票抓取與格式轉換（待中選會公布 2026 JSON 端點後實作對照）
 */
function fetchCecOfficialResults_() {
  const res = UrlFetchApp.fetch(CONFIG.CEC_JSON_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("抓取中選會資料失敗，HTTP " + res.getResponseCode());
  }
  const raw = JSON.parse(res.getContentText());

  // TODO: 依中選會實際 JSON 結構轉換成以下格式：
  // return {
  //   isSimulated: false,
  //   source: "cec-official",
  //   countingProgress: raw.progress,
  //   updatedAt: new Date().toISOString(),
  //   cities: {
  //     taipei: { winnerId: "tpe-5", winnerShare: 52.3 },
  //     ...
  //   }
  // };
  throw new Error("請依中選會 2026 JSON 格式完成 fetchCecOfficialResults_ 解析邏輯。");
}

// ============================================================================
// Firebase Service Account JWT 驗證與 Firestore REST API 工具函式
// ============================================================================

function writeFirestoreDocument_(docPath, data) {
  const token = getFirestoreAccessToken_();
  const url =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(CONFIG.PROJECT_ID) +
    "/databases/(default)/documents/" +
    docPath;

  const body = {
    fields: toFirestoreMapFields_(data)
  };

  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firestore 寫入失敗 (" + code + "): " + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function getFirestoreAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty("FIREBASE_CLIENT_EMAIL");
  const rawKey = props.getProperty("FIREBASE_PRIVATE_KEY");
  if (!clientEmail || !rawKey) {
    throw new Error("請先在指令碼屬性設定 FIREBASE_CLIENT_EMAIL 與 FIREBASE_PRIVATE_KEY。");
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600
  };

  const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, "");
  const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=+$/, "");
  const unsignedJwt = encodedHeader + "." + encodedClaim;

  const signatureBytes = Utilities.computeRsaSha256Signature(unsignedJwt, privateKey);
  const encodedSig = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, "");
  const assertion = unsignedJwt + "." + encodedSig;

  const tokenRes = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assertion
    },
    muteHttpExceptions: true
  });

  const tokenCode = tokenRes.getResponseCode();
  if (tokenCode !== 200) {
    throw new Error("取得 Google OAuth Token 失敗 (" + tokenCode + "): " + tokenRes.getContentText());
  }
  return JSON.parse(tokenRes.getContentText()).access_token;
}

function toFirestoreMapFields_(obj) {
  const fields = {};
  Object.keys(obj).forEach((key) => {
    fields[key] = toFirestoreValue_(obj[key]);
  });
  return fields;
}

function toFirestoreValue_(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === "boolean") {
    return { booleanValue: val };
  }
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue_) } };
  }
  if (typeof val === "object") {
    return { mapValue: { fields: toFirestoreMapFields_(val) } };
  }
  return { stringValue: String(val) };
}
