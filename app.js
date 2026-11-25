import { CONSTITUENCIES, calculatePlayerSummary } from "./data.js";
import {
  initStorage,
  savePrediction,
  subscribePredictions,
  saveActualResults,
  subscribeActualResults,
  clearLocalData
} from "./firebase-service.js";

// App state
let currentPredictions = [];
let currentActualResults = { cities: {} };

// DOM elements
const storageBadge = document.getElementById("storage-badge");
const navButtons = document.querySelectorAll(".nav-btn");
const viewSections = {
  predict: document.getElementById("view-predict"),
  results: document.getElementById("view-results"),
  leaderboard: document.getElementById("view-leaderboard")
};

const predictForm = document.getElementById("predict-form");
const nicknameInput = document.getElementById("player-nickname");
const nicknameError = document.getElementById("nickname-error");
const predictCitiesGrid = document.getElementById("predict-cities-grid");
const predictStatus = document.getElementById("predict-status");

const resultsForm = document.getElementById("results-form");
const resultsCitiesGrid = document.getElementById("results-cities-grid");
const resultsStatus = document.getElementById("results-status");

const leaderboardSummary = document.getElementById("leaderboard-summary");
const leaderboardTbody = document.getElementById("leaderboard-tbody");
const resetLocalBtn = document.getElementById("reset-local-btn");

const detailDialog = document.getElementById("detail-dialog");
const detailDialogTitle = document.getElementById("detail-dialog-title");
const detailDialogBody = document.getElementById("detail-dialog-body");
const guideDialog = document.getElementById("guide-dialog");

// 1. Initialize app
async function bootstrap() {
  const { mode } = await initStorage();
  if (mode === "firebase") {
    storageBadge.textContent = "Firebase 雲端連線中";
    storageBadge.className = "badge badge-firebase";
    resetLocalBtn.hidden = true;
  } else {
    storageBadge.textContent = "本機試玩模式 (LocalStorage)";
    storageBadge.className = "badge badge-local";
    resetLocalBtn.hidden = false;
  }

  renderCityCards(predictCitiesGrid, "pred");
  renderCityCards(resultsCitiesGrid, "res");
  setupNavigation();
  setupFormHandlers();
  setupDialogs();

  subscribePredictions((list) => {
    currentPredictions = list;
    renderLeaderboard();
  });

  subscribeActualResults((actuals) => {
    currentActualResults = actuals || { cities: {} };
    syncResultsFormFromData(currentActualResults.cities || {});
    renderLeaderboard();
  });
}

// 2. Navigation
function setupNavigation() {
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      switchView(target);
    });
  });
}

function switchView(target) {
  navButtons.forEach((btn) => {
    if (btn.dataset.view === target) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });
  Object.entries(viewSections).forEach(([key, section]) => {
    section.hidden = key !== target;
  });
}

