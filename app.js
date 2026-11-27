import {
  CONSTITUENCIES,
  OFFICIAL_LOCK_ISO,
  RESULT_SOURCES,
  calculatePlayerSummary,
  getGameResultSource,
  getResultSourceLabel,
  isGameLocked,
  isGameSettled,
  resolveCityOutcome,
  shouldConnectFirebaseResults,
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
  normalizeNicknameId,
  saveGamePrediction,
  subscribeGamePredictions,
  saveTestGameResults,
  settleOfficialGame,
  subscribeOfficialResults,
  subscribeSimulatedResults,
  clearLocalData
} from "./firebase-service.js";

const PLAYER_TOKEN_KEY = "election2026_player_token";
const MY_NICKNAME_KEY = "election2026_my_nickname";

function getOrCreatePlayerToken() {
  let token = localStorage.getItem(PLAYER_TOKEN_KEY);
  if (!token) {
    token =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PLAYER_TOKEN_KEY, token);
  }
  return token;
}

function getSavedNickname() {
  return localStorage.getItem(MY_NICKNAME_KEY) || "";
}

// App state
let storageMode = "local";
let allGames = [];
let activeGameId = null;
let currentPredictions = [];
let predictionsLoaded = false;
let isPredictFormDirty = false;
let isResultsFormDirty = false;
let officialResults = { cities: {} };
let simulatedResults = { cities: {}, isSimulated: true };
let unsubscribePredictions = null;
let unsubscribeOfficialResults = null;
let unsubscribeSimulatedResults = null;
let currentAdminUser = null;
let isAuthorizedAdmin = false;
const expandedResultCities = new Set();

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
const historyGamesSection = document.getElementById("history-games-section");
const historyGamesGrid = document.getElementById("history-games-grid");

// Predict form
const lockNoticeBanner = document.getElementById("lock-notice-banner");
const predictForm = document.getElementById("predict-form");
const nicknameInput = document.getElementById("player-nickname");
const nicknameError = document.getElementById("nickname-error");
const predictCitiesGrid = document.getElementById("predict-cities-grid");
const predictStatus = document.getElementById("predict-status");
const submitPredictBtn = document.getElementById("submit-predict-btn");

// Results form
const resultsSettledBanner = document.getElementById("results-settled-banner");
const resultsModeDesc = document.getElementById("results-mode-desc");
const simulateResultsBtn = document.getElementById("simulate-results-btn");
const clearResultsBtn = document.getElementById("clear-results-btn");
const resultsForm = document.getElementById("results-form");
const resultsCitiesGrid = document.getElementById("results-cities-grid");
const resultsStatus = document.getElementById("results-status");
const saveDraftResultsBtn = document.getElementById("save-draft-results-btn");
const submitResultsBtn = document.getElementById("submit-results-btn");

// Leaderboard & Live Results
const leaderboardSummary = document.getElementById("leaderboard-summary");
const leaderboardList = document.getElementById("leaderboard-list");
const leaderboardMaxScore = document.getElementById("leaderboard-max-score");
const resetLocalBtn = document.getElementById("reset-local-btn");
const liveIndicator = document.getElementById("live-indicator");
const liveIndicatorText = document.getElementById("live-indicator-text");
const liveSourceLabel = document.getElementById("live-source-label");
const liveProgressWrap = document.getElementById("live-progress-wrap");
const liveProgressText = document.getElementById("live-progress-text");
const liveProgressBar = document.getElementById("live-progress-bar");
const liveProgressFill = document.getElementById("live-progress-fill");
const liveResultsUpdated = document.getElementById("live-results-updated");
const liveResultsGrid = document.getElementById("live-results-grid");

// Dialog
const detailDialog = document.getElementById("detail-dialog");
const detailDialogTitle = document.getElementById("detail-dialog-title");
const detailDialogBody = document.getElementById("detail-dialog-body");

function getActiveGame() {
  return allGames.find((g) => g.id === activeGameId) || null;
}

function getRawDbResultsForGame(game) {
  if (!game || !shouldConnectFirebaseResults(game)) return null;
  const source = getGameResultSource(game);
  if (source === RESULT_SOURCES.OFFICIAL_DB) return officialResults || { cities: {} };
  if (source === RESULT_SOURCES.SIM_DB) return simulatedResults || { cities: {}, isSimulated: true };
  return null;
}

function getActiveGameResults() {
  const game = getActiveGame();
  if (!game) return { cities: {} };
  if (game.settledResults?.cities && Object.keys(game.settledResults.cities).length > 0) {
    return game.settledResults;
  }
  const hasManualOverride = Object.keys(game.testResults?.cities || {}).length > 0;
  if (hasManualOverride) {
    return { ...game.testResults, isManualOverride: true };
  }
  const source = getGameResultSource(game);
  if (source === RESULT_SOURCES.MANUAL) {
    return game.testResults || { cities: {} };
  }
  if (!shouldConnectFirebaseResults(game)) {
    return {
      cities: {},
      isSimulated: source === RESULT_SOURCES.SIM_DB,
      waitingForLock: true
    };
  }
  if (source === RESULT_SOURCES.OFFICIAL_DB) {
    return officialResults || { cities: {} };
  }
  return simulatedResults || { cities: {}, isSimulated: true };
}

function maybeSyncResultsForm(citiesMap) {
  if (!isResultsFormDirty || viewSections.results.hidden) {
    syncResultsFormFromData(citiesMap || {});
  }
}

/**
 * 動態管理 Firebase 開票資料庫連線（僅針對當前進入的賽局按需訂閱，避免大廳或其他賽局消耗額外讀取）：
 * - 正式賽局在鎖單時間到達後才開始連接 Firebase 開票資料
 * - 測試賽局若選擇 Firebase 來源則立即連線
 * - 純手動、未進入賽局或已結算賽局不建立開票資料連線
 */
