import { firebaseConfig } from "./firebase-config.js";

const LOCAL_PREDICTIONS_KEY = "election2026_predictions";
const LOCAL_ACTUALS_KEY = "election2026_actual_results";

let mode = "local"; // "firebase" | "local"
let db = null;
let firestoreApi = null;

/**
 * 初始化資料儲存層：
 * 若 firebaseConfig.apiKey 有填寫，動態載入 Firebase SDK 並連線至 Firestore；
 * 否則使用本機 LocalStorage 試玩模式。
 */
export async function initStorage() {
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
    try {
      const [{ initializeApp }, firestore] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js")
      ]);
      const app = initializeApp(firebaseConfig);
      db = firestore.getFirestore(app);
      firestoreApi = firestore;
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

/**
 * 儲存或更新玩家預測
 */
export async function savePrediction(nickname, cities) {
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
    await setDoc(doc(db, "predictions", docId), payload);
    return payload;
  }

  const list = readLocalPredictions();
  const idx = list.findIndex((item) => item.id === docId);
  if (idx >= 0) {
    list[idx] = payload;
  } else {
    list.push(payload);
  }
  localStorage.setItem(LOCAL_PREDICTIONS_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
  return payload;
}

/**
 * 讀取所有玩家預測（並支援即時訂閱）
 */
export function subscribePredictions(callback) {
  if (mode === "firebase" && db && firestoreApi) {
    const { collection, onSnapshot, query, orderBy } = firestoreApi;
    const q = query(collection(db, "predictions"), orderBy("updatedAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push(docSnap.data()));
      callback(items);
    });
  }

  const emitLocal = () => callback(readLocalPredictions());
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 儲存開票結果（試玩手動輸入或當天真實開票）
 */
export async function saveActualResults(cities) {
  const payload = {
    cities,
    updatedAt: new Date().toISOString()
  };

  if (mode === "firebase" && db && firestoreApi) {
    const { doc, setDoc } = firestoreApi;
    await setDoc(doc(db, "actual_results", "2026"), payload);
    return payload;
  }

  localStorage.setItem(LOCAL_ACTUALS_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
  return payload;
}

/**
 * 讀取開票結果（支援即時訂閱）
 */
export function subscribeActualResults(callback) {
  if (mode === "firebase" && db && firestoreApi) {
    const { doc, onSnapshot } = firestoreApi;
    return onSnapshot(doc(db, "actual_results", "2026"), (docSnap) => {
      callback(docSnap.exists() ? docSnap.data() : { cities: {} });
    });
  }

  const emitLocal = () => callback(readLocalActuals());
  emitLocal();
  window.addEventListener("local-storage-updated", emitLocal);
  return () => window.removeEventListener("local-storage-updated", emitLocal);
}

/**
 * 清除本機試玩資料
 */
export function clearLocalData() {
  localStorage.removeItem(LOCAL_PREDICTIONS_KEY);
  localStorage.removeItem(LOCAL_ACTUALS_KEY);
  window.dispatchEvent(new CustomEvent("local-storage-updated"));
}

function readLocalPredictions() {
  try {
    const raw = localStorage.getItem(LOCAL_PREDICTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function readLocalActuals() {
  try {
    const raw = localStorage.getItem(LOCAL_ACTUALS_KEY);
    return raw ? JSON.parse(raw) : { cities: {} };
  } catch {
    return { cities: {} };
  }
}
