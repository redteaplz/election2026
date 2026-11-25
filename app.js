import {
  CONSTITUENCIES,
  OFFICIAL_LOCK_ISO,
  calculatePlayerSummary,
  isGameLocked,
  formatLockTime
} from "./data.js";
import { adminEmail } from "./firebase-config.js";
import {
  initStorage,
  subscribeAuthState,
  signInAdmin,
  signOutAdmin,
  subscribeGames,
  createGame,
  deleteGame,
  saveGamePrediction,
  subscribeGamePredictions,
  saveTestGameResults,
  saveOfficialResults,
  subscribeOfficialResults,
  clearLocalData
} from "./firebase-service.js";

// App state
let storageMode = "local";
let allGames = [];
let activeGameId = null;
let currentPredictions = [];
let officialResults = { cities: {} };
let unsubscribePredictions = null;
let currentAdminUser = null;
let isAuthorizedAdmin = false;

const urlParams = new URLSearchParams(window.location.search);
const isAdminRoute = urlParams.get("admin") === "1";
const initialGameId = urlParams.get("game");

// DOM elements
const storageBadge = document.getElementById("storage-badge");
const adminAuthBtn = document.getElementById("admin-auth-btn");

const navButtons = document.querySelectorAll(".nav-btn");
const navPredictBtn = document.getElementById("nav-predict-btn");
const navResultsBtn = document.getElementById("nav-results-btn");
const navLeaderboardBtn = document.getElementById("nav-leaderboard-btn");

const viewSections = {
  lobby: document.getElementById("view-lobby"),
  predict: document.getElementById("view-predict"),
  results: document.getElementById("view-results"),
  leaderboard: document.getElementById("view-leaderboard")
};

// Active game bar
const activeGameBar = document.getElementById("active-game-bar");
const activeGameTypeBadge = document.getElementById("active-game-type-badge");
const activeGameTitle = document.getElementById("active-game-title");
const activeGameLockBadge = document.getElementById("active-game-lock-badge");
const copyGameLinkBtn = document.getElementById("copy-game-link-btn");
const backToLobbyBtn = document.getElementById("back-to-lobby-btn");

// Lobby & Admin Create Game
const adminCreatePanel = document.getElementById("admin-create-panel");
const createGameForm = document.getElementById("create-game-form");
const newGameTitleInput = document.getElementById("new-game-title");
const lockTimeField = document.getElementById("lock-time-field");
const newGameLockAtInput = document.getElementById("new-game-lock-at");
const createGameStatus = document.getElementById("create-game-status");
const gamesListGrid = document.getElementById("games-list-grid");

// Predict form
const lockNoticeBanner = document.getElementById("lock-notice-banner");
const predictForm = document.getElementById("predict-form");
const nicknameInput = document.getElementById("player-nickname");
const nicknameError = document.getElementById("nickname-error");
const predictCitiesGrid = document.getElementById("predict-cities-grid");
const predictStatus = document.getElementById("predict-status");
const submitPredictBtn = document.getElementById("submit-predict-btn");

// Results form
const resultsModeDesc = document.getElementById("results-mode-desc");
const simulateResultsBtn = document.getElementById("simulate-results-btn");
const resultsForm = document.getElementById("results-form");
const resultsCitiesGrid = document.getElementById("results-cities-grid");
const resultsStatus = document.getElementById("results-status");

// Leaderboard
const leaderboardSummary = document.getElementById("leaderboard-summary");
const leaderboardTbody = document.getElementById("leaderboard-tbody");
const resetLocalBtn = document.getElementById("reset-local-btn");

// Dialog
const detailDialog = document.getElementById("detail-dialog");
const detailDialogTitle = document.getElementById("detail-dialog-title");
const detailDialogBody = document.getElementById("detail-dialog-body");

function getActiveGame() {
  return allGames.find((g) => g.id === activeGameId) || null;
}

function getActiveGameResults() {
  const game = getActiveGame();
  if (!game) return { cities: {} };
  if (game.type === "official") {
    return officialResults || { cities: {} };
  }
  return game.testResults || { cities: {} };
}

