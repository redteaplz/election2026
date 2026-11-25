// 2026 九合一縣市長選舉資料設定與計分邏輯
// 註：以下候選人名稱為試玩範例，您可依實際登記名單自由修改 id、name 與 party。

export const CONSTITUENCIES = [
  {
    id: "taipei",
    name: "台北市",
    candidates: [
      { id: "tpe-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "tpe-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "tpe-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  },
  {
    id: "new-taipei",
    name: "新北市",
    candidates: [
      { id: "ntp-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "ntp-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "ntp-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  },
  {
    id: "taoyuan",
    name: "桃園市",
    candidates: [
      { id: "tyn-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "tyn-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "tyn-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  },
  {
    id: "taichung",
    name: "台中市",
    candidates: [
      { id: "txg-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "txg-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "txg-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  },
  {
    id: "tainan",
    name: "台南市",
    candidates: [
      { id: "tnn-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "tnn-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "tnn-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  },
  {
    id: "kaohsiung",
    name: "高雄市",
    candidates: [
      { id: "khh-1", name: "候選人 A（藍）", party: "國民黨", color: "#000095" },
      { id: "khh-2", name: "候選人 B（綠）", party: "民進黨", color: "#1b9431" },
      { id: "khh-3", name: "候選人 C（白/無）", party: "民眾黨/其他", color: "#28c8c8" }
    ]
  }
];

/**
 * 計算單一選區得分（滿分 100 分）
 * - 猜中當選人：+40 分
 * - 得票率精準度：60 - (各候選人得票率誤差總和 * 1.5)，最低 0 分
 *   也就是說「實際得票率與預測得票率相減的絕對值總和」越小，分數越高！
 */
export function calculateCityScore(constituency, predictionCity, actualCity) {
  if (!predictionCity || !actualCity || !actualCity.winnerId) {
    return null;
  }

  const winnerHit = predictionCity.winnerId === actualCity.winnerId;
  const winnerPoints = winnerHit ? 40 : 0;

  let errorSum = 0;
  const candidateDiffs = constituency.candidates.map((cand) => {
    const predShare = Number(predictionCity.shares?.[cand.id] ?? 0);
    const actualShare = Number(actualCity.shares?.[cand.id] ?? 0);
    const diff = Math.abs(predShare - actualShare);
    errorSum += diff;
    return {
      candidateId: cand.id,
      name: cand.name,
      predShare,
      actualShare,
      diff: Number(diff.toFixed(1))
    };
  });

  const accuracyPoints = Math.max(0, 60 - errorSum * 1.5);
  const totalPoints = Number((winnerPoints + accuracyPoints).toFixed(1));

  return {
    winnerHit,
    winnerPoints,
    accuracyPoints: Number(accuracyPoints.toFixed(1)),
    errorSum: Number(errorSum.toFixed(1)),
    totalPoints,
    candidateDiffs
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
