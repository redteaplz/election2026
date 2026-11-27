// 2026 九合一縣市長選舉資料設定與計分邏輯
// 六縣市長（台北、新北、台中、台南、高雄、新竹市：單選當選人 + 預測得票率）＋ 桃園市議員第1選區王妃特別題（是非題）

export const OFFICIAL_LOCK_ISO = "2026-11-28T16:00:00+08:00";

/**
 * 判斷賽局是否已鎖單：
 * - 測試賽局 (type === "test")：永不鎖單
 * - 正式賽局 (type === "official")：到達 lockAt（預設 2026/11/28 16:00 台灣時間）後自動鎖單
 */
export function isGameLocked(game, nowMs = Date.now()) {
  if (!game || game.type !== "official") return false;
  const lockMs = Date.parse(game.lockAt || OFFICIAL_LOCK_ISO);
  if (Number.isNaN(lockMs)) return false;
  return nowMs >= lockMs;
}

export const RESULT_SOURCES = {
  OFFICIAL_DB: "official_db",
  SIM_DB: "sim_db",
  MANUAL: "manual"
};

/**
 * 取得賽局的開票資料來源（相容舊版無 resultSource 欄位的賽局）：
 * - "official_db": Firebase 中選會正式開票資料 (official_results/2026)
 * - "sim_db": Firebase 模擬開票資料 (official_results/2026_sim)
 * - "manual": 純手動開票
 */
export function getGameResultSource(game) {
  if (!game) return RESULT_SOURCES.MANUAL;
  if (
    game.resultSource === RESULT_SOURCES.OFFICIAL_DB ||
    game.resultSource === RESULT_SOURCES.SIM_DB ||
    game.resultSource === RESULT_SOURCES.MANUAL
  ) {
    return game.resultSource;
  }
  if (game.type === "official") return RESULT_SOURCES.OFFICIAL_DB;
  if (game.useLiveSim) return RESULT_SOURCES.SIM_DB;
  return RESULT_SOURCES.MANUAL;
}

export function getResultSourceLabel(source) {
  if (source === RESULT_SOURCES.OFFICIAL_DB) return "中選會正式開票";
  if (source === RESULT_SOURCES.SIM_DB) return "模擬開票";
  return "純手動開票";
}

/**
 * 判斷賽局目前是否應連接 Firebase 開票資料庫：
 * - 已結算或純手動開票：不連線
 * - 正式賽局：需到達鎖單時間（isGameLocked === true）才開始連接 Firebase 開票資料
 * - 測試賽局：選用 Firebase 來源即立即連線
 */
export function shouldConnectFirebaseResults(game, nowMs = Date.now()) {
  if (!game || isGameSettled(game)) return false;
  const source = getGameResultSource(game);
  if (source === RESULT_SOURCES.MANUAL) return false;
  if (game.type === "official") {
    return isGameLocked(game, nowMs);
  }
  return true;
}

/**
 * 判斷賽局是否已結算計分（歷史賽局）：
 * - 已標記 settled === true
 * - 舊版未含 settled 欄位的測試賽局若已有 testResults 亦視為已結算
 * （未結算賽局在開票過程中可持續更新，需由管理員手動結算封存後才成為歷史賽局）
 */
export function isGameSettled(game) {
  if (!game) return false;
  if (typeof game.settled === "boolean") return game.settled;
  if (game.type === "test" && !game.useLiveSim) {
    return Object.keys(game.testResults?.cities || {}).length > 0;
  }
  return false;
}