function syncLiveResultSubscriptions() {
  const active = getActiveGame();
  const needOfficial = Boolean(
    active &&
      getGameResultSource(active) === RESULT_SOURCES.OFFICIAL_DB &&
      shouldConnectFirebaseResults(active)
  );
  const needSim = Boolean(
    active &&
      getGameResultSource(active) === RESULT_SOURCES.SIM_DB &&
      shouldConnectFirebaseResults(active)
  );

  if (needOfficial && !unsubscribeOfficialResults) {
    unsubscribeOfficialResults = subscribeOfficialResults((data) => {
      officialResults = data || { cities: {} };
      const curr = getActiveGame();
      if (curr && getGameResultSource(curr) === RESULT_SOURCES.OFFICIAL_DB && shouldConnectFirebaseResults(curr)) {
        updateActiveGameUI();
        maybeSyncResultsForm(getActiveGameResults().cities);
        renderLeaderboard();
      }
    });
  } else if (!needOfficial && unsubscribeOfficialResults) {
    unsubscribeOfficialResults();
    unsubscribeOfficialResults = null;
    officialResults = { cities: {} };
  }

  if (needSim && !unsubscribeSimulatedResults) {
    unsubscribeSimulatedResults = subscribeSimulatedResults((data) => {
      simulatedResults = data || { cities: {}, isSimulated: true };
      const curr = getActiveGame();
      if (curr && getGameResultSource(curr) === RESULT_SOURCES.SIM_DB && shouldConnectFirebaseResults(curr)) {
        updateActiveGameUI();
        maybeSyncResultsForm(getActiveGameResults().cities);
        renderLeaderboard();
      }
    });
  } else if (!needSim && unsubscribeSimulatedResults) {
    unsubscribeSimulatedResults();
    unsubscribeSimulatedResults = null;
    simulatedResults = { cities: {}, isSimulated: true };
  }
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
  const savedName = getSavedNickname();
  if (savedName && !nicknameInput.value) {
    nicknameInput.value = savedName;
  }
  setupNavigation();
  setupAdminCreateHandlers();
  setupFormHandlers();
  setupDialogs();

  let handledInitialRoute = false;
  subscribeGames(
    (list) => {
      allGames = list;
      syncLiveResultSubscriptions();
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
          maybeSyncResultsForm(getActiveGameResults().cities);
          renderLeaderboard();
        }
      }
    },
    (err) => {
      gamesListGrid.replaceChildren();
      const errCard = document.createElement("div");
      errCard.className = "empty-lobby-card";
      errCard.textContent = `無法讀取賽局列表（${err.code || err.message}），請檢查 Firestore Rules 或 API Key 網域限制。`;
      gamesListGrid.appendChild(errCard);
    }
  );

  // Periodic lock-status refresh (auto-locks official games & starts Firebase results connection at lock time)
  setInterval(() => {
    syncLiveResultSubscriptions();
    renderLobby();
    if (activeGameId) {
      updateActiveGameUI();
      renderLeaderboard();
    }
  }, 10000);
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

function findMyPrediction(list) {
  const myToken = getOrCreatePlayerToken();
  const myNickname = getSavedNickname().trim().toLowerCase();
  return (
    list.find((p) => p.ownerToken && p.ownerToken === myToken) ||
    list.find((p) => !p.ownerToken && myNickname && p.nickname?.trim().toLowerCase() === myNickname) ||
    null
  );
}

function syncPredictFormFromData(citiesMap) {
  for (const city of CONSTITUENCIES) {
    const saved = citiesMap?.[city.id];
    const radios = document.querySelectorAll(`input[name="pred-winner-${city.id}"]`);
    radios.forEach((r) => {
      r.checked = saved ? r.value === saved.winnerId : false;
    });
    if (city.type === "mayor") {
      setCityShare("pred", city.id, saved?.winnerShare ?? 50);
    }
  }
}

function clearBanner(el) {
  if (!el) return;
  el.textContent = "";
  el.className = "status-banner";
}

function enterGame(gameId, defaultView = "predict") {
  activeGameId = gameId;
  predictionsLoaded = false;
  isPredictFormDirty = false;
  isResultsFormDirty = false;
  expandedResultCities.clear();

  clearBanner(predictStatus);
  clearBanner(resultsStatus);
  nicknameError.textContent = "";
  nicknameInput.removeAttribute("aria-invalid");
  nicknameInput.value = getSavedNickname();
  syncPredictFormFromData(null);

  // Update URL without losing ?admin=1
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("game", gameId);
  window.history.replaceState({}, "", nextUrl);

  navPredictBtn.hidden = false;
  navLeaderboardBtn.hidden = false;
  navResultsBtn.hidden = !isAuthorizedAdmin;
  activeGameBar.hidden = false;

  syncLiveResultSubscriptions();

  if (unsubscribePredictions) {
    unsubscribePredictions();
    unsubscribePredictions = null;
  }
  currentPredictions = [];
  unsubscribePredictions = subscribeGamePredictions(gameId, (list) => {
    currentPredictions = list;
    predictionsLoaded = true;
    if (!isPredictFormDirty) {
      const myPred = findMyPrediction(list);
      if (myPred) {
        nicknameInput.value = myPred.nickname || getSavedNickname();
        syncPredictFormFromData(myPred.cities || {});
      }
    }
    renderLeaderboard();
  });

  updateActiveGameUI();
  const activeResults = getActiveGameResults();
  syncResultsFormFromData(activeResults.cities || {});
  renderLeaderboard();

  const game = getActiveGame();
  const isReadOnlyPredict = game && (isGameSettled(game) || isGameLocked(game));
  const targetView = isReadOnlyPredict && defaultView === "predict" ? "leaderboard" : defaultView;
  switchView(targetView);
}