// 3. Shared City Card Renderer
function renderCityCards(container, prefix) {
  container.replaceChildren();

  for (const city of CONSTITUENCIES) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "city-card";
    fieldset.dataset.cityId = city.id;

    const legend = document.createElement("legend");
    legend.textContent = city.name;
    fieldset.appendChild(legend);

    const meta = document.createElement("div");
    meta.className = "city-meta";
    const metaHint = document.createElement("span");
    metaHint.className = "hint";
    metaHint.textContent = "勾選當選人並調整得票率";

    const sumPill = document.createElement("span");
    sumPill.className = "sum-pill sum-warn";
    sumPill.id = `${prefix}-sum-${city.id}`;
    sumPill.textContent = "總和 0.0%";

    meta.append(metaHint, sumPill);
    fieldset.appendChild(meta);

    for (const cand of city.candidates) {
      const row = document.createElement("div");
      row.className = "candidate-row";

      const top = document.createElement("div");
      top.className = "candidate-top";

      const winnerLabel = document.createElement("label");
      winnerLabel.className = "winner-label";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `${prefix}-winner-${city.id}`;
      radio.value = cand.id;

      const dot = document.createElement("span");
      dot.className = "party-dot";
      dot.style.backgroundColor = cand.color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = cand.name;

      winnerLabel.append(radio, dot, nameSpan);
      top.appendChild(winnerLabel);
      row.appendChild(top);

      const controls = document.createElement("div");
      controls.className = "share-controls";

      const range = document.createElement("input");
      range.type = "range";
      range.className = "share-range";
      range.min = "0";
      range.max = "100";
      range.step = "0.5";
      range.value = "0";
      range.setAttribute("aria-label", `${city.name} ${cand.name} 預估得票率滑桿`);

      const numWrap = document.createElement("div");
      numWrap.className = "share-number-wrap";

      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.className = "share-number";
      numInput.id = `${prefix}-share-${city.id}-${cand.id}`;
      numInput.dataset.candId = cand.id;
      numInput.min = "0";
      numInput.max = "100";
      numInput.step = "0.1";
      numInput.value = "0";
      numInput.setAttribute("aria-label", `${city.name} ${cand.name} 得票率百分比`);

      const pctSymbol = document.createElement("span");
      pctSymbol.textContent = "%";

      numWrap.append(numInput, pctSymbol);
      controls.append(range, numWrap);
      row.appendChild(controls);
      fieldset.appendChild(row);

      // Sync range <-> number
      range.addEventListener("input", () => {
        numInput.value = range.value;
        updateCitySum(prefix, city);
      });

      numInput.addEventListener("input", () => {
        const val = clampShare(numInput.value);
        range.value = String(val);
        updateCitySum(prefix, city);
      });

      numInput.addEventListener("blur", () => {
        numInput.value = String(clampShare(numInput.value));
        updateCitySum(prefix, city);
      });
    }

    const actions = document.createElement("div");
    actions.className = "city-actions";

    const balanceBtn = document.createElement("button");
    balanceBtn.type = "button";
    balanceBtn.className = "btn btn-sm btn-secondary";
    balanceBtn.textContent = "自動配平至 100% 並選最高票";
    balanceBtn.addEventListener("click", () => {
      normalizeCityShares(prefix, city);
    });

    actions.appendChild(balanceBtn);
    fieldset.appendChild(actions);
    container.appendChild(fieldset);
  }
}

function clampShare(raw) {
  const num = Number.parseFloat(raw);
  if (Number.isNaN(num) || num < 0) return 0;
  if (num > 100) return 100;
  return Number(num.toFixed(1));
}

function updateCitySum(prefix, city) {
  let sum = 0;
  for (const cand of city.candidates) {
    const input = document.getElementById(`${prefix}-share-${city.id}-${cand.id}`);
    sum += clampShare(input.value);
  }
  const pill = document.getElementById(`${prefix}-sum-${city.id}`);
  const rounded = Number(sum.toFixed(1));
  pill.textContent = `總和 ${rounded}%`;
  const isOk = Math.abs(rounded - 100) <= 0.2;
  pill.className = `sum-pill ${isOk ? "sum-ok" : "sum-warn"}`;
}

function normalizeCityShares(prefix, city) {
  const inputs = city.candidates.map((c) => ({
    cand: c,
    input: document.getElementById(`${prefix}-share-${city.id}-${c.id}`),
    val: clampShare(document.getElementById(`${prefix}-share-${city.id}-${c.id}`).value)
  }));

  const currentSum = inputs.reduce((acc, item) => acc + item.val, 0);
  if (currentSum === 0) {
    const even = Number((100 / inputs.length).toFixed(1));
    inputs.forEach((item, idx) => {
      const v = idx === 0 ? Number((100 - even * (inputs.length - 1)).toFixed(1)) : even;
      setCandidateShare(prefix, city.id, item.cand.id, v);
    });
  } else {
    let running = 0;
    inputs.forEach((item, idx) => {
      let scaled;
      if (idx === inputs.length - 1) {
        scaled = Number((100 - running).toFixed(1));
      } else {
        scaled = Number(((item.val / currentSum) * 100).toFixed(1));
        running += scaled;
      }
      setCandidateShare(prefix, city.id, item.cand.id, Math.max(0, scaled));
    });
  }

  // Pick highest share as winner
  let best = inputs[0].cand.id;
  let bestVal = -1;
  for (const c of city.candidates) {
    const v = clampShare(document.getElementById(`${prefix}-share-${city.id}-${c.id}`).value);
    if (v > bestVal) {
      bestVal = v;
      best = c.id;
    }
  }
  const winnerRadio = document.querySelector(
    `input[name="${prefix}-winner-${city.id}"][value="${best}"]`
  );
  if (winnerRadio) winnerRadio.checked = true;
  updateCitySum(prefix, city);
}

