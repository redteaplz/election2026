// 2026 九合一縣市長選舉資料設定與計分邏輯
// 五都市長（單選當選人 + 預測得票率）＋ 桃園市議員第1選區王妃特別題（是非題）

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
    id: "taoyuan-c1",
    name: "特別題：桃園市議員第1選區（王妃）",
    subtitle: "12號「王妃天崩開局穿越整頓霸凌者佀廣洋」會不會當選？",
    type: "yesno",
    candidates: [
      { id: "yes", name: "會當選", party: "預測當選", color: "#1a7f37" },
      { id: "no", name: "不會當選", party: "預測落選", color: "#cf222e" }
    ]
  }
];

/**
 * 計算單一選區得分：
 * - 五都市長（type: "mayor"，滿分 100 分）：
 *   1. 猜中當選人：+40 分
 *   2. 得票率精準度：max(0, 60 - |預測得票率 - 實際當選人得票率| * 2)
 * - 特別題（type: "yesno"，滿分 40 分）：
 *   預測成功（猜中會不會當選）：+40 分
 */
export function calculateCityScore(constituency, predictionCity, actualCity) {
  if (!predictionCity || !actualCity || !actualCity.winnerId) {
    return null;
  }

  const winnerHit = predictionCity.winnerId === actualCity.winnerId;

  if (constituency.type === "yesno") {
    const totalPoints = winnerHit ? 40 : 0;
    return {
      winnerHit,
      winnerPoints: totalPoints,
      accuracyPoints: 0,
      errorSum: 0,
      totalPoints
    };
  }

  const winnerPoints = winnerHit ? 40 : 0;
  const predShare = Number(predictionCity.winnerShare ?? 0);
  const actualShare = Number(actualCity.winnerShare ?? 0);
  const diff = Number(Math.abs(predShare - actualShare).toFixed(1));
  const accuracyPoints = Number(Math.max(0, 60 - diff * 2).toFixed(1));
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