function leaveGame() {
  activeGameId = null;
  predictionsLoaded = false;
  isPredictFormDirty = false;
  isResultsFormDirty = false;
  expandedResultCities.clear();

  if (unsubscribePredictions) {
    unsubscribePredictions();
    unsubscribePredictions = null;
  }
  currentPredictions = [];
  syncLiveResultSubscriptions();

  clearBanner(predictStatus);
  clearBanner(resultsStatus);

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
  const source = getGameResultSource(game);
  const sourceLabel = getResultSourceLabel(source);
  const settled = isGameSettled(game, officialResults);
  const locked = isGameLocked(game);
  const predictBlocked = settled || locked;
  const connectedToDb = shouldConnectFirebaseResults(game);

  activeGameTitle.textContent = game.title;
  activeGameTypeBadge.textContent = isOfficial ? "正式賽局" : "測試賽局";
  activeGameTypeBadge.className = `game-pill ${isOfficial ? "game-pill-official" : "game-pill-test"}`;

  if (settled) {
    activeGameLockBadge.textContent = "歷史賽局・已結算";
    activeGameLockBadge.className = "lock-pill lock-pill-settled";
  } else if (isOfficial) {
    if (locked) {
      activeGameLockBadge.textContent =
        source === RESULT_SOURCES.MANUAL
          ? `已於 ${formatLockTime(game.lockAt)} 鎖單（純手動開票）`
          : `已鎖單・${sourceLabel}連線中`;
      activeGameLockBadge.className = "lock-pill lock-pill-locked";
    } else {
      activeGameLockBadge.textContent = `開放預測中（${formatLockTime(game.lockAt)} 鎖單）`;
      activeGameLockBadge.className = "lock-pill lock-pill-open";
    }
  } else if (source === RESULT_SOURCES.SIM_DB) {
    const pct = simulatedResults?.countingProgress;
    activeGameLockBadge.textContent =
      typeof pct === "number" ? `模擬開票連線中（${pct}%）` : "Firebase 模擬開票連線中";
    activeGameLockBadge.className = "lock-pill lock-pill-sim";
  } else if (source === RESULT_SOURCES.OFFICIAL_DB) {
    activeGameLockBadge.textContent = "測試賽局（同步中選會開票）";
    activeGameLockBadge.className = "lock-pill lock-pill-sim";
  } else {
    activeGameLockBadge.textContent = "測試賽局（純手動・不鎖單）";
    activeGameLockBadge.className = "lock-pill lock-pill-open";
  }

  // Lock predict form if game is settled (historical) or official game is past lock time
  lockNoticeBanner.hidden = !predictBlocked;
  if (settled) {
    lockNoticeBanner.innerHTML =
      "<strong>此賽局已完成結算（歷史賽局）！</strong> 無法再新增或修改預測，請切換至「分數排行」檢視賽局與分數。";
  } else if (locked) {
    lockNoticeBanner.innerHTML =
      "<strong>此正式賽局已鎖單！</strong> 已超過截止時間，無法再新增或修改預測。請切換至「分數排行」查看開票結果與排名。";
  }
  submitPredictBtn.hidden = predictBlocked;
  predictForm.querySelectorAll("input, button[type='submit']").forEach((el) => {
    el.disabled = predictBlocked;
  });

  // Results mode description & safeguard (settled historical games cannot be re-settled)
  resultsSettledBanner.hidden = !settled;
  saveDraftResultsBtn.hidden = settled;
  submitResultsBtn.hidden = settled;
  clearResultsBtn.hidden = settled;
  resultsForm.querySelectorAll("input, button").forEach((el) => {
    el.disabled = settled;
  });

  if (settled) {
    resultsModeDesc.textContent =
      "本局已完成結算計分並歸檔為【歷史賽局】，開票結果已鎖定不可再修改或重新結算，僅供檢視。";
    simulateResultsBtn.hidden = true;
  } else {
    const waitNote =
      isOfficial && source !== RESULT_SOURCES.MANUAL && !connectedToDb
        ? `尚未到達鎖單時間（${formatLockTime(game.lockAt)}），鎖單後將自動連接資料庫；`
        : "";
    resultsModeDesc.textContent = `資料來源：【${sourceLabel}】。${waitNote}管理員可隨時手動輸入並點「暫存手動開票」即時覆寫分數，或按「儲存開票結果並結算分數」封存為歷史賽局。`;
    simulateResultsBtn.hidden = isOfficial;
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

    const type = document.querySelector('input[name="new-game-type"]:checked')?.value === "official"
      ? "official"
      : "test";
    const resultSource =
      document.querySelector('input[name="new-game-source"]:checked')?.value || RESULT_SOURCES.MANUAL;
    let lockAt = null;
    if (type === "official") {
      const rawVal = newGameLockAtInput.value;
      lockAt = rawVal ? `${rawVal}:00+08:00` : OFFICIAL_LOCK_ISO;
    }

    const createBtn = document.getElementById("create-game-btn");
    createBtn.disabled = true;
    try {
      const created = await createGame({ title, type, lockAt, resultSource });
      newGameTitleInput.value = "";
      setStatus(
        createGameStatus,
        `已成功開啟「${created.title}」（${getResultSourceLabel(resultSource)}）！`,
        "success"
      );
    } catch (err) {
      setStatus(createGameStatus, `建立失敗：${err.message}`, "error");
    } finally {
      createBtn.disabled = false;
    }
  });
}

