import { firebaseConfig } from "./firebase-config.js";
import { OFFICIAL_LOCK_ISO } from "./data.js";

const LOCAL_GAMES_KEY = "election2026_games_v2";
const LOCAL_PREDICTIONS_KEY = "election2026_predictions_v2";
const LOCAL_OFFICIAL_RESULTS_KEY = "election2026_official_results_v2";

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
export function subscribeGames(callback) {
  if (mode === "firebase" && db && firestoreApi) {
    const { collection, onSnapshot, query, orderBy } = firestoreApi;
    const q = query(collection(db, "games"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data()));
      callback(list);
    });
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
export async function createGame({ title, type, lockAt }) {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const isOfficial = type === "official";
  const resolvedLockAt = isOfficial ? (lockAt || OFFICIAL_LOCK_ISO) : null;
  const parsedLockAtMs = resolvedLockAt ? Date.parse(resolvedLockAt) : null;
  const lockAtMs = isOfficial
    ? (Number.isNaN(parsedLockAtMs) ? Date.parse(OFFICIAL_LOCK_ISO) : parsedLockAtMs)
    : null;
  const payload = {
    id,
    title: title.trim(),
    type: isOfficial ? "official" : "test",
    lockAt: resolvedLockAt,
    lockAtMs,
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

/**
 * 儲存或更新指定賽局的玩家預測
 */
export async function saveGamePrediction(gameId, nickname, cities) {
  const cleanName = nickname.trim();
  const docId = cleanName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "_");
  const payload = {
    id: docId,
    nickname: cleanName,
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
 * 儲存「測試賽局」專屬開票結果
 */
export async function saveTestGameResults(gameId, cities) {
  const testResults = {
    cities,
    updatedAt: new Date().toISOString()
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "games", gameId), { testResults }, { merge: true });
    return testResults;
  }

  const list = readLocalGames();
  const idx = list.findIndex((g) => g.id === gameId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], testResults };
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
 * 清除本機試玩資料
 */
export function clearLocalData() {
  localStorage.removeItem(LOCAL_GAMES_KEY);
  localStorage.removeItem(LOCAL_PREDICTIONS_KEY);
  localStorage.removeItem(LOCAL_OFFICIAL_RESULTS_KEY);
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
        lockAt: OFFICIAL_LOCK_ISO,
        lockAtMs: Date.parse(OFFICIAL_LOCK_ISO),
        testResults: { cities: {}, updatedAt: null },
        createdAt: new Date().toISOString()
      },
      {
        id: "demo-test",
        title: "選前熱身測試賽局",
        type: "test",
        lockAt: null,
        lockAtMs: null,
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
