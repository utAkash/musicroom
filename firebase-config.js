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
  apiKey: "AIzaSyApCqXNAXpX8AN_L5Swm9IxEDhK39EkT4F0",
  authDomain: "musicroom-929bc.firebaseapp.com",
  databaseURL: "https://musicroom-929bc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "musicroom-929bc",
  storageBucket: "musicroom-929bc.firebasestorage.app",
  messagingSenderId: "270117794979",
  appId: "1:270117794979:web:5b8e1b507baba575bbfb16"
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
  let auth = null;
  let authPromise = null;
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
      auth = firebase.auth();
      database = firebase.database();
      console.info("[MusicRoom] Firebase Realtime Database connected.");
      return database;
    } catch (error) {
      lastError = error;
      console.error("[MusicRoom] Firebase initialization failed:", error);
      return null;
    }
  }

  function signInAnonymously() {
    if (!isFirebaseConfigured()) return Promise.resolve(null);
    if (!initFirebase() || !auth) return Promise.reject(lastError || new Error("Firebase is unavailable."));
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    if (!authPromise) {
      authPromise = auth.signInAnonymously()
        .then((credential) => credential.user)
        .catch((error) => {
          authPromise = null;
          lastError = error;
          throw error;
        });
    }
    return authPromise;
  }

  function getCurrentUser() {
    return auth && auth.currentUser ? auth.currentUser : null;
  }

  function getFirebaseError() {
    return lastError;
  }

  window.MusicRoomFirebase = {
    config: firebaseConfig,
    isConfigured: isFirebaseConfigured,
    init: initFirebase,
    signInAnonymously: signInAnonymously,
    getCurrentUser: getCurrentUser,
    getError: getFirebaseError
  };
})();