export function formatLockTime(isoString) {
  const date = new Date(isoString || OFFICIAL_LOCK_ISO);
  if (Number.isNaN(date.getTime())) return "2026/11/28 16:00";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export const CONSTITUENCIES = [
  {
    id: "taipei",
    name: "台北市市長",
    type: "mayor",
    candidates: [
      { id: "tpe-1", name: "1號 郭璽（台灣麻將最大黨）", party: "台灣麻將最大黨", color: "#64748b" },
      { id: "tpe-2", name: "2號 林志成（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "tpe-3", name: "3號 沈伯洋（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tpe-4", name: "4號 蕭文乾（臺灣SoR無法黨）", party: "臺灣SoR無法黨", color: "#64748b" },
      { id: "tpe-5", name: "5號 蔣萬安（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tpe-6", name: "6號 唐新民（三勢團結促進聯盟）", party: "三勢團結促進聯盟", color: "#64748b" }
    ]
  },
  {
    id: "new-taipei",
    name: "新北市市長",
    type: "mayor",
    candidates: [
      { id: "ntp-1", name: "1號 蘇巧慧（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "ntp-2", name: "2號 蘇輝湟（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "ntp-3", name: "3號 李四川（國民黨）", party: "中國國民黨", color: "#000095" }
    ]
  },
  {
    id: "taichung",
    name: "台中市市長",
    type: "mayor",
    candidates: [
      { id: "txg-1", name: "1號 何欣純（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "txg-2", name: "2號 洪麗華（司法正義黨）", party: "司法正義黨", color: "#64748b" },
      { id: "txg-3", name: "3號 江啟臣（國民黨）", party: "中國國民黨", color: "#000095" }
    ]
  },
  {
    id: "tainan",
    name: "台南市市長",
    type: "mayor",
    candidates: [
      { id: "tnn-1", name: "1號 蕭燐洪（臺灣SoR無法黨）", party: "臺灣SoR無法黨", color: "#64748b" },
      { id: "tnn-2", name: "2號 謝龍介（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tnn-3", name: "3號 陳亭妃（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tnn-4", name: "4號 葉人文（無黨籍）", party: "無黨籍", color: "#64748b" }
    ]
  },
  {
    id: "kaohsiung",
    name: "高雄市市長",
    type: "mayor",
    candidates: [
      { id: "khh-1", name: "1號 張靜（司法改革黨）", party: "司法改革黨", color: "#64748b" },
      { id: "khh-2", name: "2號 王肇民（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "khh-3", name: "3號 柯志恩（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "khh-4", name: "4號 洪方隆（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "khh-5", name: "5號 賴瑞隆（民進黨）", party: "民主進步黨", color: "#1b9431" }
    ]
  },
  {
    id: "hsinchu",
    name: "新竹市市長",
    type: "mayor",
    candidates: [
      { id: "hsz-1", name: "1號 高虹安（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "hsz-2", name: "2號 何志勇（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "hsz-3", name: "3號 莊競程（民進黨）", party: "民主進步黨", color: "#1b9431" }
    ]
  },
  {
    id: "taoyuan-c1",
    name: "特別題：桃園市議員第1選區（王妃）",
    subtitle: "12號「王妃天崩開局穿越整頓霸凌者佀廣洋」會不會當選？（前 12 高得票率當選）",
    type: "yesno",
    seats: 12,
    targetCandidateId: "tyc1-12",
    candidates: [
      { id: "yes", name: "會當選", party: "預測當選", color: "#1a7f37" },
      { id: "no", name: "不會當選", party: "預測落選", color: "#cf222e" }
    ],
    districtCandidates: [
      { id: "tyc1-1", no: 1, name: "1號 徐千晴（民眾黨）", party: "台灣民眾黨", color: "#28c8c8" },
      { id: "tyc1-2", no: 2, name: "2號 余信憲（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tyc1-3", no: 3, name: "3號 張碩芳（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-4", no: 4, name: "4號 凌濤（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-5", no: 5, name: "5號 陳美梅（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-6", no: 6, name: "6號 林政賢（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-7", no: 7, name: "7號 黃瓊慧（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tyc1-8", no: 8, name: "8號 沈佩玲（小民參政歐巴桑聯盟）", party: "小民參政歐巴桑聯盟", color: "#e67e22" },
      { id: "tyc1-9", no: 9, name: "9號 于北辰（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "tyc1-10", no: 10, name: "10號 黃家齊（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tyc1-11", no: 11, name: "11號 詹江村（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-12", no: 12, name: "12號 王妃天崩開局穿越整頓霸凌者佀廣洋（無黨籍）", party: "無黨籍", color: "#d97706" },
      { id: "tyc1-13", no: 13, name: "13號 李凱倫（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "tyc1-14", no: 14, name: "14號 佀廣洋（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "tyc1-15", no: 15, name: "15號 李光達（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tyc1-16", no: 16, name: "16號 李柏瑟（民進黨）", party: "民主進步黨", color: "#1b9431" },
      { id: "tyc1-17", no: 17, name: "17號 黃婉如（國民黨）", party: "中國國民黨", color: "#000095" },
      { id: "tyc1-18", no: 18, name: "18號 朱永煇（無黨籍）", party: "無黨籍", color: "#64748b" },
      { id: "tyc1-19", no: 19, name: "19號 許孟祥（勞動黨）", party: "勞動黨", color: "#64748b" }
    ]
  }
];

function getPartyColorFallback(party) {
  if (!party) return "#64748b";
  if (party.includes("民進黨") || party.includes("民主進步黨")) return "#1b9431";
  if (party.includes("國民黨")) return "#000095";
  if (party.includes("民眾黨")) return "#28c8c8";
  return "#64748b";
}

/**
 * 統一解析單一選區開票結果（同時相容新版完整候選人陣列與舊版/手動簡化格式）：
 * - 新版格式（actualCity.candidates 陣列含每位候選人 votes 與 share）：
 *   - 若全選區總票數與最高得票率皆為 0（尚未開出任何票），且無管理員手動覆寫，回傳 hasResult: false
 *   - 依 share 由高到低排序（同率再比 votes 高到低、no 小到大）
 *   - 縣市長 (type === "mayor")：最高得票率候選人為 winnerId / winnerShare（避免二次四捨五入誤差）
 *   - 桃園議員特別題 (type === "yesno")：若目標候選人有官方 elected 註記則優先採用，否則排名前 seats (12) 名為 "yes"
 *   - 若含 manualOverride === true，以管理員手動指定的 winnerId / winnerShare 為準，但仍保留 sortedCandidates 供展開檢視
 * - 舊版/手動格式（僅含 winnerId / winnerShare）：直接回傳既有值
 */
export function resolveCityOutcome(constituency, actualCity) {
  if (!constituency || !actualCity) {
    return { hasResult: false, sortedCandidates: [] };
  }

  const rawList = Array.isArray(actualCity.candidates) ? actualCity.candidates : [];
  if (rawList.length > 0) {
    const refPool =
      constituency.type === "yesno"
        ? constituency.districtCandidates || []
        : constituency.candidates || [];

    const computedTotalVotes = rawList.reduce((sum, item) => {
      const v = Number(item.votes ?? 0);
      return sum + (Number.isNaN(v) ? 0 : Math.max(0, v));
    }, 0);
    const totalVotes = Number(actualCity.totalVotes ?? computedTotalVotes);

    const normalized = rawList.map((item, idx) => {
      const ref =
        refPool.find((c) => c.id === item.id) ||
        (item.no != null ? refPool.find((c) => c.no === Number(item.no)) : null);
      const votes = Number(item.votes ?? 0);
      const safeVotes = Number.isNaN(votes) ? 0 : Math.max(0, votes);
      const hasExplicitShare = item.share !== undefined && item.share !== null;
      const computedPct = totalVotes > 0 ? (safeVotes / totalVotes) * 100 : 0;
      const rawShare = hasExplicitShare ? Number(item.share) : computedPct;
      const safeRawShare = Number.isNaN(rawShare) ? 0 : Math.max(0, rawShare);
      const isVoteDerivedShare =
        !hasExplicitShare ||
        (totalVotes > 0 && Math.abs(safeRawShare - Number(computedPct.toFixed(2))) < 0.005);
      const party = item.party || ref?.party || "";
      return {
        id: item.id || ref?.id || `cand-${idx + 1}`,
        no: item.no ?? ref?.no ?? idx + 1,
        name: item.name || ref?.name || item.id || `候選人 ${idx + 1}`,
        party,
        color: ref?.color || getPartyColorFallback(party),
        votes: safeVotes,
        share: Number(safeRawShare.toFixed(2)),
        elected: typeof item.elected === "boolean" ? item.elected : undefined,
        _rawShare: safeRawShare,
        _exactShare: isVoteDerivedShare && totalVotes > 0 ? computedPct : safeRawShare
      };
    });

    const maxRawShare = normalized.reduce((m, c) => Math.max(m, c._rawShare), 0);
    const hasOpenedVotes = totalVotes > 0 || maxRawShare > 0;

    const sortedCandidates = hasOpenedVotes
      ? normalized
          .sort((a, b) => {
            if (b.share !== a.share) return b.share - a.share;
            if (b.votes !== a.votes) return b.votes - a.votes;
            return (a.no ?? 0) - (b.no ?? 0);
          })
          .map(({ _rawShare, _exactShare, ...publicCand }) => {
            Object.defineProperty(publicCand, "_exactShare", {
              value: _exactShare,
              enumerable: false
            });
            return publicCand;
          })
      : [];

    if (!hasOpenedVotes && !(actualCity.manualOverride && actualCity.winnerId)) {
      return {
        hasResult: false,
        totalVotes: 0,
        sortedCandidates: []
      };
    }

    if (constituency.type === "yesno") {
      const seats = Number(actualCity.seats ?? constituency.seats ?? 12);
      const targetId = actualCity.targetCandidateId || constituency.targetCandidateId || "tyc1-12";
      const targetIdx = sortedCandidates.findIndex((c) => c.id === targetId || c.no === 12);
      const targetRank = targetIdx >= 0 ? targetIdx + 1 : null;
      const targetCand = targetIdx >= 0 ? sortedCandidates[targetIdx] : null;
      const autoElected =
        targetCand && typeof targetCand.elected === "boolean"
          ? targetCand.elected
          : targetRank !== null && targetRank <= seats;
      const resolvedWinnerId =
        actualCity.manualOverride && (actualCity.winnerId === "yes" || actualCity.winnerId === "no")
          ? actualCity.winnerId
          : autoElected
            ? "yes"
            : "no";

      return {
        hasResult: true,
        winnerId: resolvedWinnerId,
        winnerShare: null,
        winnerVotes: null,
        totalVotes,
        seats,
        targetCandidateId: targetId,
        targetRank,
        targetVotes: targetCand ? targetCand.votes : null,
        targetShare: targetCand ? targetCand.share : null,
        sortedCandidates
      };
    }

    if (actualCity.manualOverride && actualCity.winnerId) {
      const matched =
        sortedCandidates.find((c) => c.id === actualCity.winnerId) ||
        constituency.candidates.find((c) => c.id === actualCity.winnerId);
      return {
        hasResult: true,
        winnerId: actualCity.winnerId,
        winnerShare: Number(Number(actualCity.winnerShare ?? 0).toFixed(1)),
        winnerVotes: typeof matched?.votes === "number" ? matched.votes : null,
        winnerName: matched?.name || null,
        winnerColor: matched?.color || "#64748b",
        totalVotes,
        sortedCandidates
      };
    }

    const leader = sortedCandidates[0];
    const preciseWinnerShare =
      typeof actualCity.winnerShare === "number" && actualCity.officialWinnerShare === true
        ? Number(actualCity.winnerShare.toFixed(1))
        : leader
          ? Number((leader._exactShare ?? leader.share).toFixed(1))
          : 0;

    return {
      hasResult: Boolean(leader),
      winnerId: leader?.id || null,
      winnerShare: preciseWinnerShare,
      winnerVotes: leader?.votes ?? 0,
      winnerName: leader?.name || null,
      winnerColor: leader?.color || "#64748b",
      totalVotes,
      sortedCandidates
    };
  }

  if (actualCity.winnerId) {
    return {
      hasResult: true,
      winnerId: actualCity.winnerId,
      winnerShare: typeof actualCity.winnerShare === "number" ? actualCity.winnerShare : Number(actualCity.winnerShare ?? 0),
      winnerVotes: typeof actualCity.winnerVotes === "number" ? actualCity.winnerVotes : null,
      totalVotes: typeof actualCity.totalVotes === "number" ? actualCity.totalVotes : null,
      seats: constituency.seats ?? null,
      targetCandidateId: constituency.targetCandidateId ?? null,
      targetRank: actualCity.targetRank ?? null,
      targetVotes: actualCity.targetVotes ?? null,
      targetShare: actualCity.targetShare ?? null,
      sortedCandidates: []
    };
  }

  return { hasResult: false, sortedCandidates: [] };
}

/**
 * 計算單一選區得分：
 * - 縣市長（type: "mayor"，滿分 100 分）：
 *   1. 猜中當選人：+40 分，並加計得票率精準度 max(0, 60 - |預測得票率 - 實際當選人得票率| * 4)
 *   2. 未猜中當選人：直接 0 分（不計得票率精準度分數，亦不將落選人預估與當選人得票率之差混入總誤差）
 * - 特別題（type: "yesno"，滿分 60 分）：
 *   預測成功（猜中會不會當選）：+60 分
 */
export function calculateCityScore(constituency, predictionCity, actualCity) {
  if (!predictionCity || !actualCity) {
    return null;
  }

  const outcome = resolveCityOutcome(constituency, actualCity);
  if (!outcome.hasResult || !outcome.winnerId) {
    return null;
  }

  const winnerHit = predictionCity.winnerId === outcome.winnerId;

  if (constituency.type === "yesno") {
    const totalPoints = winnerHit ? 60 : 0;
    return {
      winnerHit,
      winnerPoints: totalPoints,
      accuracyPoints: 0,
      errorSum: 0,
      totalPoints
    };
  }

  const predShare = Number(predictionCity.winnerShare ?? 0);
  const actualShare = Number(outcome.winnerShare ?? 0);
  const diff = Number(Math.abs(predShare - actualShare).toFixed(1));

  if (!winnerHit) {
    return {
      winnerHit: false,
      winnerPoints: 0,
      accuracyPoints: 0,
      errorSum: 0,
      totalPoints: 0,
      predShare,
      actualShare
    };
  }

  const winnerPoints = 40;
  const accuracyPoints = Number(Math.max(0, 60 - diff * 4).toFixed(1));
  const totalPoints = Number((winnerPoints + accuracyPoints).toFixed(1));

  return {
    winnerHit,
    winnerPoints,
    accuracyPoints,
    errorSum: diff,
    totalPoints,
    predShare,
    actualShare
  };
}

/**
 * 計算玩家在所有已開票選區的總成績
 */
export function calculatePlayerSummary(playerPrediction, actualResults) {
  let totalScore = 0;
  let totalError = 0;
  let winnerHits = 0;
  let scoredCities = 0;
  const breakdown = {};

  for (const city of CONSTITUENCIES) {
    const predCity = playerPrediction?.cities?.[city.id];
    const actualCity = actualResults?.cities?.[city.id];
    const result = calculateCityScore(city, predCity, actualCity);
    if (result) {
      scoredCities += 1;
      totalScore += result.totalPoints;
      totalError += result.errorSum;
      if (result.winnerHit) winnerHits += 1;
      breakdown[city.id] = result;
    }
  }

  return {
    scoredCities,
    totalScore: Number(totalScore.toFixed(1)),
    totalError: Number(totalError.toFixed(1)),
    winnerHits,
    breakdown
  };
}
