/* ============================================================
   MusicRoom · Firebase configuration
   ------------------------------------------------------------
   1. Create a project at https://console.firebase.google.com
   2. Enable Realtime Database (start in test mode)
   3. Project settings → Your apps → Web app → Config
   4. Replace every YOUR_* value below with your own config.
   5. Add your database rules (see README.md).
   ============================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/* ============================================================
   Initialization — no edits required below this line.
   ============================================================ */

(function () {
  "use strict";

  const REQUIRED_KEYS = ["apiKey", "databaseURL", "projectId"];

  function isFirebaseConfigured() {
    return REQUIRED_KEYS.every((key) => {
      const value = String(firebaseConfig[key] || "").trim();
      return value.length > 0 && !value.includes("YOUR_") && !value.includes("your-project");
    });
  }

  let app = null;
  let database = null;
  let lastError = null;

  /**
   * Initializes Firebase using the v10 compatibility SDK.
   * Returns the Realtime Database instance, or null when the app is
   * deliberately running in local demo mode.
   */
  function initFirebase() {
    if (!isFirebaseConfigured()) {
      return null;
    }

    if (database) {
      return database;
    }

    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      lastError = new Error("The Firebase SDK has not loaded. Check your network connection and CDN import.");
      console.error("[MusicRoom]", lastError.message);
      return null;
    }

    try {
      app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      database = firebase.database();
      console.info("[MusicRoom] Firebase Realtime Database connected.");
      return database;
    } catch (error) {
      lastError = error;
      console.error("[MusicRoom] Firebase initialization failed:", error);
      return null;
    }
  }

  function getFirebaseError() {
    return lastError;
  }

  window.MusicRoomFirebase = {
    config: firebaseConfig,
    isConfigured: isFirebaseConfigured,
    init: initFirebase,
    getError: getFirebaseError
  };
})();