// 1. Initialize app
async function bootstrap() {
  const { mode } = await initStorage();
  storageMode = mode;

  if (mode === "firebase") {
    storageBadge.textContent = "Firebase 雲端連線中";
    storageBadge.className = "badge badge-firebase";
    resetLocalBtn.hidden = true;
    setupAdminAuth();
  } else {
    storageBadge.textContent = "本機試玩模式 (LocalStorage)";
    storageBadge.className = "badge badge-local";
    isAuthorizedAdmin = isAdminRoute;
    storageBadge.hidden = !isAdminRoute;
    resetLocalBtn.hidden = !isAdminRoute;
    updateAdminVisibility();
  }

  renderCityCards(predictCitiesGrid, "pred");
  renderCityCards(resultsCitiesGrid, "res");
  setupNavigation();
  setupAdminCreateHandlers();
  setupFormHandlers();
  setupDialogs();

  subscribeOfficialResults((data) => {
    officialResults = data || { cities: {} };
    const active = getActiveGame();
    if (active && active.type === "official") {
      syncResultsFormFromData(officialResults.cities || {});
      renderLeaderboard();
    }
  });

  let handledInitialRoute = false;
  subscribeGames((list) => {
    allGames = list;
    renderLobby();

    if (!handledInitialRoute && initialGameId) {
      handledInitialRoute = true;
      if (allGames.some((g) => g.id === initialGameId)) {
        enterGame(initialGameId, "predict");
        return;
      }
    }

    if (activeGameId) {
      const active = getActiveGame();
      if (!active) {
        leaveGame();
      } else {
        updateActiveGameUI();
        if (active.type === "test") {
          syncResultsFormFromData(active.testResults?.cities || {});
        }
        renderLeaderboard();
      }
    }
  });

  // Periodic lock-status refresh (auto-locks official games at 16:00)
  setInterval(() => {
    renderLobby();
    if (activeGameId) {
      updateActiveGameUI();
    }
  }, 30000);
}

function setupAdminAuth() {
  adminAuthBtn.addEventListener("click", async () => {
    try {
      if (currentAdminUser) {
        await signOutAdmin();
      } else {
        await signInAdmin();
      }
    } catch (err) {
      alert(`登入操作失敗：${err.message}`);
    }
  });

  subscribeAuthState((user) => {
    currentAdminUser = user;
    isAuthorizedAdmin = Boolean(
      user && adminEmail && user.email?.toLowerCase() === adminEmail.toLowerCase()
    );

    const showAdminControls = isAdminRoute || Boolean(user);
    adminAuthBtn.hidden = !showAdminControls;
    storageBadge.hidden = !(isAdminRoute || isAuthorizedAdmin);

    if (user) {
      adminAuthBtn.textContent = isAuthorizedAdmin
        ? `登出管理員 (${user.email})`
        : `非管理員 (${user.email})｜登出`;
    } else {
      adminAuthBtn.textContent = "管理員 Google 登入";
    }

    updateAdminVisibility();
  });
}

function updateAdminVisibility() {
  adminCreatePanel.hidden = !isAuthorizedAdmin;
  navResultsBtn.hidden = !(isAuthorizedAdmin && activeGameId);
  if (!isAuthorizedAdmin && !viewSections.results.hidden) {
    switchView(activeGameId ? "predict" : "lobby");
  }
  renderLobby();
}

