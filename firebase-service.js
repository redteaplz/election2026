import { firebaseConfig } from "./firebase-config.js";
import { OFFICIAL_LOCK_ISO } from "./data.js";

const LOCAL_GAMES_KEY = "election2026_games_v2";
const LOCAL_PREDICTIONS_KEY = "election2026_predictions_v2";
const LOCAL_OFFICIAL_RESULTS_KEY = "election2026_official_results_v2";
const LOCAL_SIM_RESULTS_KEY = "election2026_sim_results_v2";

let mode = "local"; // "firebase" | "local"
let db = null;
let firestoreApi = null;
let auth = null;
let authApi = null;

/**
 * 初始化資料儲存層：
 * 若 firebaseConfig.apiKey 有填寫，動態載入 Firebase SDK 並連線至 Firestore + Auth；
 * 否則使用本機 LocalStorage 試玩模式。
 */
export async function initStorage() {
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
    try {
      const [{ initializeApp }, firestore, firebaseAuth] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js")
      ]);
      const app = initializeApp(firebaseConfig);
      db = firestore.getFirestore(app);
      firestoreApi = firestore;
      auth = firebaseAuth.getAuth(app);
      authApi = firebaseAuth;
      mode = "firebase";
      return { mode, error: null };
    } catch (err) {
      console.warn("Firebase 初始化失敗，切換為本機試玩模式：", err);
      mode = "local";
      return { mode, error: err.message };
    }
  }
  mode = "local";
  return { mode, error: null };
}

export function getStorageMode() {
  return mode;
}

export function subscribeAuthState(callback) {
  if (mode === "firebase" && auth && authApi) {
    return authApi.onAuthStateChanged(auth, callback);
  }
  callback(null);
  return () => {};
}

export async function signInAdmin() {
  if (mode !== "firebase" || !auth || !authApi) {
    throw new Error("目前為本機模式，無需登入。");
  }
  const provider = new authApi.GoogleAuthProvider();
  return authApi.signInWithPopup(auth, provider);
}

export async function signOutAdmin() {
  if (mode === "firebase" && auth && authApi) {
    return authApi.signOut(auth);
  }
}

/**
 * 訂閱所有賽局列表（由新到舊排序）
 */
export function subscribeGames(callback, onError) {
  if (mode === "firebase" && db && firestoreApi) {
    const { collection, onSnapshot, query, orderBy } = firestoreApi;
    const q = query(collection(db, "games"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => list.push(docSnap.data()));
        callback(list);
      },
      (err) => {
        console.error("讀取賽局列表失敗：", err);
        if (onError) onError(err);
      }
    );
  }

  ensureDefaultLocalGame();
  const emitLocal = () => {
    const list = readLocalGames().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    callback(list);
  };
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 建立新賽局（管理員）
 */
export async function createGame({ title, type, lockAt, resultSource, useLiveSim = false }) {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const isOfficial = type === "official";
  const resolvedSource =
    resultSource === "official_db" || resultSource === "sim_db" || resultSource === "manual"
      ? resultSource
      : isOfficial
        ? "official_db"
        : useLiveSim
          ? "sim_db"
          : "manual";
  const resolvedLockAt = isOfficial ? (lockAt || OFFICIAL_LOCK_ISO) : null;
  const parsedLockAtMs = resolvedLockAt ? Date.parse(resolvedLockAt) : null;
  const lockAtMs = isOfficial
    ? (Number.isNaN(parsedLockAtMs) ? Date.parse(OFFICIAL_LOCK_ISO) : parsedLockAtMs)
    : null;
  const payload = {
    id,
    title: title.trim(),
    type: isOfficial ? "official" : "test",
    resultSource: resolvedSource,
    useLiveSim: resolvedSource === "sim_db",
    lockAt: resolvedLockAt,
    lockAtMs,
    settled: false,
    settledAt: null,
    testResults: { cities: {}, updatedAt: null },
    createdAt: new Date().toISOString()
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "games", id), payload);
    return payload;
  }

  const list = readLocalGames();
  list.unshift(payload);
  localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
  return payload;
}

/**
 * 刪除賽局（管理員）
 */
export async function deleteGame(gameId) {
  if (mode === "firebase" && db && firestoreApi) {
    const { doc, deleteDoc } = firestoreApi;
    await deleteDoc(doc(db, "games", gameId));
    return;
  }

  const list = readLocalGames().filter((g) => g.id !== gameId);
  localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(list));
  const predsMap = readLocalPredictionsMap();
  delete predsMap[gameId];
  localStorage.setItem(LOCAL_PREDICTIONS_KEY, JSON.stringify(predsMap));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
}

export function normalizeNicknameId(nickname) {
  return nickname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "_");
}

/**
 * 儲存或更新指定賽局的玩家預測
 */
export async function saveGamePrediction(gameId, nickname, cities, ownerToken = "") {
  const cleanName = nickname.trim();
  const docId = normalizeNicknameId(cleanName);
  const payload = {
    id: docId,
    nickname: cleanName,
    ownerToken,
    cities,
    updatedAt: new Date().toISOString()
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "games", gameId, "predictions", docId), payload);
    return payload;
  }

  const predsMap = readLocalPredictionsMap();
  const list = predsMap[gameId] || [];
  const idx = list.findIndex((item) => item.id === docId);
  if (idx >= 0) {
    list[idx] = payload;
  } else {
    list.push(payload);
  }
  predsMap[gameId] = list;
  localStorage.setItem(LOCAL_PREDICTIONS_KEY, JSON.stringify(predsMap));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
  return payload;
}

