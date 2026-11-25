// Firebase 設定檔
// 若要啟用多人即時連線與雲端排行榜，請到 Firebase Console (https://console.firebase.google.com/)
// 建立專案 -> 新增網頁應用程式 -> 複製 firebaseConfig 貼到下方。
// 若維持 apiKey 為空字串 ""，系統會自動使用本機「試玩模式 (LocalStorage)」，可直接測試所有功能！

export const firebaseConfig = {
  apiKey: "AIzaSyBK-JRJEembkDgE56STTcH6WpJ86sHnOTs",
  authDomain: "election2026-97e12.firebaseapp.com",
  projectId: "election2026-97e12",
  storageBucket: "election2026-97e12.firebasestorage.app",
  messagingSenderId: "427498512950",
  appId: "1:427498512950:web:13e2ea172af88e2594ae97",
  measurementId: "G-G7QY5VF49S"
};

// 管理員 Google Email（只有此信箱在 ?admin=1 登入後，才看得到並可操作「開票結果輸入」）
// 請同步在 Firebase Firestore Rules 加上相同 Email 限制！
export const adminEmail = "redteaplz@gmail.com";