// 2. Navigation & Game Switching
function setupNavigation() {
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
    });
  });

  backToLobbyBtn.addEventListener("click", () => {
    leaveGame();
  });

  copyGameLinkBtn.addEventListener("click", async () => {
    if (!activeGameId) return;
    await copyGameInviteUrl(activeGameId, copyGameLinkBtn);
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

function enterGame(gameId, defaultView = "predict") {
  activeGameId = gameId;

  // Update URL without losing ?admin=1
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("game", gameId);
  window.history.replaceState({}, "", nextUrl);

  navPredictBtn.hidden = false;
  navLeaderboardBtn.hidden = false;
  navResultsBtn.hidden = !isAuthorizedAdmin;
  activeGameBar.hidden = false;

  if (unsubscribePredictions) {
    unsubscribePredictions();
    unsubscribePredictions = null;
  }
  currentPredictions = [];
  unsubscribePredictions = subscribeGamePredictions(gameId, (list) => {
    currentPredictions = list;
    renderLeaderboard();
  });

  updateActiveGameUI();
  const activeResults = getActiveGameResults();
  syncResultsFormFromData(activeResults.cities || {});
  renderLeaderboard();

  const game = getActiveGame();
  const targetView = game && isGameLocked(game) && defaultView === "predict" ? "leaderboard" : defaultView;
  switchView(targetView);
}

function leaveGame() {
  activeGameId = null;
  if (unsubscribePredictions) {
    unsubscribePredictions();
    unsubscribePredictions = null;
  }
  currentPredictions = [];

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete("game");
  window.history.replaceState({}, "", nextUrl);

  navPredictBtn.hidden = true;
  navResultsBtn.hidden = true;
  navLeaderboardBtn.hidden = true;
  activeGameBar.hidden = true;

  switchView("lobby");
}

function updateActiveGameUI() {
  const game = getActiveGame();
  if (!game) return;

  const isOfficial = game.type === "official";
  const locked = isGameLocked(game);

  activeGameTitle.textContent = game.title;
  activeGameTypeBadge.textContent = isOfficial ? "正式賽局" : "測試賽局";
  activeGameTypeBadge.className = `game-pill ${isOfficial ? "game-pill-official" : "game-pill-test"}`;

  if (isOfficial) {
    activeGameLockBadge.textContent = locked
      ? `已於 ${formatLockTime(game.lockAt)} 鎖單`
      : `開放預測中（${formatLockTime(game.lockAt)} 鎖單）`;
    activeGameLockBadge.className = `lock-pill ${locked ? "lock-pill-locked" : "lock-pill-open"}`;
  } else {
    activeGameLockBadge.textContent = "測試賽局（不鎖單）";
    activeGameLockBadge.className = "lock-pill lock-pill-open";
  }

  // Lock predict form if official game is past lock time
  lockNoticeBanner.hidden = !locked;
  submitPredictBtn.hidden = locked;
  predictForm.querySelectorAll("input, button[type='submit']").forEach((el) => {
    el.disabled = locked;
  });

  // Results mode description & safeguard
  if (isOfficial) {
    resultsModeDesc.textContent =
      "本局為【正式賽局】：預設讀取 Firebase 官方開票結果（official_results/2026）。管理員可於此手動更新官方結果以防萬一，儲存後將同步結算所有正式賽局！";
    simulateResultsBtn.hidden = true;
  } else {
    resultsModeDesc.textContent =
      "本局為【測試賽局】：這裡輸入或隨機模擬的結果僅套用於本賽局，不會影響其他正式或測試賽局。";
    simulateResultsBtn.hidden = false;
  }
}

async function copyGameInviteUrl(gameId, btnEl) {
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.delete("admin");
  inviteUrl.searchParams.set("game", gameId);
  const urlText = inviteUrl.toString();
  const originalText = btnEl.textContent;
  try {
    await navigator.clipboard.writeText(urlText);
    btnEl.textContent = "已複製連結！";
    setTimeout(() => {
      btnEl.textContent = originalText;
    }, 1800);
  } catch {
    prompt("請複製以下賽局連結：", urlText);
  }
}

// 3. Lobby Rendering & Admin Create Game
function setupAdminCreateHandlers() {
  const typeRadios = document.querySelectorAll('input[name="new-game-type"]');
  typeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      lockTimeField.hidden = radio.value !== "official";
    });
  });

  createGameForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = newGameTitleInput.value.trim();
    if (!title) {
      setStatus(createGameStatus, "請輸入賽局名稱。", "error");
      newGameTitleInput.focus();
      return;
    }

    const selectedType = document.querySelector('input[name="new-game-type"]:checked')?.value || "test";
    let lockAt = null;
    if (selectedType === "official") {
      const rawVal = newGameLockAtInput.value;
      lockAt = rawVal ? `${rawVal}:00+08:00` : OFFICIAL_LOCK_ISO;
    }

    const createBtn = document.getElementById("create-game-btn");
    createBtn.disabled = true;
    try {
      const created = await createGame({ title, type: selectedType, lockAt });
      newGameTitleInput.value = "";
      setStatus(createGameStatus, `已成功開啟「${created.title}」！`, "success");
    } catch (err) {
      setStatus(createGameStatus, `建立失敗：${err.message}`, "error");
    } finally {
      createBtn.disabled = false;
    }
  });
}