function setCandidateShare(prefix, cityId, candId, value) {
  const numInput = document.getElementById(`${prefix}-share-${cityId}-${candId}`);
  if (!numInput) return;
  numInput.value = String(value);
  const range = numInput.closest(".share-controls")?.querySelector(".share-range");
  if (range) range.value = String(value);
}

function readCitiesFromForm(prefix, { requireAll }) {
  const citiesData = {};
  for (const city of CONSTITUENCIES) {
    const winnerEl = document.querySelector(`input[name="${prefix}-winner-${city.id}"]:checked`);
    const shares = {};
    let sum = 0;
    for (const cand of city.candidates) {
      const val = clampShare(document.getElementById(`${prefix}-share-${city.id}-${cand.id}`).value);
      shares[cand.id] = val;
      sum += val;
    }
    sum = Number(sum.toFixed(1));

    if (!winnerEl) {
      if (requireAll) {
        return { error: `請選擇「${city.name}」的預測當選人。`, focusEl: document.querySelector(`input[name="${prefix}-winner-${city.id}"]`) };
      }
      continue; // In results mode, skip unopened cities
    }

    if (Math.abs(sum - 100) > 0.2) {
      return {
        error: `「${city.name}」的得票率總和目前為 ${sum}%，請調整為 100%（可點擊「自動配平至 100%」）。`,
        focusEl: document.getElementById(`${prefix}-share-${city.id}-${city.candidates[0].id}`)
      };
    }

    citiesData[city.id] = {
      winnerId: winnerEl.value,
      shares
    };
  }

  return { data: citiesData, error: null };
}

