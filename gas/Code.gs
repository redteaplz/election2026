/**
 * 2026 九合一選舉預測大賽｜Google Apps Script 即時開票更新器（完整候選人票數與得票率版）
 *
 * - 測試模擬模式 (MODE = "simulation")：
 *   寫入 Firestore `official_results/2026_sim`，並標註 `isSimulated: true`，
 *   與正式開票文件 `official_results/2026` 完全隔離。
 * - 正式開票模式 (MODE = "official")：
 *   從中選會公開 JSON 端點抓取實際開票結果，寫入 `official_results/2026`。
 *
 * 資料結構規格請參閱同目錄 `gas/data.md`。
 */

const CONFIG = {
  PROJECT_ID: "election2026-97e12",
  MODE: "simulation", // "simulation"（測試模擬）| "official"（正式開票）
  SIM_DOC_PATH: "official_results/2026_sim",
  OFFICIAL_DOC_PATH: "official_results/2026",
  CEC_JSON_URL: "" // 選前/當天取得中選會即時開票 JSON 網址後填入
};

// 與前端 data.js 完全對應的選區與候選人清單（供模擬器與中選會對照使用）
const CONSTITUENCY_META = {
  taipei: {
    type: "mayor",
    estimatedTotalVotes: 1350000,
    candidates: [
      { id: "tpe-1", no: 1, name: "1號 郭璽（台灣麻將最大黨）", party: "台灣麻將最大黨", weight: 1.5 },
      { id: "tpe-2", no: 2, name: "2號 林志成（無黨籍）", party: "無黨籍", weight: 1.0 },
      { id: "tpe-3", no: 3, name: "3號 沈伯洋（民進黨）", party: "民主進步黨", weight: 44.5 },
      { id: "tpe-4", no: 4, name: "4號 蕭文乾（臺灣SoR無法黨）", party: "臺灣SoR無法黨", weight: 0.8 },
      { id: "tpe-5", no: 5, name: "5號 蔣萬安（國民黨）", party: "中國國民黨", weight: 51.0 },
      { id: "tpe-6", no: 6, name: "6號 唐新民（三勢團結促進聯盟）", party: "三勢團結促進聯盟", weight: 1.2 }
    ]
  },
  "new-taipei": {
    type: "mayor",
    estimatedTotalVotes: 1950000,
    candidates: [
      { id: "ntp-1", no: 1, name: "1號 蘇巧慧（民進黨）", party: "民主進步黨", weight: 47.0 },
      { id: "ntp-2", no: 2, name: "2號 蘇輝湟（無黨籍）", party: "無黨籍", weight: 3.0 },
      { id: "ntp-3", no: 3, name: "3號 李四川（國民黨）", party: "中國國民黨", weight: 50.0 }
    ]
  },
  taichung: {
    type: "mayor",
    estimatedTotalVotes: 1400000,
    candidates: [
      { id: "txg-1", no: 1, name: "1號 何欣純（民進黨）", party: "民主進步黨", weight: 45.0 },
      { id: "txg-2", no: 2, name: "2號 洪麗華（司法正義黨）", party: "司法正義黨", weight: 2.5 },
      { id: "txg-3", no: 3, name: "3號 江啟臣（國民黨）", party: "中國國民黨", weight: 52.5 }
    ]
  },
  tainan: {
    type: "mayor",
    estimatedTotalVotes: 920000,
    candidates: [
      { id: "tnn-1", no: 1, name: "1號 蕭燐洪（臺灣SoR無法黨）", party: "臺灣SoR無法黨", weight: 1.5 },
      { id: "tnn-2", no: 2, name: "2號 謝龍介（國民黨）", party: "中國國民黨", weight: 43.0 },
      { id: "tnn-3", no: 3, name: "3號 陳亭妃（民進黨）", party: "民主進步黨", weight: 53.5 },
      { id: "tnn-4", no: 4, name: "4號 葉人文（無黨籍）", party: "無黨籍", weight: 2.0 }
    ]
  },
  kaohsiung: {
    type: "mayor",
    estimatedTotalVotes: 1380000,
    candidates: [
      { id: "khh-1", no: 1, name: "1號 張靜（司法改革黨）", party: "司法改革黨", weight: 1.5 },
      { id: "khh-2", no: 2, name: "2號 王肇民（無黨籍）", party: "無黨籍", weight: 1.5 },
      { id: "khh-3", no: 3, name: "3號 柯志恩（國民黨）", party: "中國國民黨", weight: 46.0 },
      { id: "khh-4", no: 4, name: "4號 洪方隆（無黨籍）", party: "無黨籍", weight: 1.0 },
      { id: "khh-5", no: 5, name: "5號 賴瑞隆（民進黨）", party: "民主進步黨", weight: 50.0 }
    ]
  },
  hsinchu: {
    type: "mayor",
    estimatedTotalVotes: 230000,
    candidates: [
      { id: "hsz-1", no: 1, name: "1號 高虹安（無黨籍）", party: "無黨籍", weight: 46.0 },
      { id: "hsz-2", no: 2, name: "2號 何志勇（無黨籍）", party: "無黨籍", weight: 13.0 },
      { id: "hsz-3", no: 3, name: "3號 莊競程（民進黨）", party: "民主進步黨", weight: 41.0 }
    ]
  },
  "taoyuan-c1": {
    type: "yesno",
    seats: 12,
    targetCandidateId: "tyc1-12",
    estimatedTotalVotes: 210000,
    candidates: [
      { id: "tyc1-1", no: 1, name: "1號 徐千晴（民眾黨）", party: "台灣民眾黨", weight: 6.2 },
      { id: "tyc1-2", no: 2, name: "2號 余信憲（民進黨）", party: "民主進步黨", weight: 6.8 },
      { id: "tyc1-3", no: 3, name: "3號 張碩芳（國民黨）", party: "中國國民黨", weight: 5.5 },
      { id: "tyc1-4", no: 4, name: "4號 凌濤（國民黨）", party: "中國國民黨", weight: 9.2 },
      { id: "tyc1-5", no: 5, name: "5號 陳美梅（國民黨）", party: "中國國民黨", weight: 6.5 },
      { id: "tyc1-6", no: 6, name: "6號 林政賢（國民黨）", party: "中國國民黨", weight: 5.8 },
      { id: "tyc1-7", no: 7, name: "7號 黃瓊慧（民進黨）", party: "民主進步黨", weight: 8.6 },
      { id: "tyc1-8", no: 8, name: "8號 沈佩玲（小民參政歐巴桑聯盟）", party: "小民參政歐巴桑聯盟", weight: 2.8 },
      { id: "tyc1-9", no: 9, name: "9號 于北辰（無黨籍）", party: "無黨籍", weight: 5.9 },
      { id: "tyc1-10", no: 10, name: "10號 黃家齊（民進黨）", party: "民主進步黨", weight: 5.4 },
      { id: "tyc1-11", no: 11, name: "11號 詹江村（國民黨）", party: "中國國民黨", weight: 7.4 },
      { id: "tyc1-12", no: 12, name: "12號 王妃天崩開局穿越整頓霸凌者佀廣洋（無黨籍）", party: "無黨籍", weight: 4.5 },
      { id: "tyc1-13", no: 13, name: "13號 李凱倫（無黨籍）", party: "無黨籍", weight: 2.1 },
      { id: "tyc1-14", no: 14, name: "14號 佀廣洋（無黨籍）", party: "無黨籍", weight: 3.4 },
      { id: "tyc1-15", no: 15, name: "15號 李光達（民進黨）", party: "民主進步黨", weight: 5.6 },
      { id: "tyc1-16", no: 16, name: "16號 李柏瑟（民進黨）", party: "民主進步黨", weight: 4.4 },
      { id: "tyc1-17", no: 17, name: "17號 黃婉如（國民黨）", party: "中國國民黨", weight: 6.0 },
      { id: "tyc1-18", no: 18, name: "18號 朱永煇（無黨籍）", party: "無黨籍", weight: 2.2 },
      { id: "tyc1-19", no: 19, name: "19號 許孟祥（勞動黨）", party: "勞動黨", weight: 1.7 }
    ]
  }
};