function renderLobby() {
  gamesListGrid.replaceChildren();

  if (allGames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-lobby-card";
    empty.textContent = isAuthorizedAdmin
      ? "目前還沒有開啟任何賽局，請使用上方「管理員控制台」建立第一場賽局！"
      : "目前尚未開放賽局，請稍候再來！";
    gamesListGrid.appendChild(empty);
    return;
  }

  for (const game of allGames) {
    const isOfficial = game.type === "official";
    const locked = isGameLocked(game);

    const card = document.createElement("article");
    card.className = `game-card ${isOfficial ? "game-card-official" : ""}`;

    const badges = document.createElement("div");
    badges.className = "game-card-badges";

    const typePill = document.createElement("span");
    typePill.className = `game-pill ${isOfficial ? "game-pill-official" : "game-pill-test"}`;
    typePill.textContent = isOfficial ? "正式賽局" : "測試賽局";

    const lockPill = document.createElement("span");
    lockPill.className = `lock-pill ${locked ? "lock-pill-locked" : "lock-pill-open"}`;
    lockPill.textContent = isOfficial
      ? locked
        ? "已鎖單・開票結算中"
        : "開放預測中"
      : "測試不鎖單";

    badges.append(typePill, lockPill);

    const title = document.createElement("h3");
    title.className = "game-card-title";
    title.textContent = game.title;

    const meta = document.createElement("p");
    meta.className = "game-card-meta";
    meta.textContent = isOfficial
      ? `官方開票同步｜截止時間：${formatLockTime(game.lockAt)}`
      : "獨立開票測試場（不影響正式賽局）";

    const actions = document.createElement("div");
    actions.className = "game-card-actions";

    const enterBtn = document.createElement("button");
    enterBtn.type = "button";
    enterBtn.className = "btn btn-primary btn-enter";
    enterBtn.textContent = locked ? "查看排行榜" : "進入賽局";
    enterBtn.addEventListener("click", () => {
      enterGame(game.id, locked ? "leaderboard" : "predict");
    });
    actions.appendChild(enterBtn);

    if (isAuthorizedAdmin) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-sm btn-secondary";
      copyBtn.textContent = "複製連結";
      copyBtn.addEventListener("click", () => copyGameInviteUrl(game.id, copyBtn));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-sm btn-outline-danger";
      delBtn.textContent = "刪除";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`確定要刪除賽局「${game.title}」嗎？`)) return;
        try {
          await deleteGame(game.id);
        } catch (err) {
          alert(`刪除失敗：${err.message}`);
        }
      });

      actions.append(copyBtn, delBtn);
    }

    card.append(badges, title, meta, actions);
    gamesListGrid.appendChild(card);
  }
}

// 4. Shared City Card Renderer
function renderCityCards(container, prefix) {
  container.replaceChildren();

  for (const city of CONSTITUENCIES) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = city.type === "yesno" ? "city-card city-special" : "city-card";
    fieldset.dataset.cityId = city.id;

    const legend = document.createElement("legend");
    legend.textContent = city.name;
    fieldset.appendChild(legend);

    if (city.subtitle) {
      const sub = document.createElement("p");
      sub.className = "city-subtitle";
      sub.textContent = city.subtitle;
      fieldset.appendChild(sub);
    }

    const list = document.createElement("div");
    list.className = "candidates-list";

    for (const cand of city.candidates) {
      const label = document.createElement("label");
      label.className = "candidate-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `${prefix}-winner-${city.id}`;
      radio.value = cand.id;

      const dot = document.createElement("span");
      dot.className = "party-dot";
      dot.style.backgroundColor = cand.color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = cand.name;

      label.append(radio, dot, nameSpan);
      list.appendChild(label);
    }
    fieldset.appendChild(list);

    if (city.type === "mayor") {
      const shareBox = document.createElement("div");
      shareBox.className = "winner-share-box";

      const shareInputId = `${prefix}-share-${city.id}`;
      const shareLabel = document.createElement("label");
      shareLabel.className = "winner-share-label";
      shareLabel.htmlFor = shareInputId;
      shareLabel.textContent = prefix === "res" ? "實際當選人得票率" : "預測當選人得票率";

      const controls = document.createElement("div");
      controls.className = "share-controls";

      const range = document.createElement("input");
      range.type = "range";
      range.className = "share-range";
      range.id = `${prefix}-range-${city.id}`;
      range.min = "0";
      range.max = "100";
      range.step = "0.5";
      range.value = "50";
      range.setAttribute("aria-label", `${city.name} 當選人得票率滑桿`);

      const numWrap = document.createElement("div");
      numWrap.className = "share-number-wrap";

      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.inputMode = "decimal";
      numInput.className = "share-number";
      numInput.id = shareInputId;
      numInput.min = "0";
      numInput.max = "100";
      numInput.step = "0.1";
      numInput.value = "50";

      const pctSymbol = document.createElement("span");
      pctSymbol.textContent = "%";

      numWrap.append(numInput, pctSymbol);
      controls.append(range, numWrap);
      shareBox.append(shareLabel, controls);
      fieldset.appendChild(shareBox);

      range.addEventListener("input", () => {
        numInput.value = range.value;
      });

      numInput.addEventListener("input", () => {
        range.value = String(clampShare(numInput.value));
      });

      numInput.addEventListener("blur", () => {
        const val = clampShare(numInput.value);
        numInput.value = String(val);
        range.value = String(val);
      });
    }

    container.appendChild(fieldset);
  }
}