// 4. Form Handlers
function setupFormHandlers() {
  // Validate nickname on blur, clear on input
  nicknameInput.addEventListener("blur", () => {
    if (nicknameInput.value.trim() === "") {
      nicknameInput.setAttribute("aria-invalid", "true");
      nicknameError.textContent = "請輸入玩家暱稱。";
    }
  });

  nicknameInput.addEventListener("input", () => {
    if (nicknameInput.value.trim() !== "") {
      nicknameInput.removeAttribute("aria-invalid");
      nicknameError.textContent = "";
    }
  });

  // Sample prediction fill
  document.getElementById("fill-sample-predict-btn").addEventListener("click", () => {
    if (!nicknameInput.value.trim()) {
      nicknameInput.value = `章魚哥_${Math.floor(100 + Math.random() * 900)}`;
      nicknameInput.removeAttribute("aria-invalid");
      nicknameError.textContent = "";
    }
    fillRandomCities("pred");
    setStatus(predictStatus, "已帶入一組範例預測，可直接送出或微調！", "success");
  });

  // Submit prediction
  predictForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      nicknameInput.setAttribute("aria-invalid", "true");
      nicknameError.textContent = "請先輸入玩家暱稱。";
      nicknameInput.focus();
      setStatus(predictStatus, "請修正表單錯誤後再送出。", "error");
      return;
    }

    const parsed = readCitiesFromForm("pred", { requireAll: true });
    if (parsed.error) {
      setStatus(predictStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    const submitBtn = document.getElementById("submit-predict-btn");
    submitBtn.disabled = true;
    try {
      await savePrediction(nickname, parsed.data);
      setStatus(predictStatus, `已成功儲存「${nickname}」的預測！可前往「排行榜」查看成績。`, "success");
    } catch (err) {
      setStatus(predictStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Simulate random actual results
  document.getElementById("simulate-results-btn").addEventListener("click", () => {
    fillRandomCities("res");
    setStatus(resultsStatus, "已隨機產生模擬開票數據，點擊「儲存開票結果並結算分數」即可看排名！", "success");
  });

  // Clear results form
  document.getElementById("clear-results-btn").addEventListener("click", async () => {
    syncResultsFormFromData({});
    await saveActualResults({});
    setStatus(resultsStatus, "已清空開票數據。", "success");
  });

  // Submit actual results
  resultsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const parsed = readCitiesFromForm("res", { requireAll: false });
    if (parsed.error) {
      setStatus(resultsStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    const submitBtn = document.getElementById("submit-results-btn");
    submitBtn.disabled = true;
    try {
      await saveActualResults(parsed.data);
      const count = Object.keys(parsed.data).length;
      setStatus(resultsStatus, `已更新 ${count} 個縣市的開票結果，排行榜已即時重新結算！`, "success");
    } catch (err) {
      setStatus(resultsStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Reset local storage
  resetLocalBtn.addEventListener("click", () => {
    clearLocalData();
    syncResultsFormFromData({});
    setStatus(resultsStatus, "已清除本機所有試玩資料。", "success");
  });
}

function fillRandomCities(prefix) {
  for (const city of CONSTITUENCIES) {
    const weights = city.candidates.map(() => 15 + Math.random() * 50);
    const total = weights.reduce((a, b) => a + b, 0);
    let running = 0;
    let bestCand = city.candidates[0].id;
    let bestShare = -1;

    city.candidates.forEach((cand, idx) => {
      let share;
      if (idx === city.candidates.length - 1) {
        share = Number((100 - running).toFixed(1));
      } else {
        share = Number(((weights[idx] / total) * 100).toFixed(1));
        running += share;
      }
      setCandidateShare(prefix, city.id, cand.id, share);
      if (share > bestShare) {
        bestShare = share;
        bestCand = cand.id;
      }
    });

    const radio = document.querySelector(`input[name="${prefix}-winner-${city.id}"][value="${bestCand}"]`);
    if (radio) radio.checked = true;
    updateCitySum(prefix, city);
  }
}

function syncResultsFormFromData(citiesMap) {
  for (const city of CONSTITUENCIES) {
    const saved = citiesMap?.[city.id];
    const radios = document.querySelectorAll(`input[name="res-winner-${city.id}"]`);
    radios.forEach((r) => {
      r.checked = saved ? r.value === saved.winnerId : false;
    });
    for (const cand of city.candidates) {
      const share = saved?.shares?.[cand.id] ?? 0;
      setCandidateShare("res", city.id, cand.id, share);
    }
    updateCitySum("res", city);
  }
}

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `status-banner ${type === "error" ? "status-error" : "status-success"}`;
}

// 5. Leaderboard Rendering
function renderLeaderboard() {
  const openedCount = Object.keys(currentActualResults?.cities || {}).length;
  leaderboardSummary.textContent =
    openedCount === 0
      ? `目前共有 ${currentPredictions.length} 位玩家完成預測（尚未輸入開票結果，請至「開票結果輸入」手動輸入或模擬試玩）。`
      : `目前已開票 ${openedCount} / ${CONSTITUENCIES.length} 縣市，共有 ${currentPredictions.length} 位玩家參與排名。`;

  leaderboardTbody.replaceChildren();

  if (currentPredictions.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "目前還沒有任何玩家預測，快到「1. 我要預測」搶頭香吧！";
    tr.appendChild(td);
    leaderboardTbody.appendChild(tr);
    return;
  }

  const ranked = currentPredictions
    .map((pred) => ({
      pred,
      summary: calculatePlayerSummary(pred, currentActualResults)
    }))
    .sort((a, b) => {
      if (b.summary.totalScore !== a.summary.totalScore) {
        return b.summary.totalScore - a.summary.totalScore;
      }
      if (a.summary.totalError !== b.summary.totalError) {
        return a.summary.totalError - b.summary.totalError;
      }
      return b.summary.winnerHits - a.summary.winnerHits;
    });

  ranked.forEach(({ pred, summary }, index) => {
    const tr = document.createElement("tr");

    const rankTd = document.createElement("td");
    rankTd.textContent = `#${index + 1}`;

    const nameTh = document.createElement("th");
    nameTh.scope = "row";
    nameTh.textContent = pred.nickname;

    const hitsTd = document.createElement("td");
    hitsTd.textContent = openedCount > 0 ? `${summary.winnerHits} / ${summary.scoredCities}` : "待開票";

    const errTd = document.createElement("td");
    errTd.textContent = openedCount > 0 ? `± ${summary.totalError}%` : "—";

    const scoreTd = document.createElement("td");
    scoreTd.className = "score-highlight";
    scoreTd.textContent = openedCount > 0 ? `${summary.totalScore} 分` : "—";

    const actionTd = document.createElement("td");
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "btn btn-sm btn-secondary";
    detailBtn.textContent = "查看明細";
    detailBtn.addEventListener("click", () => openPlayerDetail(pred, summary));
    actionTd.appendChild(detailBtn);

    tr.append(rankTd, nameTh, hitsTd, errTd, scoreTd, actionTd);
    leaderboardTbody.appendChild(tr);
  });
}

// 6. Dialogs
function setupDialogs() {
  document.getElementById("open-guide-btn").addEventListener("click", () => {
    guideDialog.showModal();
  });

  [detailDialog, guideDialog].forEach((dlg) => {
    dlg.addEventListener("close", () => {
      dlg.returnValue = "";
    });
  });

  // Fallback for browsers without closedby="any" (e.g. Safari)
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

function openPlayerDetail(pred, summary) {
  detailDialogTitle.textContent = `${pred.nickname} 的預測明細（總分：${summary.totalScore} 分）`;
  detailDialogBody.replaceChildren();

  for (const city of CONSTITUENCIES) {
    const block = document.createElement("div");
    block.className = "detail-city-block";

    const header = document.createElement("div");
    header.className = "detail-city-header";

    const cityName = document.createElement("span");
    cityName.textContent = city.name;

    const cityResult = summary.breakdown[city.id];
    const badge = document.createElement("span");
    if (cityResult) {
      badge.textContent = `${cityResult.winnerHit ? "猜中當選人" : "未中當選人"}｜誤差 ${cityResult.errorSum}%｜得分 ${cityResult.totalPoints}`;
      badge.style.color = cityResult.winnerHit ? "var(--success)" : "var(--danger)";
    } else {
      badge.textContent = "尚未開票";
      badge.style.color = "var(--text-muted)";
    }

    header.append(cityName, badge);
    block.appendChild(header);

    const list = document.createElement("ul");
    list.className = "detail-list";

    const predCity = pred.cities?.[city.id];
    const actualCity = currentActualResults?.cities?.[city.id];

    for (const cand of city.candidates) {
      const li = document.createElement("li");
      const pShare = predCity?.shares?.[cand.id] ?? 0;
      const isPredWin = predCity?.winnerId === cand.id ? "（預測當選）" : "";
      if (actualCity && actualCity.winnerId) {
        const aShare = actualCity.shares?.[cand.id] ?? 0;
        const isActWin = actualCity.winnerId === cand.id ? "【實際當選】" : "";
        const diff = Math.abs(pShare - aShare).toFixed(1);
        li.textContent = `${cand.name}：預測 ${pShare}%${isPredWin} vs 實際 ${aShare}%${isActWin}（差 ${diff}%）`;
      } else {
        li.textContent = `${cand.name}：預測 ${pShare}%${isPredWin}`;
      }
      list.appendChild(li);
    }

    block.appendChild(list);
    detailDialogBody.appendChild(block);
  }

  detailDialog.showModal();
}

bootstrap();