/**
 * 訂閱指定賽局的所有玩家預測
 */
export function subscribeGamePredictions(gameId, callback) {
  if (!gameId) {
    callback([]);
    return () => {};
  }

  if (mode === "firebase" && db && firestoreApi) {
    const { collection, onSnapshot, query, orderBy } = firestoreApi;
    const q = query(collection(db, "games", gameId, "predictions"), orderBy("updatedAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push(docSnap.data()));
      callback(items);
    });
  }

  const emitLocal = () => {
    const predsMap = readLocalPredictionsMap();
    callback(predsMap[gameId] || []);
  };
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 儲存單一賽局的手動開票結果（支援僅更新暫存或結算為歷史賽局）
 */
export async function saveTestGameResults(gameId, cities, { settle = true } = {}) {
  const now = new Date().toISOString();
  const testResults = {
    cities,
    updatedAt: Object.keys(cities || {}).length > 0 ? now : null
  };
  const updates = settle
    ? { testResults, settledResults: testResults, settled: true, settledAt: now }
    : { testResults };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "games", gameId), updates, { merge: true });
    return testResults;
  }

  const list = readLocalGames();
  const idx = list.findIndex((g) => g.id === gameId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...updates };
    localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("local-storage-updated"));
  }
  return testResults;
}

/**
 * 儲存「官方開票結果」（所有正式賽局共用）
 */
export async function saveOfficialResults(cities) {
  const payload = {
    cities,
    updatedAt: new Date().toISOString()
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "official_results", "2026"), payload);
    return payload;
  }

  localStorage.setItem(LOCAL_OFFICIAL_RESULTS_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
  return payload;
}

/**
 * 結算「正式賽局」：寫入官方開票結果並將該賽局標記為已結算歷史賽局
 */
export async function settleOfficialGame(gameId, cities) {
  const payload = await saveOfficialResults(cities);
  const updates = {
    settled: true,
    settledAt: payload.updatedAt,
    settledResults: payload
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "games", gameId), updates, { merge: true });
    return payload;
  }

  const list = readLocalGames();
  const idx = list.findIndex((g) => g.id === gameId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...updates };
    localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("local-storage-updated"));
  }
  return payload;
}

/**
 * 訂閱「官方開票結果」
 */
export function subscribeOfficialResults(callback) {
  if (mode === "firebase" && db && firestoreApi) {
    const { doc, onSnapshot } = firestoreApi;
    return onSnapshot(doc(db, "official_results", "2026"), (docSnap) => {
      callback(docSnap.exists() ? docSnap.data() : { cities: {} });
    });
  }

  const emitLocal = () => callback(readLocalOfficialResults());
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 訂閱「GAS 模擬即時開票結果」（測試數據，與正式 official_results/2026 完全隔離）
 */
export function subscribeSimulatedResults(callback) {
  if (mode === "firebase" && db && firestoreApi) {
    const { doc, onSnapshot } = firestoreApi;
    return onSnapshot(doc(db, "official_results", "2026_sim"), (docSnap) => {
      callback(docSnap.exists() ? docSnap.data() : { cities: {}, isSimulated: true });
    });
  }

  const emitLocal = () => {
    try {
      const raw = localStorage.getItem(LOCAL_SIM_RESULTS_KEY);
      callback(raw ? JSON.parse(raw) : { cities: {}, isSimulated: true });
    } catch {
      callback({ cities: {}, isSimulated: true });
    }
  };
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 清除本機試玩資料
 */
export function clearLocalData() {
  localStorage.removeItem(LOCAL_GAMES_KEY);
  localStorage.removeItem(LOCAL_PREDICTIONS_KEY);
  localStorage.removeItem(LOCAL_OFFICIAL_RESULTS_KEY);
  localStorage.removeItem(LOCAL_SIM_RESULTS_KEY);
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
}

function ensureDefaultLocalGame() {
  const list = readLocalGames();
  if (list.length === 0) {
    const defaults = [
      {
        id: "demo-official",
        title: "2026 九合一正式賽局（範例）",
        type: "official",
        resultSource: "official_db",
        lockAt: OFFICIAL_LOCK_ISO,
        lockAtMs: Date.parse(OFFICIAL_LOCK_ISO),
        settled: false,
        settledAt: null,
        testResults: { cities: {}, updatedAt: null },
        createdAt: new Date().toISOString()
      },
      {
        id: "demo-test",
        title: "選前熱身測試賽局",
        type: "test",
        resultSource: "manual",
        lockAt: null,
        lockAtMs: null,
        settled: false,
        settledAt: null,
        testResults: { cities: {}, updatedAt: null },
        createdAt: new Date(Date.now() - 1000).toISOString()
      }
    ];
    localStorage.setItem(LOCAL_GAMES_KEY, JSON.stringify(defaults));
  }
}

function readLocalGames() {
  try {
    const raw = localStorage.getItem(LOCAL_GAMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function readLocalPredictionsMap() {
  try {
    const raw = localStorage.getItem(LOCAL_PREDICTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readLocalOfficialResults() {
  try {
    const raw = localStorage.getItem(LOCAL_OFFICIAL_RESULTS_KEY);
    return raw ? JSON.parse(raw) : { cities: {} };
  } catch {
    return { cities: {} };
  }
}