function clampShare(raw) {
  const num = Number.parseFloat(raw);
  if (Number.isNaN(num) || num < 0) return 0;
  if (num > 100) return 100;
  return Number(num.toFixed(1));
}

function setCityShare(prefix, cityId, value) {
  const numInput = document.getElementById(`${prefix}-share-${cityId}`);
  const range = document.getElementById(`${prefix}-range-${cityId}`);
  if (numInput) numInput.value = String(value);
  if (range) range.value = String(value);
}

function readCitiesFromForm(prefix, { requireAll }) {
  const citiesData = {};
  for (const city of CONSTITUENCIES) {
    const winnerEl = document.querySelector(`input[name="${prefix}-winner-${city.id}"]:checked`);
    if (!winnerEl) {
      if (requireAll) {
        return {
          error: `請選擇「${city.name}」的預測選項。`,
          focusEl: document.querySelector(`input[name="${prefix}-winner-${city.id}"]`)
        };
      }
      continue;
    }

    if (city.type === "yesno") {
      citiesData[city.id] = { winnerId: winnerEl.value };
    } else {
      const shareInput = document.getElementById(`${prefix}-share-${city.id}`);
      const winnerShare = clampShare(shareInput.value);
      if (winnerShare <= 0 || winnerShare > 100) {
        return {
          error: `請輸入「${city.name}」有效的得票率（1% ~ 100%）。`,
          focusEl: shareInput
        };
      }
      citiesData[city.id] = {
        winnerId: winnerEl.value,
        winnerShare
      };
    }
  }
  return { data: citiesData, error: null };
}