function createGameCard(game) {
  const isOfficial = game.type === "official";
  const source = getGameResultSource(game);
  const sourceLabel = getResultSourceLabel(source);
  const settled = isGameSettled(game, officialResults);
  const locked = isGameLocked(game);

  const card = document.createElement("article");
  card.className = `game-card ${isOfficial ? "game-card-official" : ""} ${settled ? "game-card-settled" : ""}`.trim();

  const badges = document.createElement("div");
  badges.className = "game-card-badges";

  const typePill = document.createElement("span");
  typePill.className = `game-pill ${isOfficial ? "game-pill-official" : "game-pill-test"}`;
  typePill.textContent = isOfficial ? "正式賽局" : "測試賽局";

  const lockPill = document.createElement("span");
  if (settled) {
    lockPill.className = "lock-pill lock-pill-settled";
    lockPill.textContent = "歷史賽局・已結算";
  } else if (isOfficial) {
    lockPill.className = `lock-pill ${locked ? "lock-pill-locked" : "lock-pill-open"}`;
    lockPill.textContent = locked ? "已鎖單・開票中" : "開放預測中";
  } else if (source === RESULT_SOURCES.SIM_DB || source === RESULT_SOURCES.OFFICIAL_DB) {
    lockPill.className = "lock-pill lock-pill-sim";
    lockPill.textContent = source === RESULT_SOURCES.SIM_DB ? "模擬開票連線中" : "正式開票連線中";
  } else {
    lockPill.className = "lock-pill lock-pill-open";
    lockPill.textContent = "純手動・不鎖單";
  }

  badges.append(typePill, lockPill);

  const title = document.createElement("h3");
  title.className = "game-card-title";
  title.textContent = game.title;

  const meta = document.createElement("p");
  meta.className = "game-card-meta";
  if (settled) {
    meta.textContent = game.settledAt
      ? `結算時間：${formatLockTime(game.settledAt)}（僅供檢視賽局與分數）`
      : "已完成結算計分（僅供檢視賽局與分數）";
  } else if (isOfficial) {
    meta.textContent =
      source === RESULT_SOURCES.MANUAL
        ? `來源：${sourceLabel}｜截止時間：${formatLockTime(game.lockAt)}`
        : `來源：${sourceLabel}｜${formatLockTime(game.lockAt)} 鎖單後連線`;
  } else {
    meta.textContent = `來源：${sourceLabel}（保留手動開票）`;
  }

  const actions = document.createElement("div");
  actions.className = "game-card-actions";

  const enterBtn = document.createElement("button");
  enterBtn.type = "button";
  enterBtn.className = settled ? "btn btn-secondary btn-enter" : "btn btn-primary btn-enter";
  enterBtn.textContent = settled ? "檢視賽局與分數" : locked ? "查看排行榜" : "進入賽局";
  enterBtn.addEventListener("click", () => {
    enterGame(game.id, settled || locked ? "leaderboard" : "predict");
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
  return card;
}

function renderLobby() {
  gamesListGrid.replaceChildren();
  historyGamesGrid.replaceChildren();

  const activeGames = allGames.filter((g) => !isGameSettled(g, officialResults));
  const historyGames = allGames.filter((g) => isGameSettled(g, officialResults));

  if (activeGames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-lobby-card";
    empty.textContent = historyGames.length > 0
      ? "目前沒有進行中的賽局，可於下方查看已結算的歷史賽局。"
      : isAuthorizedAdmin
        ? "目前還沒有開啟任何賽局，請使用上方「管理員控制台」建立第一場賽局！"
        : "目前尚未開放賽局，請稍候再來！";
    gamesListGrid.appendChild(empty);
  } else {
    for (const game of activeGames) {
      gamesListGrid.appendChild(createGameCard(game));
    }
  }

  historyGamesSection.hidden = historyGames.length === 0;
  for (const game of historyGames) {
    historyGamesGrid.appendChild(createGameCard(game));
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
      range.step = "0.1";
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
          error: `請輸入「${city.name}」有效的得票率（0.1% ~ 100%）。`,
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

/**
 * 將管理員表單送出的資料與當前雲端完整候選人票數合併：
 * - 若管理員未更動該選區當選人/得票率，直接保留完整 candidates 陣列與票數
 * - 若管理員手動覆寫了該選區結果，標記 manualOverride: true，同時仍保留 candidates 陣列供展開檢視
 */
function buildMergedResultsForAdminSave(game, formCities) {
  const rawDb = getRawDbResultsForGame(game);
  const currentActive = getActiveGameResults();
  const baseSource = rawDb && Object.keys(rawDb.cities || {}).length > 0 ? rawDb : currentActive;
  const mergedCities = {};

  for (const city of CONSTITUENCIES) {
    const formCity = formCities[city.id];
    if (!formCity) continue;

    const baseCity =
      rawDb?.cities?.[city.id] ||
      game?.testResults?.cities?.[city.id] ||
      currentActive?.cities?.[city.id];

    if (baseCity && Array.isArray(baseCity.candidates) && baseCity.candidates.length > 0) {
      const autoOutcome = resolveCityOutcome(city, { ...baseCity, manualOverride: false });
      const sameWinner = autoOutcome.hasResult && autoOutcome.winnerId === formCity.winnerId;
      const sameShare =
        city.type === "yesno" ||
        (typeof autoOutcome.winnerShare === "number" &&
          Math.abs(autoOutcome.winnerShare - formCity.winnerShare) < 0.05);

      if (sameWinner && sameShare) {
        const cleaned = { ...baseCity };
        delete cleaned.manualOverride;
        mergedCities[city.id] = cleaned;
      } else {
        mergedCities[city.id] = {
          ...baseCity,
          winnerId: formCity.winnerId,
          ...(city.type === "mayor" ? { winnerShare: formCity.winnerShare } : {}),
          manualOverride: true
        };
      }
    } else {
      mergedCities[city.id] = formCity;
    }
  }

  const extraMeta = {};
  if (typeof baseSource?.countingProgress === "number") {
    extraMeta.countingProgress = baseSource.countingProgress;
  }
  if (baseSource?.isSimulated) {
    extraMeta.isSimulated = true;
  }
  if (baseSource?.source) {
    extraMeta.source = baseSource.source;
  }

  return { cities: mergedCities, extraMeta };
}

// 5. Form Handlers
function setupFormHandlers() {
  predictForm.addEventListener("input", () => {
    isPredictFormDirty = true;
  });
  predictForm.addEventListener("change", () => {
    isPredictFormDirty = true;
  });

  resultsForm.addEventListener("input", () => {
    isResultsFormDirty = true;
  });
  resultsForm.addEventListener("change", () => {
    isResultsFormDirty = true;
  });

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
    if (isGameSettled(game)) {
      updateActiveGameUI();
      setStatus(predictStatus, "此賽局已結算計分（歷史賽局），無法再新增或修改預測。", "error");
      return;
    }
    if (isGameLocked(game)) {
      updateActiveGameUI();
      setStatus(predictStatus, "此正式賽局已截止鎖單，無法送出或修改預測。", "error");
      return;
    }
    if (!predictionsLoaded) {
      setStatus(predictStatus, "正在同步本局名單，請稍候 1 秒再送出。", "error");
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

    const myToken = getOrCreatePlayerToken();
    const targetDocId = normalizeNicknameId(nickname);
    const existing = currentPredictions.find(
      (p) => p.id === targetDocId || p.nickname?.trim().toLowerCase() === nickname.toLowerCase()
    );
    if (existing && existing.ownerToken && existing.ownerToken !== myToken) {
      nicknameInput.setAttribute("aria-invalid", "true");
      nicknameError.textContent = `暱稱「${nickname}」已被其他玩家使用，請換一個暱稱。`;
      nicknameInput.focus();
      setStatus(predictStatus, `暱稱「${nickname}」已被其他玩家使用，請換一個暱稱！`, "error");
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
      await saveGamePrediction(game.id, nickname, parsed.data, myToken);
      localStorage.setItem(MY_NICKNAME_KEY, nickname);
      isPredictFormDirty = false;
      setStatus(predictStatus, `已成功儲存「${nickname}」在「${game.title}」的預測！`, "success");
    } catch (err) {
      setStatus(predictStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitPredictBtn.disabled = isGameSettled(game) || isGameLocked(game);
    }
  });

  // Simulate random actual results (Test games only, before settlement)
  simulateResultsBtn.addEventListener("click", () => {
    const game = getActiveGame();
    if (!game || isGameSettled(game)) return;
    isResultsFormDirty = true;
    fillRandomResults();
    setStatus(resultsStatus, "已隨機產生模擬開票數據，可點「暫存手動開票」或「儲存開票結果並結算分數」！", "success");
  });

  // Clear manual override results for this game only (never wipes global official_results/2026)
  clearResultsBtn.addEventListener("click", async () => {
    const game = getActiveGame();
    if (!game) return;
    if (isGameSettled(game)) {
      updateActiveGameUI();
      setStatus(resultsStatus, "此賽局已完成結算（歷史賽局），不可清空或修改開票數據。", "error");
      return;
    }
    try {
      await saveTestGameResults(game.id, {}, { settle: false });
      isResultsFormDirty = false;
      syncResultsFormFromData(getActiveGameResults().cities || {});
      renderLeaderboard();
      const source = getGameResultSource(game);
      setStatus(
        resultsStatus,
        source === RESULT_SOURCES.MANUAL
          ? "已清空本局手動開票數據。"
          : `已清除本局手動覆寫，恢復同步「${getResultSourceLabel(source)}」。`,
        "success"
      );
    } catch (err) {
      setStatus(resultsStatus, `清空失敗：${err.message}`, "error");
    }
  });

  // Save manual results without settling (works for A, B, and C sources while preserving candidate arrays)
  saveDraftResultsBtn.addEventListener("click", async () => {
    const game = getActiveGame();
    if (!game) return;
    if (isGameSettled(game)) {
      updateActiveGameUI();
      setStatus(resultsStatus, "此賽局已完成結算（歷史賽局），不可修改開票數據。", "error");
      return;
    }

    const parsed = readCitiesFromForm("res", { requireAll: false });
    if (parsed.error) {
      setStatus(resultsStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    const count = Object.keys(parsed.data).length;
    if (count === 0) {
      setStatus(resultsStatus, "請至少填寫一題開票結果再暫存。", "error");
      return;
    }

    const merged = buildMergedResultsForAdminSave(game, parsed.data);
    saveDraftResultsBtn.disabled = true;
    try {
      await saveTestGameResults(game.id, merged.cities, {
        settle: false,
        extraMeta: merged.extraMeta
      });
      isResultsFormDirty = false;
      setStatus(
        resultsStatus,
        `已暫存手動開票結果（共 ${count} 題，尚未結算封存），分數排行已即時更新！`,
        "success"
      );
      renderLeaderboard();
    } catch (err) {
      setStatus(resultsStatus, `暫存失敗：${err.message}`, "error");
    } finally {
      saveDraftResultsBtn.disabled = isGameSettled(getActiveGame());
    }
  });

  // Submit actual results & finalize game as historical (preserves full candidate votes/shares & never overwrites global official_results/2026)
  resultsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const game = getActiveGame();
    if (!game) return;

    if (isGameSettled(game)) {
      updateActiveGameUI();
      setStatus(resultsStatus, "此賽局已完成結算（歷史賽局），無法再次修改或重新結算。", "error");
      return;
    }

    const parsed = readCitiesFromForm("res", { requireAll: false });
    if (parsed.error) {
      setStatus(resultsStatus, parsed.error, "error");
      parsed.focusEl?.focus();
      return;
    }

    const count = Object.keys(parsed.data).length;
    if (count === 0) {
      setStatus(resultsStatus, "請至少填寫一題開票結果再進行結算。", "error");
      return;
    }

    const confirmed = confirm(
      `確定要以這 ${count} 題開票結果結算「${game.title}」嗎？\n結算後此賽局將成為歷史賽局，不可再新增預測或修改結算成果。`
    );
    if (!confirmed) return;

    const merged = buildMergedResultsForAdminSave(game, parsed.data);
    submitResultsBtn.disabled = true;
    try {
      const source = getGameResultSource(game);
      if (game.type === "official" && source === RESULT_SOURCES.OFFICIAL_DB) {
        await settleOfficialGame(game.id, merged.cities, merged.extraMeta);
      } else {
        await saveTestGameResults(game.id, merged.cities, {
          settle: true,
          extraMeta: merged.extraMeta
        });
      }
      isResultsFormDirty = false;
      setStatus(
        resultsStatus,
        `已完成賽局結算（共 ${count} 題），本賽局已歸檔為歷史賽局！`,
        "success"
      );
      syncLiveResultSubscriptions();
      updateActiveGameUI();
      renderLobby();
      renderLeaderboard();
    } catch (err) {
      setStatus(resultsStatus, `儲存失敗：${err.message}`, "error");
    } finally {
      submitResultsBtn.disabled = isGameSettled(getActiveGame());
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

function formatVotes(votes) {
  const num = Number(votes);
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString("zh-TW");
}

function syncResultsFormFromData(citiesMap) {
  for (const city of CONSTITUENCIES) {
    const saved = citiesMap?.[city.id];
    const outcome = resolveCityOutcome(city, saved);
    const radios = document.querySelectorAll(`input[name="res-winner-${city.id}"]`);
    radios.forEach((r) => {
      r.checked = outcome.hasResult ? r.value === outcome.winnerId : false;
    });
    if (city.type === "mayor") {
      setCityShare("res", city.id, outcome.hasResult ? (outcome.winnerShare ?? 50) : 50);
    }
  }
}

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `status-banner ${type === "error" ? "status-error" : "status-success"}`;
}

// 6. Leaderboard & Live Results Rendering
function renderLiveResultsPanel(game, activeResults) {
  const citiesMap = activeResults?.cities || {};
  const isSettled = isGameSettled(game);
  const source = getGameResultSource(game);
  const waitingForLock = Boolean(activeResults?.waitingForLock);

  if (isSettled) {
    liveIndicator.classList.add("is-settled");
    liveIndicatorText.textContent = "已結算鎖定";
  } else if (waitingForLock) {
    liveIndicator.classList.add("is-settled");
    liveIndicatorText.textContent = "等待鎖單後連線";
  } else if (source === RESULT_SOURCES.MANUAL || activeResults?.isManualOverride) {
    liveIndicator.classList.remove("is-settled");
    liveIndicatorText.textContent = "手動開票模式";
  } else {
    liveIndicator.classList.remove("is-settled");
    liveIndicatorText.textContent = storageMode === "firebase" ? "Firebase 即時同步中" : "本機即時同步中";
  }

  if (!game) {
    liveSourceLabel.textContent = "";
  } else if (isSettled) {
    liveSourceLabel.textContent = "資料來源：歷史結算快照";
  } else if (activeResults?.isManualOverride) {
    liveSourceLabel.textContent = `資料來源：管理員手動輸入（原設定：${getResultSourceLabel(source)}）`;
  } else if (waitingForLock) {
    liveSourceLabel.textContent = `將於 ${formatLockTime(game.lockAt)} 鎖單後自動連接 ${getResultSourceLabel(source)}`;
  } else {
    liveSourceLabel.textContent = `資料來源：${getResultSourceLabel(source)}`;
  }

  if (typeof activeResults?.countingProgress === "number") {
    const pct = Math.max(0, Math.min(100, activeResults.countingProgress));
    liveProgressWrap.hidden = false;
    liveProgressText.textContent = `${pct}%`;
    liveProgressFill.style.width = `${pct}%`;
    liveProgressBar.setAttribute("aria-valuenow", String(pct));
  } else {
    liveProgressWrap.hidden = true;
  }

  liveResultsUpdated.textContent = activeResults?.updatedAt
    ? `最後更新：${formatLockTime(activeResults.updatedAt)}`
    : waitingForLock
      ? `尚未鎖單（${formatLockTime(game?.lockAt)} 開始連線）`
      : "尚未有開票數據";

  liveResultsGrid.replaceChildren();

  for (const city of CONSTITUENCIES) {
    const cityRes = citiesMap[city.id];
    const outcome = resolveCityOutcome(city, cityRes);
    const hasResult = outcome.hasResult;

    const card = document.createElement("div");
    card.className = hasResult ? "live-result-card is-opened" : "live-result-card";
    if (city.type === "yesno") {
      card.classList.add("is-special");
    }

    const cityTitle = document.createElement("div");
    cityTitle.className = "live-result-city";
    cityTitle.textContent = city.name;
    card.appendChild(cityTitle);

    if (hasResult) {
      const cand = city.candidates.find((c) => c.id === outcome.winnerId);
      const winnerRow = document.createElement("div");
      winnerRow.className = "live-result-winner";

      const dot = document.createElement("span");
      dot.className = "party-dot";
      dot.style.backgroundColor = cand?.color || outcome.winnerColor || "#64748b";

      const nameSpan = document.createElement("span");
      if (city.type === "yesno") {
        nameSpan.textContent = outcome.winnerId === "yes" ? "會當選" : "不會當選";
      } else {
        nameSpan.textContent = cand?.name ?? outcome.winnerName ?? outcome.winnerId;
      }

      winnerRow.append(dot, nameSpan);
      card.appendChild(winnerRow);

      if (city.type === "mayor" && typeof outcome.winnerShare === "number") {
        const shareEl = document.createElement("div");
        shareEl.className = "live-result-share";
        const votesPart =
          typeof outcome.winnerVotes === "number" && outcome.winnerVotes > 0
            ? `（${formatVotes(outcome.winnerVotes)} 票）`
            : "";
        shareEl.textContent = `最高得票率：${outcome.winnerShare}%${votesPart}`;
        card.appendChild(shareEl);
      } else if (city.type === "yesno" && outcome.targetRank !== null) {
        const rankEl = document.createElement("div");
        rankEl.className = "live-result-share";
        const seats = outcome.seats || 12;
        const shareText = typeof outcome.targetShare === "number" ? `${outcome.targetShare}%` : "";
        const votesText = typeof outcome.targetVotes === "number" ? `${formatVotes(outcome.targetVotes)} 票` : "";
        const detailMeta = [shareText, votesText].filter(Boolean).join("・");
        rankEl.textContent = `王妃目前第 ${outcome.targetRank} 名（前 ${seats} 名當選）${detailMeta ? `｜${detailMeta}` : ""}`;
        card.appendChild(rankEl);
      }

      if (outcome.sortedCandidates.length > 0) {
        const details = document.createElement("details");
        details.className = "live-result-details";
        details.open = expandedResultCities.has(city.id);
        details.addEventListener("toggle", () => {
          if (details.open) {
            expandedResultCities.add(city.id);
          } else {
            expandedResultCities.delete(city.id);
          }
        });

        const summary = document.createElement("summary");
        summary.className = "live-result-summary";
        summary.textContent =
          city.type === "yesno"
            ? `查看全選區 ${outcome.sortedCandidates.length} 位候選人排名`
            : `查看全部 ${outcome.sortedCandidates.length} 位候選人開票`;
        details.appendChild(summary);

        const list = document.createElement("ol");
        list.className = "live-cand-list";

        const maxShare = Math.max(
          ...outcome.sortedCandidates.map((c) => Number(c.share || 0)),
          1
        );
        const seats = outcome.seats || 12;

        outcome.sortedCandidates.forEach((c, idx) => {
          const rank = idx + 1;
          const isTarget =
            city.type === "yesno" &&
            (c.id === outcome.targetCandidateId || c.no === 12);

          const item = document.createElement("li");
          item.className = "live-cand-item";
          if (city.type === "mayor" && rank === 1) item.classList.add("is-leader");
          if (city.type === "yesno" && rank <= seats) item.classList.add("is-in-seats");
          if (isTarget) item.classList.add("is-target");

          const topRow = document.createElement("div");
          topRow.className = "live-cand-top";

          const left = document.createElement("div");
          left.className = "live-cand-name";

          const rankTag = document.createElement("span");
          rankTag.className = "live-cand-rank";
          rankTag.textContent = `#${rank}`;

          const cDot = document.createElement("span");
          cDot.className = "party-dot";
          cDot.style.backgroundColor = c.color || "#64748b";

          const cName = document.createElement("span");
          cName.textContent = c.name;

          left.append(rankTag, cDot, cName);

          if (isTarget) {
            const targetPill = document.createElement("span");
            targetPill.className = "target-pill";
            targetPill.textContent = rank <= seats ? "當選區內" : "未進前12";
            left.appendChild(targetPill);
          }

          const right = document.createElement("div");
          right.className = "live-cand-nums";
          right.textContent = `${c.share}%（${formatVotes(c.votes)} 票）`;

          topRow.append(left, right);

          const barTrack = document.createElement("div");
          barTrack.className = "live-cand-bar-track";
          const barFill = document.createElement("div");
          barFill.className = "live-cand-bar-fill";
          barFill.style.width = `${Math.min(100, Math.max(c.share > 0 ? 2 : 0, (c.share / maxShare) * 100)).toFixed(1)}%`;
          barFill.style.backgroundColor = c.color || "#243b5a";
          barTrack.appendChild(barFill);

          item.append(topRow, barTrack);
          list.appendChild(item);

          if (city.type === "yesno" && rank === seats && outcome.sortedCandidates.length > seats) {
            const cutoff = document.createElement("li");
            cutoff.className = "live-cand-cutoff";
            cutoff.textContent = `── 當選門檻線（前 ${seats} 名當選）──`;
            list.appendChild(cutoff);
          }
        });

        details.appendChild(list);
        card.appendChild(details);
      }
    } else {
      const pending = document.createElement("div");
      pending.className = "live-result-pending";
      pending.textContent = "尚未開票";
      card.appendChild(pending);
    }

    liveResultsGrid.appendChild(card);
  }
}

function renderLeaderboard() {
  const game = getActiveGame();
  const activeResults = getActiveGameResults();
  const openedCities = CONSTITUENCIES.filter((c) => resolveCityOutcome(c, activeResults?.cities?.[c.id]).hasResult);
  const openedCount = openedCities.length;
  const maxPossibleScore = openedCities.reduce(
    (sum, city) => sum + (city.type === "yesno" ? 60 : 100),
    0
  );

  renderLiveResultsPanel(game, activeResults);

  const simPrefix = activeResults?.isSimulated ? "【測試模擬數據】" : "";
  const progressInfo = typeof activeResults?.countingProgress === "number"
    ? `｜開票進度 ${activeResults.countingProgress}%`
    : "";
  const updatedInfo = activeResults?.updatedAt
    ? `｜最後更新：${formatLockTime(activeResults.updatedAt)}`
    : "";

  leaderboardSummary.textContent = !game
    ? "請先選擇賽局。"
    : openedCount === 0
      ? `${simPrefix}「${game.title}」目前共有 ${currentPredictions.length} 位玩家完成預測（尚未開票）。`
      : `${simPrefix}「${game.title}」目前已開票 ${openedCount} / ${CONSTITUENCIES.length} 題，共有 ${currentPredictions.length} 位玩家參與排名${progressInfo}${updatedInfo}。`;

  leaderboardMaxScore.textContent = openedCount > 0 ? `目前滿分 ${maxPossibleScore} 分` : "尚未開票";

  leaderboardList.replaceChildren();

  if (currentPredictions.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "leaderboard-empty";
    emptyLi.textContent = "本賽局還沒有任何玩家預測，快到「我要預測」搶頭香吧！";
    leaderboardList.appendChild(emptyLi);
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
      if (b.summary.winnerHits !== a.summary.winnerHits) {
        return b.summary.winnerHits - a.summary.winnerHits;
      }
      return a.summary.totalError - b.summary.totalError;
    });

  const myToken = getOrCreatePlayerToken();
  const myNickname = getSavedNickname().toLowerCase();
  let prevRankNum = 1;

  ranked.forEach(({ pred, summary }, index) => {
    let rankNum = index + 1;
    if (openedCount > 0 && index > 0) {
      const prev = ranked[index - 1].summary;
      if (
        prev.totalScore === summary.totalScore &&
        prev.winnerHits === summary.winnerHits &&
        prev.totalError === summary.totalError
      ) {
        rankNum = prevRankNum;
      }
    }
    prevRankNum = rankNum;

    const isSelf = Boolean(
      (pred.ownerToken && pred.ownerToken === myToken) ||
      (!pred.ownerToken && myNickname && pred.nickname?.trim().toLowerCase() === myNickname)
    );

    const li = document.createElement("li");
    li.className = "leaderboard-row";
    if (isSelf) li.classList.add("is-self");
    if (openedCount > 0 && rankNum <= 3) li.classList.add(`rank-${rankNum}`);

    const rankEl = document.createElement("div");
    rankEl.className = "rank-badge";
    rankEl.textContent = openedCount > 0 ? `#${rankNum}` : "—";
    rankEl.setAttribute("aria-label", openedCount > 0 ? `第 ${rankNum} 名` : "尚未開票");

    const playerEl = document.createElement("div");
    playerEl.className = "player-meta";

    const nameRow = document.createElement("div");
    nameRow.className = "player-name";
    const nameText = document.createElement("span");
    nameText.textContent = pred.nickname;
    nameRow.appendChild(nameText);

    if (isSelf) {
      const selfTag = document.createElement("span");
      selfTag.className = "self-badge";
      selfTag.textContent = "你";
      nameRow.appendChild(selfTag);
    }

    const statsEl = document.createElement("div");
    statsEl.className = "player-stats";
    statsEl.textContent =
      openedCount > 0
        ? `命中 ${summary.winnerHits}/${summary.scoredCities} 題｜命中誤差 ±${summary.totalError}%`
        : "待開票";

    playerEl.append(nameRow, statsEl);

    const barArea = document.createElement("div");
    barArea.className = "score-bar-area";

    const rawPct =
      openedCount > 0 && maxPossibleScore > 0
        ? (summary.totalScore / maxPossibleScore) * 100
        : 0;
    const clampedPct = Math.min(100, Math.max(0, rawPct));
    const visualPct = summary.totalScore > 0 ? Math.max(2, clampedPct) : 0;

    const track = document.createElement("div");
    track.className = "score-bar-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${pred.nickname} 的得分進度`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(maxPossibleScore || 100));
    track.setAttribute("aria-valuenow", String(summary.totalScore));

    const fill = document.createElement("div");
    fill.className = "score-bar-fill";
    fill.style.width = `${visualPct.toFixed(1)}%`;
    track.appendChild(fill);

    const scoreVal = document.createElement("span");
    scoreVal.className = "score-bar-value";
    scoreVal.textContent = openedCount > 0 ? `${summary.totalScore} 分` : "—";

    barArea.append(track, scoreVal);

    const actionWrap = document.createElement("div");
    actionWrap.className = "leaderboard-action";
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "btn btn-sm btn-secondary";

    const canViewDetail = canViewPlayerDetail(game, isSelf);
    if (canViewDetail) {
      detailBtn.textContent = "查看明細";
      detailBtn.addEventListener("click", () => openPlayerDetail(pred, summary, isSelf));
    } else {
      detailBtn.textContent = "開票後公開";
      detailBtn.disabled = true;
      detailBtn.title = `為避免作弊，正式賽局於 ${formatLockTime(game?.lockAt)} 鎖單開票後才可檢視他人預測明細`;
    }
    actionWrap.appendChild(detailBtn);

    li.append(rankEl, playerEl, barArea, actionWrap);
    leaderboardList.appendChild(li);
  });
}

function canViewPlayerDetail(game, isSelf) {
  if (isSelf) return true;
  if (!game || game.type !== "official") return true;
  return isGameSettled(game) || isGameLocked(game);
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

function openPlayerDetail(pred, summary, isSelf = false) {
  const game = getActiveGame();
  if (!canViewPlayerDetail(game, isSelf)) {
    return;
  }
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
      } else if (cityResult.winnerHit) {
        badge.textContent = `猜中當選人｜誤差 ${cityResult.errorSum}%｜+${cityResult.totalPoints} 分`;
      } else {
        badge.textContent = "未中當選人｜+0 分";
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

    const actualOutcome = resolveCityOutcome(city, actualCity);
    if (actualOutcome.hasResult && actualOutcome.winnerId) {
      const actualLine = document.createElement("p");
      actualLine.className = "detail-line";
      const actualName = getCandidateName(city, actualOutcome.winnerId);
      if (city.type === "yesno") {
        const rankSuffix =
          actualOutcome.targetRank !== null
            ? `（王妃第 ${actualOutcome.targetRank} 名／前 ${actualOutcome.seats || 12} 名當選）`
            : "";
        actualLine.textContent = `實際結果：${actualName}${rankSuffix}`;
      } else {
        actualLine.textContent = `實際結果：${actualName}（${actualOutcome.winnerShare ?? 0}%）`;
      }
      block.appendChild(actualLine);
    }

    if (cityResult) {
      const calcLine = document.createElement("p");
      calcLine.className = "detail-line detail-calc";
      if (city.type === "yesno") {
        calcLine.textContent = cityResult.winnerHit
          ? `計分細項：預測成功 +${cityResult.totalPoints} 分`
          : "計分細項：預測失敗，本區 0 分";
      } else if (cityResult.winnerHit) {
        calcLine.textContent = `計分細項：當選人 +${cityResult.winnerPoints} 分 ＋ 得票率精準度 +${cityResult.accuracyPoints} 分（誤差 ${cityResult.errorSum}%）＝ ${cityResult.totalPoints} 分`;
      } else {
        calcLine.textContent = "計分細項：候選人預測錯誤，本區直接 0 分";
      }
      block.appendChild(calcLine);
    }

    detailDialogBody.appendChild(block);
  }

  detailDialog.showModal();
}

bootstrap();