/**
 * 主排程函式：建議設定為每 1 分鐘（測試）或每 3~5 分鐘（正式）執行一次
 * 內建 LockService 防重疊鎖，避免開票尖峰中選會回應較慢時排程重疊覆寫舊資料
 */
function runLiveUpdate() {
  const lock = typeof LockService !== "undefined" ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(5000)) {
    Logger.log("[SKIP] 前一次 runLiveUpdate 仍在執行中，略過本次排程避免重疊。");
    return;
  }

  try {
    if (CONFIG.MODE === "simulation") {
      const payload = buildSimulatedPayload_();
      writeFirestoreDocument_(CONFIG.SIM_DOC_PATH, payload);
      Logger.log(
        "[SIMULATION] Updated %s | progress=%s%% | taoyuan-c1 rank=%s (%s)",
        CONFIG.SIM_DOC_PATH,
        payload.countingProgress,
        payload.cities["taoyuan-c1"].targetRank,
        payload.cities["taoyuan-c1"].winnerId
      );
      return;
    }

    if (!CONFIG.CEC_JSON_URL) {
      throw new Error("正式模式請先在 CONFIG.CEC_JSON_URL 填入中選會資料來源網址。");
    }
    const payload = fetchCecOfficialResults_();
    writeFirestoreDocument_(CONFIG.OFFICIAL_DOC_PATH, payload);
    Logger.log("[OFFICIAL] Updated %s | progress=%s%%", CONFIG.OFFICIAL_DOC_PATH, payload.countingProgress);
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
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
 * 一鍵移除所有排程觸發器（測試或開票結束後務必執行）
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
 * 將單一選區的各候選人票數整理成標準 Firestore 格式（供模擬與中選會正式對接共用）
 *
 * @param {string} cityId - 選區 ID（如 "taipei"、"taoyuan-c1"）
 * @param {Object<string, number|{votes:number, share?:number, elected?:boolean}>} inputByCandidateId
 * @param {{ validVotes?: number }} [options]
 * @return {Object} 標準選區開票物件（詳見 gas/data.md）
 */
function buildCityResultPayload_(cityId, inputByCandidateId, options) {
  const meta = CONSTITUENCY_META[cityId];
  if (!meta) {
    throw new Error("未知的選區 ID: " + cityId);
  }

  const map = inputByCandidateId || {};
  let computedTotalVotes = 0;
  meta.candidates.forEach((c) => {
    const entry = map[c.id];
    const rawVotes = typeof entry === "object" && entry !== null ? entry.votes : entry;
    const v = Math.max(0, Math.round(Number(rawVotes || 0)));
    computedTotalVotes += v;
  });

  const validVotesOpt = options && typeof options.validVotes === "number" ? options.validVotes : null;
  const totalVotes = validVotesOpt !== null && validVotesOpt > 0 ? validVotesOpt : computedTotalVotes;

  const enriched = meta.candidates.map((c) => {
    const entry = map[c.id];
    const isObj = typeof entry === "object" && entry !== null;
    const rawVotes = isObj ? entry.votes : entry;
    const votes = Math.max(0, Math.round(Number(rawVotes || 0)));
    const hasOfficialShare = isObj && typeof entry.share === "number" && !Number.isNaN(entry.share);
    const exactShare = hasOfficialShare
      ? Math.max(0, entry.share)
      : totalVotes > 0
        ? (votes / totalVotes) * 100
        : 0;
    const item = {
      id: c.id,
      no: c.no,
      name: c.name,
      party: c.party,
      votes: votes,
      share: Number(exactShare.toFixed(2)),
      _exactShare: exactShare,
      _hasOfficialShare: hasOfficialShare
    };
    if (isObj && typeof entry.elected === "boolean") {
      item.elected = entry.elected;
    }
    return item;
  });

  const maxExactShare = enriched.reduce((m, c) => Math.max(m, c._exactShare), 0);
  const hasOpenedVotes = computedTotalVotes > 0 || maxExactShare > 0;

  // 依得票率由高到低排序（同率比票數、再比號次）
  if (hasOpenedVotes) {
    enriched.sort((a, b) => {
      if (b.share !== a.share) return b.share - a.share;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.no - b.no;
    });
  } else {
    enriched.sort((a, b) => a.no - b.no);
  }

  const candidates = enriched.map((item) => {
    const out = {
      id: item.id,
      no: item.no,
      name: item.name,
      party: item.party,
      votes: item.votes,
      share: item.share
    };
    if (typeof item.elected === "boolean") {
      out.elected = item.elected;
    }
    return out;
  });

  if (meta.type === "yesno") {
    const seats = meta.seats || 12;
    const targetId = meta.targetCandidateId || "tyc1-12";
    if (!hasOpenedVotes) {
      return {
        seats: seats,
        targetCandidateId: targetId,
        totalVotes: 0,
        winnerId: null,
        targetRank: null,
        targetVotes: 0,
        targetShare: 0,
        candidates: candidates
      };
    }

    const targetIdx = enriched.findIndex((c) => c.id === targetId);
    const targetRank = targetIdx >= 0 ? targetIdx + 1 : null;
    const targetCand = targetIdx >= 0 ? enriched[targetIdx] : null;
    const isElected =
      targetCand && typeof targetCand.elected === "boolean"
        ? targetCand.elected
        : targetRank !== null && targetRank <= seats;

    return {
      seats: seats,
      targetCandidateId: targetId,
      totalVotes: computedTotalVotes,
      winnerId: isElected ? "yes" : "no",
      targetRank: targetRank,
      targetVotes: targetCand ? targetCand.votes : 0,
      targetShare: targetCand ? targetCand.share : 0,
      candidates: candidates
    };
  }

  if (!hasOpenedVotes) {
    return {
      totalVotes: 0,
      winnerId: null,
      winnerShare: null,
      winnerVotes: 0,
      candidates: candidates
    };
  }

  const leader = enriched[0];
  const payload = {
    totalVotes: computedTotalVotes,
    winnerId: leader.id,
    winnerShare: Number(leader._exactShare.toFixed(1)),
    winnerVotes: leader.votes,
    candidates: candidates
  };
  if (leader._hasOfficialShare) {
    payload.officialWinnerShare = true;
  }
  return payload;
}

/**
 * 產生模擬開票數據（每次執行進度 +5%，到 100% 後重新從 5% 循環以便持續測試）
 * 會輸出所有候選人的票數與得票率，方便完整測試前端展開排名與王妃前 12 名判定。
 */
function buildSimulatedPayload_() {
  const props = PropertiesService.getScriptProperties();
  const prev = Number(props.getProperty("SIM_PROGRESS") || "0");
  const nextProgress = prev >= 100 ? 5 : prev + 5;
  props.setProperty("SIM_PROGRESS", String(nextProgress));

  const progressRatio = nextProgress / 100;
  const cities = {};

  Object.keys(CONSTITUENCY_META).forEach((cityId) => {
    const meta = CONSTITUENCY_META[cityId];
    const cityTotalTarget = Math.max(1000, Math.round(meta.estimatedTotalVotes * progressRatio));

    // 加入隨機波動（縣市長 ±12% 相對權重；議員選區 ±25% 相對權重以模擬拉鋸）
    const jitterScale = meta.type === "yesno" ? 0.5 : 0.24;
    const rawWeights = meta.candidates.map((c) => {
      const factor = 1 + (Math.random() * jitterScale - jitterScale / 2);
      return { id: c.id, w: Math.max(0.2, c.weight * factor) };
    });
    const weightSum = rawWeights.reduce((sum, item) => sum + item.w, 0);

    const votesMap = {};
    rawWeights.forEach((item) => {
      votesMap[item.id] = Math.round((item.w / weightSum) * cityTotalTarget);
    });

    cities[cityId] = buildCityResultPayload_(cityId, votesMap);
  });

  return {
    isSimulated: true,
    source: "gas-simulation",
    countingProgress: nextProgress,
    updatedAt: new Date().toISOString(),
    cities: cities
  };
}

/**
 * 正式開票抓取與格式轉換（待中選會公布 2026 JSON 端點後完成對應解析）
 * 詳見 gas/data.md 中的中選會對接指南。
 */
function fetchCecOfficialResults_() {
  const res = UrlFetchApp.fetch(CONFIG.CEC_JSON_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("抓取中選會資料失敗，HTTP " + res.getResponseCode());
  }
  const raw = JSON.parse(res.getContentText());

  // TODO: 依中選會實際 JSON 結構取出各選區候選人票數，傳入 buildCityResultPayload_(cityId, votesMap)
  // 範例：
  // const cities = {
  //   taipei: buildCityResultPayload_("taipei", { "tpe-1": 1200, "tpe-2": 900, ... }),
  //   "new-taipei": buildCityResultPayload_("new-taipei", { "ntp-1": 450000, ... }),
  //   taichung: buildCityResultPayload_("taichung", { "txg-1": 380000, ... }),
  //   tainan: buildCityResultPayload_("tainan", { "tnn-1": 10000, ... }),
  //   kaohsiung: buildCityResultPayload_("kaohsiung", { "khh-1": 12000, ... }),
  //   hsinchu: buildCityResultPayload_("hsinchu", { "hsz-1": 95000, ... }),
  //   "taoyuan-c1": buildCityResultPayload_("taoyuan-c1", { "tyc1-1": 12000, ..., "tyc1-12": 9800, ... })
  // };
  // return {
  //   isSimulated: false,
  //   source: "cec-official",
  //   countingProgress: Number(raw.progress || 0),
  //   updatedAt: new Date().toISOString(),
  //   cities: cities
  // };
  throw new Error("請依中選會 2026 JSON 格式完成 fetchCecOfficialResults_ 解析邏輯（規格見 gas/data.md）。");
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
  const cache = typeof CacheService !== "undefined" ? CacheService.getScriptCache() : null;
  if (cache) {
    const cachedToken = cache.get("FIRESTORE_ACCESS_TOKEN");
    if (cachedToken) {
      return cachedToken;
    }
  }

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
  const accessToken = JSON.parse(tokenRes.getContentText()).access_token;
  if (cache && accessToken) {
    cache.put("FIRESTORE_ACCESS_TOKEN", accessToken, 3000); // 快取 50 分鐘（Token 效期 60 分鐘）
  }
  return accessToken;
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