// 5. Form Handlers
function setupFormHandlers() {
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

  // Submit prediction
  predictForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const game = getActiveGame();
    if (!game) {
      setStatus(predictStatus, "請先從賽局大廳選擇一場賽局。", "error");
      return;
    }
    if (isGameLocked(game)) {
      updateActiveGameUI();
      setStatus(predictStatus, "此正式賽局已截止鎖單，無法送出或修改預測。", "error");
      return;
    }

    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      nicknameInput.setAttribute("aria-invalid", "true");
      nicknameError.textContent = "請先輸入玩家暱稱。";
      nicknameInput.focus();
      setStatus(predictStatus, "請先輸入玩家暱稱再送出。", "error");
      return;
    }

    const parsed = readCitiesFromForm("pred", { requireAll: true });
    if (parsed.error) {
      setStatus(predictStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    submitPredictBtn.disabled = true;
    try {
      await saveGamePrediction(game.id, nickname, parsed.data);
      setStatus(predictStatus, `已成功儲存「${nickname}」在「${game.title}」的預測！`, "success");
    } catch (err) {
      setStatus(predictStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitPredictBtn.disabled = isGameLocked(game);
    }
  });

  // Simulate random actual results (Test games only)
  simulateResultsBtn.addEventListener("click", () => {
    fillRandomResults();
    setStatus(resultsStatus, "已隨機產生模擬開票數據，點擊「儲存開票結果並結算分數」即可看排名！", "success");
  });

  // Clear results (Admin)
  document.getElementById("clear-results-btn").addEventListener("click", async () => {
    const game = getActiveGame();
    if (!game) return;
    syncResultsFormFromData({});
    try {
      if (game.type === "official") {
        await saveOfficialResults({});
      } else {
        await saveTestGameResults(game.id, {});
      }
      setStatus(resultsStatus, "已清空開票數據。", "success");
    } catch (err) {
      setStatus(resultsStatus, `清空失敗：${err.message}`, "error");
    }
  });

  // Submit actual results (Admin)
  resultsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const game = getActiveGame();
    if (!game) return;

    const parsed = readCitiesFromForm("res", { requireAll: false });
    if (parsed.error) {
      setStatus(resultsStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    const submitBtn = document.getElementById("submit-results-btn");
    submitBtn.disabled = true;
    try {
      if (game.type === "official") {
        await saveOfficialResults(parsed.data);
        setStatus(
          resultsStatus,
          `已更新官方開票結果（共 ${Object.keys(parsed.data).length} 題），所有正式賽局已即時重新結算！`,
          "success"
        );
      } else {
        await saveTestGameResults(game.id, parsed.data);
        setStatus(
          resultsStatus,
          `已更新本測試賽局結果（共 ${Object.keys(parsed.data).length} 題），本局排行榜已重新結算！`,
          "success"
        );
      }
    } catch (err) {
      setStatus(resultsStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Reset local storage
  resetLocalBtn.addEventListener("click", () => {
    clearLocalData();
    leaveGame();
  });
}

function fillRandomResults() {
  for (const city of CONSTITUENCIES) {
    const pick = city.candidates[Math.floor(Math.random() * city.candidates.length)];
    const radio = document.querySelector(`input[name="res-winner-${city.id}"][value="${pick.id}"]`);
    if (radio) radio.checked = true;
    if (city.type === "mayor") {
      const share = Number((42 + Math.random() * 20).toFixed(1));
      setCityShare("res", city.id, share);
    }
  }
}

function syncResultsFormFromData(citiesMap) {
  for (const city of CONSTITUENCIES) {
    const saved = citiesMap?.[city.id];
    const radios = document.querySelectorAll(`input[name="res-winner-${city.id}"]`);
    radios.forEach((r) => {
      r.checked = saved ? r.value === saved.winnerId : false;
    });
    if (city.type === "mayor") {
      setCityShare("res", city.id, saved?.winnerShare ?? 50);
    }
  }
}

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `status-banner ${type === "error" ? "status-error" : "status-success"}`;
}

// 6. Leaderboard Rendering
function renderLeaderboard() {
  const game = getActiveGame();
  const activeResults = getActiveGameResults();
  const openedCount = Object.keys(activeResults?.cities || {}).length;

  leaderboardSummary.textContent = !game
    ? "請先選擇賽局。"
    : openedCount === 0
      ? `「${game.title}」目前共有 ${currentPredictions.length} 位玩家完成預測（尚未開票）。`
      : `「${game.title}」目前已開票 ${openedCount} / ${CONSTITUENCIES.length} 題，共有 ${currentPredictions.length} 位玩家參與排名。`;

  leaderboardTbody.replaceChildren();

  if (currentPredictions.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "本賽局還沒有任何玩家預測，快到「我要預測」搶頭香吧！";
    tr.appendChild(td);
    leaderboardTbody.appendChild(tr);
    return;
  }

  const ranked = currentPredictions
    .map((pred) => ({
      pred,
      summary: calculatePlayerSummary(pred, activeResults)
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

// 7. Dialogs
function setupDialogs() {
  detailDialog.addEventListener("close", () => {
    detailDialog.returnValue = "";
  });

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    detailDialog.addEventListener("pointerdown", (e) => {
      pressedOutside = outside(e, detailDialog);
    });
    detailDialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && outside(e, detailDialog)) detailDialog.close();
    });
  }
}

function getCandidateName(city, candId) {
  return city.candidates.find((c) => c.id === candId)?.name ?? "未選擇";
}

function openPlayerDetail(pred, summary) {
  const activeResults = getActiveGameResults();
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
      if (city.type === "yesno") {
        badge.textContent = `${cityResult.winnerHit ? "預測成功" : "預測失敗"}｜+${cityResult.totalPoints} 分`;
      } else {
        badge.textContent = `${cityResult.winnerHit ? "猜中當選人" : "未中當選人"}｜誤差 ${cityResult.errorSum}%｜+${cityResult.totalPoints} 分`;
      }
      badge.style.color = cityResult.winnerHit ? "var(--success)" : "var(--danger)";
    } else {
      badge.textContent = "尚未開票";
      badge.style.color = "var(--text-muted)";
    }

    header.append(cityName, badge);
    block.appendChild(header);

    const predCity = pred.cities?.[city.id];
    const actualCity = activeResults?.cities?.[city.id];

    const predLine = document.createElement("p");
    predLine.className = "detail-line";
    const predName = getCandidateName(city, predCity?.winnerId);
    predLine.textContent =
      city.type === "yesno"
        ? `玩家預測：${predName}`
        : `玩家預測：${predName}（${predCity?.winnerShare ?? 0}%）`;
    block.appendChild(predLine);

    if (actualCity && actualCity.winnerId) {
      const actualLine = document.createElement("p");
      actualLine.className = "detail-line";
      const actualName = getCandidateName(city, actualCity.winnerId);
      actualLine.textContent =
        city.type === "yesno"
          ? `實際結果：${actualName}`
          : `實際結果：${actualName}（${actualCity.winnerShare ?? 0}%）`;
      block.appendChild(actualLine);
    }

    detailDialogBody.appendChild(block);
  }

  detailDialog.showModal();
}

bootstrap();
