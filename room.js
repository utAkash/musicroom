/* ============================================================
   MusicRoom · Synchronization & room engine
   ------------------------------------------------------------
   YouTube search is optional. Add a YouTube Data API v3 key below
   for the global catalog. Without a key, the built-in starter
   catalog and direct YouTube links continue to work.
   ============================================================ */

const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY_HERE";

(function () {
  "use strict";

  /* ------------------------------------------------------------
     Constants & catalog
     ------------------------------------------------------------ */

  const SESSION_KEY = "musicroom.session.v1";
  const ROOM_PREFIX = "musicroom.room.";
  const VOLUME_KEY = "musicroom.volume";
  const AVATAR_COLORS = ["green", "amber", "blue", "pink", "red", ""];
  const SYNC_THRESHOLD_SECONDS = 3;
  const BROADCAST_INTERVAL_MS = 3000;
  const STARTER_CATALOG = [
    { videoId: "sBzrzS1Ag_g", title: "The Less I Know The Better", channel: "Tame Impala", durationSeconds: 216 },
    { videoId: "dX3k_QDnzHE", title: "Midnight City", channel: "M83", durationSeconds: 243 },
    { videoId: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody", channel: "Queen", durationSeconds: 355 },
    { videoId: "JGwWNGJdvx8", title: "Shape of You", channel: "Ed Sheeran", durationSeconds: 264 },
    { videoId: "9bZkp7q19f0", title: "Gangnam Style", channel: "PSY", durationSeconds: 253 },
    { videoId: "kJQP7kiw5Fk", title: "Despacito", channel: "Luis Fonsi ft. Daddy Yankee", durationSeconds: 281 },
    { videoId: "OPf0YbXqDm0", title: "Uptown Funk", channel: "Mark Ronson ft. Bruno Mars", durationSeconds: 270 },
    { videoId: "60ItHLz5WEA", title: "Faded", channel: "Alan Walker", durationSeconds: 212 },
    { videoId: "RgKAFK5djSk", title: "See You Again", channel: "Wiz Khalifa ft. Charlie Puth", durationSeconds: 238 },
    { videoId: "hTWKbfoikeg", title: "Smells Like Teen Spirit", channel: "Nirvana", durationSeconds: 301 },
    { videoId: "YQHsXMglC9A", title: "Hello", channel: "Adele", durationSeconds: 367 },
    { videoId: "kXYiU_JCYtU", title: "Numb", channel: "Linkin Park", durationSeconds: 187 },
    { videoId: "7wtfhZwyrcc", title: "Believer", channel: "Imagine Dragons", durationSeconds: 217 },
    { videoId: "TUVcZfQe-Kw", title: "Levitating", channel: "Dua Lipa", durationSeconds: 203 },
    { videoId: "e-ORhEE9VVg", title: "Blank Space", channel: "Taylor Swift", durationSeconds: 272 },
    { videoId: "2vjPBrBU-TM", title: "Chandelier", channel: "Sia", durationSeconds: 232 },
    { videoId: "JRfuAukYTKg", title: "Titanium", channel: "David Guetta ft. Sia", durationSeconds: 245 },
    { videoId: "pFptt7Cargc", title: "Let It Happen", channel: "Tame Impala", durationSeconds: 467 },
    { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", durationSeconds: 213 },
    { videoId: "fHiGbolFFGw", title: "Weird Fishes / Arpeggi", channel: "Radiohead", durationSeconds: 318 }
  ].map((track) => ({
    ...track,
    thumbnail: `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
  }));

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  /* ------------------------------------------------------------
     Application state
     ------------------------------------------------------------ */

  const params = new URLSearchParams(window.location.search);
  let database = null;
  let cloudEnabled = false;
  let room = null;
  let code = "";
  let session = readSession();
  let channel = null;
  let unsubscribeLocal = null;
  let hasLoadedRoom = false;
  let participantEnsured = false;
  let leaving = false;

  let player = null;
  let ytApiReady = false;
  let playerReady = false;
  let loadedVideoId = null;
  let audioBlocked = false;
  let audioCheckTimer = 0;
  let playerErrorIds = new Set();

  let activeTab = "queue";
  let repeatEnabled = false;
  let seeking = false;
  let volume = readVolume();
  let muted = false;
  let lastTimelineUpdate = 0;
  let lastChatSignature = "";
  let lastChatCount = 0;
  let chatInitialised = false;
  let forceChatScroll = false;
  let hostBroadcastInFlight = false;
  let serverTimeOffset = 0;

  function serverNow() {
    return Date.now() + serverTimeOffset;
  }

  let searchState = { results: [], query: "", loading: false, mode: "local" };
  let youtubeKeyConfigured = /^AIza[0-9A-Za-z_-]{20,}$/.test(YOUTUBE_API_KEY) && !YOUTUBE_API_KEY.includes("YOUR_");
  let shareModalElement = null;
  let lastFocusedElement = null;

  /* ------------------------------------------------------------
     Small utilities
     ------------------------------------------------------------ */

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeSession(value) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch (error) {
      console.warn("[MusicRoom] Session storage unavailable.", error);
    }
  }

  function readVolume() {
    try {
      const stored = Number(localStorage.getItem(VOLUME_KEY));
      return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 80;
    } catch (error) {
      return 80;
    }
  }

  function saveVolume() {
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch (error) {
      /* Local persistence is optional. */
    }
  }

  function createId(prefix = "id") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    }
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
  }

  function initialsFor(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorForId(id) {
    let hash = 0;
    for (let i = 0; i < String(id).length; i += 1) hash = (hash * 31 + String(id).charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#039;";
        default: return character;
      }
    });
  }

  function decodeHtml(value) {
    const element = document.createElement("textarea");
    element.innerHTML = String(value || "");
    return element.value;
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(toNumber(totalSeconds)));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatRelative(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - toNumber(timestamp, Date.now())) / 1000));
    if (seconds < 45) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  function formatMinutes(seconds) {
    const mins = Math.round(toNumber(seconds) / 60);
    return `${mins} min of music`;
  }

  function thumbFor(song) {
    if (song && typeof song.thumbnail === "string" && /^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(song.thumbnail)) {
      return song.thumbnail;
    }
    const videoId = song && song.videoId ? song.videoId : "";
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }

  function avatarColor(color) {
    return AVATAR_COLORS.includes(color) ? color : "";
  }

  function normalizeRoom(data) {
    const normalized = { ...(data || {}) };
    normalized.queue = normalized.queue && typeof normalized.queue === "object" ? normalized.queue : {};
    normalized.users = normalized.users && typeof normalized.users === "object" ? normalized.users : {};
    normalized.messages = normalized.messages && typeof normalized.messages === "object" ? normalized.messages : {};
    normalized.queue = Object.fromEntries(
      Object.entries(normalized.queue).filter(([, song]) => song && typeof song === "object" && song.videoId)
    );
    normalized.currentTime = Math.max(0, toNumber(normalized.currentTime));
    normalized.currentTimeAt = toNumber(normalized.currentTimeAt, Date.now());
    normalized.isPlaying = Boolean(normalized.isPlaying);
    return normalized;
  }

  /* ------------------------------------------------------------
     Toasts
     ------------------------------------------------------------ */

  const TOAST_ICONS = {
    default: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    success: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>',
    error: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>'
  };

  function toast(message, type = "default", title = "") {
    const stack = $("#toastStack");
    if (!stack) return;

    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.default;

    const copy = document.createElement("div");
    copy.className = "toast-copy";
    if (title) {
      const heading = document.createElement("strong");
      heading.textContent = title;
      copy.appendChild(heading);
    }
    const line = document.createElement("span");
    line.textContent = message;
    copy.appendChild(line);

    item.append(icon, copy);
    stack.appendChild(item);

    const dismiss = () => {
      item.classList.add("out");
      window.setTimeout(() => item.remove(), 240);
    };

    window.setTimeout(dismiss, type === "error" ? 6200 : 4200);
    item.addEventListener("click", dismiss);
  }

  /* ------------------------------------------------------------
     Presence & room bootstrapping
     ------------------------------------------------------------ */

  function normalizeSession() {
    if (!session || !session.userId) {
      const name = cleanName(params.get("name")) || "Guest";
      const userId = createId("guest");
      session = {
        userId,
        userName: name,
        userInitials: initialsFor(name),
        userColor: colorForId(userId),
        roomCode: code,
        at: Date.now()
      };
      writeSession(session);
    }
    session.userName = cleanName(session.userName) || "Guest";
    session.userInitials = session.userInitials || initialsFor(session.userName);
    session.userColor = session.userColor || colorForId(session.userId);
    session.roomCode = code;
    writeSession(session);
    return session;
  }

  function selfUser() {
    if (room && room.users && room.users[session.userId]) return room.users[session.userId];
    return {
      id: session.userId,
      name: session.userName,
      initials: session.userInitials || initialsFor(session.userName),
      color: session.userColor || colorForId(session.userId),
      host: Boolean(room && room.hostId === session.userId),
      online: true
    };
  }

  function ensureParticipant() {
    if (!room || participantEnsured) return;
    const existing = room.users[session.userId];
    const isHost = room.hostId === session.userId;
    const user = {
      id: session.userId,
      name: session.userName,
      initials: session.userInitials || initialsFor(session.userName),
      color: session.userColor || colorForId(session.userId),
      host: Boolean(isHost),
      online: true,
      joinedAt: existing && existing.joinedAt ? existing.joinedAt : Date.now()
    };

    participantEnsured = true;
    room.users[session.userId] = { ...(existing || {}), ...user };

    if (cloudEnabled && database) {
      const userRef = database.ref(`rooms/${code}/users/${session.userId}`);
      userRef.set(room.users[session.userId]).catch((error) => {
        console.error("[MusicRoom] Could not save participant:", error);
        toast("We couldn't register you in this room. Check your connection.", "error", "Presence unavailable");
      });

      database.ref(".info/connected").on("value", (snapshot) => {
        if (snapshot.val() === true) {
          userRef.onDisconnect().update({ online: false }).catch(() => {});
          userRef.update({ online: true }).catch(() => {});
        }
      });

      if (!existing) {
        const joinId = `joined_${session.userId}`;
        database.ref(`rooms/${code}/messages/${joinId}`).set({
          id: joinId,
          type: "system",
          text: `${user.name} joined the room.`,
          at: Date.now()
        }).catch(() => {});
      }
    } else {
      if (!existing) {
        const joinId = `joined_${session.userId}`;
        room.messages[joinId] = {
          id: joinId,
          type: "system",
          text: `${user.name} joined the room.`,
          at: Date.now()
        };
      }
      localCommit(false);
    }
  }

  function markOffline() {
    if (!room || !session || leaving) return;
    leaving = true;
    if (cloudEnabled && database) {
      database.ref(`rooms/${code}/users/${session.userId}/online`).set(false).catch(() => {});
    } else if (room.users && room.users[session.userId]) {
      room.users[session.userId].online = false;
      room.users[session.userId].lastSeen = Date.now();
      localCommit(false);
    }
  }

  function markOnlineAgain() {
    if (!session || !room) return;
    leaving = false;
    if (cloudEnabled && database) {
      database.ref(`rooms/${code}/users/${session.userId}/online`).set(true).catch(() => {});
    } else if (room.users && room.users[session.userId]) {
      room.users[session.userId].online = true;
      localCommit(false);
    }
  }

  function userRefPath() {
    return `rooms/${code}/users/${session.userId}`;
  }

  /* ------------------------------------------------------------
     Local & cloud adapters
     ------------------------------------------------------------ */

  function localRoomKey() {
    return `${ROOM_PREFIX}${code}`;
  }

  function getLocalRoom() {
    try {
      const raw = localStorage.getItem(localRoomKey());
      return raw ? normalizeRoom(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function localCommit(reRender = true) {
    if (!room) return;
    room.updatedAt = Date.now();
    try {
      localStorage.setItem(localRoomKey(), JSON.stringify(room));
    } catch (error) {
      toast("This browser couldn't save the room state. Private mode may be blocking storage.", "error", "Storage blocked");
    }
    if (channel) {
      try {
        channel.postMessage({ type: "room", code, room });
      } catch (error) {
        /* A different tab may have closed the channel. */
      }
    }
    if (reRender) {
      renderAll();
      applyPlaybackSync();
    }
  }

  function setByPath(target, path, value) {
    const keys = path.split("/");
    let cursor = target;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        cursor[key] = value;
        return;
      }
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
      cursor = cursor[key];
    });
  }

  function removeByPath(target, path) {
    const keys = path.split("/");
    let cursor = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!cursor || typeof cursor !== "object") return;
      cursor = cursor[keys[i]];
    }
    if (cursor && typeof cursor === "object") delete cursor[keys[keys.length - 1]];
  }

  async function setPath(path, value) {
    if (!room) return;
    if (cloudEnabled && database) {
      try {
        await database.ref(`rooms/${code}/${path}`).set(value);
      } catch (error) {
        console.error("[MusicRoom] Write failed:", error);
        toast("Couldn't save that to the room. Check your connection and try again.", "error", "Write failed");
      }
      return;
    }
    setByPath(room, path, value);
    localCommit(true);
  }

  async function removePath(path) {
    if (!room) return;
    if (cloudEnabled && database) {
      try {
        await database.ref(`rooms/${code}/${path}`).remove();
      } catch (error) {
        toast("Couldn't remove that right now.", "error", "Write failed");
      }
      return;
    }
    removeByPath(room, path);
    localCommit(true);
  }

  async function updateRoot(patch) {
    if (!room) return;
    const safePatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(safePatch, "currentTimeAt")) {
      safePatch.currentTimeAt = serverNow();
    }
    if (cloudEnabled && database) {
      try {
        await database.ref(`rooms/${code}`).update(safePatch);
      } catch (error) {
        console.error("[MusicRoom] Update failed:", error);
        toast("The room couldn't be updated. Check your connection.", "error", "Sync interrupted");
      }
      return;
    }
    room = normalizeRoom({ ...room, ...safePatch, updatedAt: Date.now() });
    localCommit(true);
  }

  function subscribeToRoom() {
    if (cloudEnabled && database) {
      const roomRef = database.ref(`rooms/${code}`);
      roomRef.on("value", (snapshot) => {
        if (!snapshot.exists()) {
          if (!hasLoadedRoom) showRoomError("We couldn't find that room.", "It may have been deleted, or the code may be wrong. Head back and try again.");
          return;
        }
        applyIncomingRoom(snapshot.val());
      }, (error) => {
        console.error("[MusicRoom] Database read failed:", error);
        showRoomError("The database said no.", "Firebase rejected this read. Check that Realtime Database is enabled and your security rules allow access.");
      });
      return;
    }

    const initial = getLocalRoom();
    if (!initial) {
      showRoomError("That room isn't on this device.", "Local demo rooms live in your browser. Head back and create or join a room first.");
      return;
    }

    applyIncomingRoom(initial);

    const onStorage = (event) => {
      if (event.key !== localRoomKey() || !event.newValue) return;
      try {
        applyIncomingRoom(JSON.parse(event.newValue));
      } catch (error) {
        console.warn("[MusicRoom] Ignored an unreadable local update.");
      }
    };

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("musicroom.live");
      channel.onmessage = (event) => {
        const message = event.data;
        if (!message || message.code !== code || message.type !== "room" || !message.room) return;
        applyIncomingRoom(message.room);
      };
    }

    window.addEventListener("storage", onStorage);
    unsubscribeLocal = () => window.removeEventListener("storage", onStorage);
  }

  function applyIncomingRoom(data) {
    const normalized = normalizeRoom(data);
    if (!normalized.code) normalized.code = code;
    room = normalized;
    const firstLoad = !hasLoadedRoom;
    hasLoadedRoom = true;
    revealRoom();
    normalizeSession();
    ensureParticipant();
    renderAll();
    applyPlaybackSync(firstLoad);
    updateSyncBadge();
    if (firstLoad) {
      window.setTimeout(() => {
        if (!playerReady && !document.hidden) loadYouTubeApi();
      }, 60);
    }
  }

  function revealRoom() {
    const roomPage = $("#roomPage");
    const loading = $("#roomLoading");
    const error = $("#roomError");
    if (roomPage) roomPage.hidden = false;
    if (loading) loading.hidden = true;
    if (error) error.hidden = true;
  }

  function showRoomError(title, message) {
    const roomPage = $("#roomPage");
    const loading = $("#roomLoading");
    const error = $("#roomError");
    if (roomPage) roomPage.hidden = true;
    if (loading) loading.hidden = true;
    if (error) error.hidden = false;
    const titleNode = $("#roomErrorTitle");
    const messageNode = $("#roomErrorMessage");
    if (titleNode) titleNode.textContent = title;
    if (messageNode) messageNode.textContent = message;
    document.title = "Room unavailable · MusicRoom";
  }

  /* ------------------------------------------------------------
     Playback helpers / YouTube IFrame API
     ------------------------------------------------------------ */

  function onlineUsers() {
    if (!room) return [];
    return Object.values(room.users).filter((user) => user && user.online !== false);
  }

  function sortedQueue() {
    if (!room) return [];
    return Object.values(room.queue)
      .filter((song) => song && song.videoId)
      .sort((a, b) => {
        const votesA = voteCount(a);
        const votesB = voteCount(b);
        if (votesB !== votesA) return votesB - votesA;
        return toNumber(a.addedAt) - toNumber(b.addedAt);
      });
  }

  function voteCount(song) {
    if (!song || !song.votes) return 0;
    if (typeof song.votes === "number") return song.votes;
    return Object.values(song.votes).filter(Boolean).length;
  }

  function hasVoted(song) {
    if (!song || !song.votes || typeof song.votes !== "object") return false;
    return Boolean(song.votes[session.userId]);
  }

  function currentBroadcasterId() {
    if (!room) return "";
    const host = room.users && room.users[room.hostId];
    if (host && host.online !== false) return room.hostId;
    const online = onlineUsers().sort((a, b) => toNumber(a.joinedAt) - toNumber(b.joinedAt));
    return online.length ? online[0].id : room.hostId;
  }

  function isBroadcaster() {
    return Boolean(room && currentBroadcasterId() === session.userId);
  }

  function expectedPlaybackTime() {
    if (!room || !room.currentSong) return 0;
    const base = Math.max(0, toNumber(room.currentTime));
    if (!room.isPlaying) return base;
    const elapsed = Math.max(0, (serverNow() - toNumber(room.currentTimeAt, serverNow())) / 1000);
    return base + elapsed;
  }

  function ownPlayerTime() {
    if (playerReady && player && typeof player.getCurrentTime === "function") {
      const time = toNumber(player.getCurrentTime());
      if (time > 0 || expectedPlaybackTime() < 1) return time;
    }
    return expectedPlaybackTime();
  }

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) {
      ytApiReady = true;
      ensurePlayer();
      return;
    }
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;

    const priorCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function onReady() {
      ytApiReady = true;
      if (typeof priorCallback === "function") priorCallback();
      ensurePlayer();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      console.warn("[MusicRoom] YouTube IFrame API could not load.");
    };
    document.head.appendChild(script);
  }

  function ensurePlayer() {
    if (!ytApiReady || !room || !room.currentSong) return;
    if (player) {
      const targetVideo = room.currentSong.videoId;
      if (targetVideo !== loadedVideoId) {
        loadSongIntoPlayer(room.currentSong, expectedPlaybackTime());
      }
      return;
    }

    const target = $("#yt-player");
    if (!target) return;

    try {
      player = new window.YT.Player("yt-player", {
        width: "100%",
        height: "100%",
        videoId: room.currentSong.videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError
        }
      });
      loadedVideoId = room.currentSong.videoId;
    } catch (error) {
      console.error("[MusicRoom] Player initialization failed:", error);
    }
  }

  function onPlayerReady(event) {
    playerReady = true;
    if (player && typeof player.setVolume === "function") {
      player.setVolume(muted ? 0 : volume);
    }
    if (room && room.currentSong) {
      try {
        player.seekTo(Math.max(0, expectedPlaybackTime()), true);
      } catch (error) {
        /* Seeking before a video is cued is harmless. */
      }
      applyPlaybackSync(true);
    }
  }

  function onPlayerStateChange(event) {
    if (!window.YT) return;
    if (event.data === window.YT.PlayerState.PLAYING) {
      audioBlocked = false;
      const unlock = $("#audioUnlock");
      if (unlock) unlock.hidden = true;
      updateSyncBadge();
    }
    if (event.data === window.YT.PlayerState.ENDED) {
      handleTrackEnded();
    }
  }

  function onPlayerError(event) {
    const song = room && room.currentSong;
    if (!song) return;
    const errorCode = event && event.data ? event.data : 0;
    if (!playerErrorIds.has(song.id)) {
      playerErrorIds.add(song.id);
      const messages = {
        2: "The video ID looks invalid.",
        5: "YouTube couldn't play this video here.",
        100: "This video is private or unavailable.",
        101: "The uploader doesn't allow this video to be embedded.",
        150: "The uploader doesn't allow this video to be embedded."
      };
      toast(`${messages[errorCode] || "This video can't be played in the room."} Try another pick.`, "error", "Playback blocked");
    }
    if (isBroadcaster() && !leaving) {
      window.setTimeout(() => {
        if (room && room.currentSong && room.currentSong.id === song.id) playRelative(1);
      }, 1600);
    }
  }

  function loadSongIntoPlayer(song, startSeconds) {
    if (!player || !playerReady || !song) return;
    try {
      loadedVideoId = song.videoId;
      const at = Math.max(0, startSeconds || 0);
      if (room && !room.isPlaying && typeof player.cueVideoById === "function") {
        player.cueVideoById({ videoId: song.videoId, startSeconds: at });
        window.setTimeout(() => {
          if (player && room && !room.isPlaying) {
            try { player.seekTo(at, true); } catch (error) { /* The cue may still be loading. */ }
          }
        }, 450);
        return;
      }
      player.loadVideoById({ videoId: song.videoId, startSeconds: at });
      window.setTimeout(() => {
        if (room && !room.isPlaying && player && typeof player.pauseVideo === "function") player.pauseVideo();
        else applyPlaybackSync(true);
      }, 550);
    } catch (error) {
      console.error("[MusicRoom] Could not load the video:", error);
    }
  }

  function applyPlaybackSync(force = false) {
    if (!room || !room.currentSong) {
      if (player && playerReady && typeof player.pauseVideo === "function") {
        try { player.pauseVideo(); } catch (error) { /* no-op */ }
      }
      loadedVideoId = null;
      return;
    }

    ensurePlayer();
    if (!playerReady || !player) {
      if (isBroadcaster() && room.isPlaying) {
        window.setTimeout(() => applyPlaybackSync(true), 900);
      }
      return;
    }

    const song = room.currentSong;
    if (loadedVideoId !== song.videoId) {
      loadSongIntoPlayer(song, expectedPlaybackTime());
      return;
    }

    const expected = expectedPlaybackTime();
    let state = null;
    try {
      state = player.getPlayerState();
    } catch (error) {
      return;
    }

    if (room.isPlaying) {
      const local = toNumber(player.getCurrentTime());
      if (force || state === window.YT.PlayerState.PAUSED || state === window.YT.PlayerState.CUED || state === -1) {
        if (Math.abs(local - expected) > 1) {
          try { player.seekTo(Math.max(0, expected), true); } catch (error) { /* no-op */ }
        }
        try { player.playVideo(); } catch (error) { /* The browser may require a tap. */ }
        scheduleAudioCheck();
      } else if (state === window.YT.PlayerState.PLAYING && Math.abs(local - expected) > SYNC_THRESHOLD_SECONDS) {
        try { player.seekTo(Math.max(0, expected), true); } catch (error) { /* no-op */ }
      }
    } else if (state === window.YT.PlayerState.PLAYING) {
      try { player.pauseVideo(); } catch (error) { /* no-op */ }
      try { player.seekTo(Math.max(0, expected), true); } catch (error) { /* no-op */ }
      audioBlocked = false;
      const unlock = $("#audioUnlock");
      if (unlock) unlock.hidden = true;
    } else if (Math.abs(toNumber(player.getCurrentTime()) - expected) > 1.5) {
      try { player.seekTo(Math.max(0, expected), true); } catch (error) { /* no-op */ }
    }
  }

  function scheduleAudioCheck() {
    window.clearTimeout(audioCheckTimer);
    audioCheckTimer = window.setTimeout(() => {
      if (!room || !room.isPlaying || !playerReady || !player) return;
      let state = -1;
      try { state = player.getPlayerState(); } catch (error) { return; }
      if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
        audioBlocked = true;
        const unlock = $("#audioUnlock");
        if (unlock) unlock.hidden = false;
        updateSyncBadge();
      }
    }, 1450);
  }

  function unlockAudio() {
    if (!room || !room.currentSong) return;
    ensurePlayer();
    if (!playerReady || !player) {
      toast("The player is still warming up. Give it a second.", "default");
      return;
    }
    try {
      player.unMute();
      muted = false;
      player.setVolume(volume);
      player.seekTo(Math.max(0, expectedPlaybackTime()), true);
      player.playVideo();
      const unlock = $("#audioUnlock");
      if (unlock) unlock.hidden = true;
      audioBlocked = false;
      window.setTimeout(() => {
        if (player && player.getPlayerState() === window.YT.PlayerState.PLAYING) {
          toast("You're in. The room is synced.", "success");
        }
      }, 700);
    } catch (error) {
      toast("Tap the YouTube play button once, then use the room controls.", "default");
    }
    updateSyncBadge();
  }

  function handleTrackEnded() {
    if (!room || advanceLocked) return;
    if (room.repeat) {
      if (isBroadcaster()) {
        updateRoot({ currentTime: 0, currentTimeAt: Date.now(), isPlaying: true });
        if (player && playerReady) {
          try { player.seekTo(0, true); player.playVideo(); } catch (error) { /* no-op */ }
        }
      }
      return;
    }
    if (!isBroadcaster()) return;

    advanceLocked = true;
    window.setTimeout(() => {
      if (room && room.currentSong) playRelative(1, true);
      advanceLocked = false;
    }, 300);
  }

  let advanceLocked = false;

  function startSong(song) {
    if (!room || !song || !song.videoId) return;
    const cleanSong = {
      id: song.id || createId("song"),
      videoId: song.videoId,
      title: song.title || "YouTube video",
      channel: song.channel || "YouTube",
      thumbnail: thumbFor(song),
      durationSeconds: Math.max(0, toNumber(song.durationSeconds)),
      addedBy: song.addedBy || session.userId,
      addedByName: song.addedByName || session.userName,
      addedAt: toNumber(song.addedAt, Date.now()),
      votes: song.votes && typeof song.votes === "object" ? song.votes : {}
    };
    playerErrorIds = new Set();
    audioBlocked = false;
    updateRoot({
      currentSong: cleanSong,
      isPlaying: true,
      currentTime: 0,
      currentTimeAt: Date.now()
    });
    window.setTimeout(() => {
      applyPlaybackSync(true);
      scheduleAudioCheck();
    }, 80);
  }

  function playRelative(direction, fromEnded = false) {
    if (!room) return;
    const queue = sortedQueue();

    if (!room.currentSong) {
      if (!queue.length) {
        toast("The queue is empty. Add a song first.", "default", "Nothing to play");
        return;
      }
      startSong(queue[0]);
      return;
    }

    if (direction < 0 && playerReady && player && !fromEnded) {
      const localTime = toNumber(player.getCurrentTime());
      if (localTime > 5) {
        updateRoot({ currentTime: 0, currentTimeAt: Date.now() });
        try { player.seekTo(0, true); } catch (error) { /* no-op */ }
        return;
      }
    }

    let currentIndex = queue.findIndex((song) => song.id === room.currentSong.id || song.videoId === room.currentSong.videoId);
    if (currentIndex === -1) currentIndex = direction > 0 ? -1 : 0;
    let nextIndex = currentIndex + direction;
    if (nextIndex >= queue.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = queue.length - 1;

    if (!queue.length) {
      toast("Nothing else in the queue. Add another track.", "default", "End of the queue");
      return;
    }

    const nextSong = queue[nextIndex];
    if (!nextSong) {
      toast("Nothing else in the queue. Add another track.", "default", "End of the queue");
      return;
    }
    startSong(nextSong);
  }

  function togglePlayback() {
    if (!room) return;
    if (!room.currentSong) {
      const queue = sortedQueue();
      if (queue.length) {
        startSong(queue[0]);
      } else {
        toast("Add a song first and the room will come alive.", "default", "Nothing queued yet");
        $("#searchInput")?.focus();
      }
      return;
    }

    const nextIsPlaying = !room.isPlaying;
    const localTime = ownPlayerTime();
    updateRoot({
      isPlaying: nextIsPlaying,
      currentTime: Math.max(0, localTime),
      currentTimeAt: Date.now()
    });

    if (!nextIsPlaying) {
      if (playerReady && player) {
        try { player.pauseVideo(); } catch (error) { /* no-op */ }
      }
    } else {
      window.setTimeout(() => {
        applyPlaybackSync(true);
        scheduleAudioCheck();
      }, 80);
    }
    updateSyncBadge();
  }

  function seekTo(seconds) {
    if (!room || !room.currentSong) return;
    const duration = room.currentSong.durationSeconds || (playerReady && player ? player.getDuration() : 0);
    const target = clamp(toNumber(seconds), 0, Math.max(0, toNumber(duration)));
    updateRoot({ currentTime: target, currentTimeAt: Date.now() });
    if (playerReady && player) {
      try { player.seekTo(target, true); } catch (error) { /* no-op */ }
    }
  }

  function syncNow() {
    if (!room || !room.currentSong) {
      toast("There's nothing to sync yet.", "default");
      return;
    }
    if (!playerReady || !player) {
      toast("The player is still loading. Try again in a moment.", "default");
      return;
    }
    try {
      player.seekTo(Math.max(0, expectedPlaybackTime()), true);
      if (room.isPlaying) player.playVideo();
      toast("Playback pulled back to the room's timeline.", "success", "Back in sync");
    } catch (error) {
      toast("Couldn't seek this video. Try reloading the room.", "error");
    }
    updateSyncBadge();
  }

  /* ------------------------------------------------------------
     Rendering
     ------------------------------------------------------------ */

  function renderAll() {
    if (!room) return;
    renderHeader();
    renderNowPlaying();
    renderQueue();
    renderChat();
    renderPeople();
    renderTabs();
    syncControls();
    updateTimeline(true);
    updateShareFields();
  }

  function renderHeader() {
    const online = onlineUsers();
    const name = room.name || "Listening room";
    const roomName = $("#roomName");
    const smallCode = $("#roomCodeSmall");
    const navCode = $("#navRoomCode");
    const codeField = $("#roomCodeField");

    if (roomName) roomName.textContent = name;
    if (smallCode) smallCode.textContent = code;
    if (navCode) navCode.textContent = code;
    if (codeField) codeField.value = code;
    document.title = `${name} · MusicRoom`;

    const listenerCount = online.length;
    const listenerNode = $("#listenerCount");
    const headerNode = $("#headerListenerCount");
    const chatOnline = $("#chatOnlineCount");
    const singular = listenerCount === 1;
    if (listenerNode) listenerNode.textContent = String(listenerCount);
    const listenerLabel = $("#listenerLabel");
    if (listenerLabel) listenerLabel.textContent = singular ? "listening" : "listening";
    if (headerNode) headerNode.textContent = `${listenerCount} listening`;
    if (chatOnline) chatOnline.textContent = `${listenerCount} online`;

    const stack = $("#headerAvatars");
    if (stack) {
      stack.innerHTML = online
        .slice(0, 4)
        .map((user) => `<span class="avatar sm ${avatarColor(user.color)}">${escapeHtml(user.initials || initialsFor(user.name))}</span>`)
        .join("");
    }

    const self = selfUser();
    const selfAvatar = $("#selfAvatar");
    if (selfAvatar) {
      selfAvatar.textContent = self.initials || initialsFor(self.name);
      selfAvatar.className = `avatar sm ${avatarColor(self.color)}`;
      selfAvatar.title = self.name;
    }
  }

  function renderNowPlaying() {
    const song = room.currentSong;
    const empty = $("#playerEmpty");
    const badge = $("#videoBadge");
    const badgeText = $("#videoBadgeText");
    const thumb = $("#npThumb");
    const title = $("#npTitle");
    const channel = $("#npChannel");
    const kicker = $("#npKickerText");
    const playState = $("#npPlayState");
    const addedBy = $("#npAddedBy");
    const addedName = $("#npAddedName");
    const addedAvatar = $("#npAddedAvatar");
    const videoType = $("#npVideoType");

    if (!song) {
      if (empty) empty.hidden = false;
      if (badge) badge.hidden = true;
      if (title) title.textContent = "Nothing playing yet";
      if (channel) channel.textContent = "Your room's soundtrack starts here";
      if (kicker) kicker.textContent = "Waiting for the first track";
      if (playState) playState.textContent = "Paused";
      if (addedBy) addedBy.hidden = true;
      if (thumb) thumb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;inset:0;margin:auto;" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      if (videoType) videoType.textContent = "YouTube";
      return;
    }

    if (empty) empty.hidden = true;
    if (badge) {
      badge.hidden = false;
      if (badgeText) badgeText.textContent = `${room.hostName ? `${room.hostName}'s room` : "Shared playback"}`;
    }
    if (thumb) {
      thumb.innerHTML = `<img src="${escapeHtml(thumbFor(song))}" alt="" loading="lazy" />`;
    }
    if (title) {
      title.textContent = song.title || "YouTube video";
      title.title = song.title || "YouTube video";
    }
    if (channel) channel.textContent = song.channel || "YouTube";
    if (kicker) kicker.textContent = room.isPlaying ? "Playing together" : "Paused · press play to resume";
    if (playState) playState.textContent = room.isPlaying ? "Playing" : "Paused";
    if (videoType) videoType.textContent = song.durationSeconds ? formatTime(song.durationSeconds) : "YouTube";

    if (addedBy) {
      addedBy.hidden = false;
      const addedByUser = room.users[song.addedBy];
      const displayName = song.addedByName || (addedByUser && addedByUser.name) || "someone";
      if (addedName) addedName.textContent = `Added by ${displayName}`;
      if (addedAvatar) {
        addedAvatar.textContent = initialsFor(displayName);
        addedAvatar.className = `avatar ${avatarColor(addedByUser ? addedByUser.color : colorForId(song.addedBy || displayName))}`;
      }
    }
  }

  function syncControls() {
    const isPlaying = Boolean(room && room.isPlaying && room.currentSong);
    const playIcon = $("#playIcon");
    const pauseIcon = $("#pauseIcon");
    const playButton = $("#playBtn");
    if (playIcon) playIcon.toggleAttribute("hidden", isPlaying);
    if (pauseIcon) pauseIcon.toggleAttribute("hidden", !isPlaying);
    if (playButton) {
      playButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
      playButton.title = isPlaying ? "Pause" : "Play";
    }
    const repeatButton = $("#repeatBtn");
    if (repeatButton) {
      repeatButton.setAttribute("aria-pressed", String(Boolean(room && room.repeat)));
      repeatButton.style.color = room && room.repeat ? "#c084fc" : "";
      repeatButton.style.background = room && room.repeat ? "rgba(168,85,247,.12)" : "";
    }
    const current = $("#npPlayState");
    if (current) current.textContent = isPlaying ? "Playing" : room && room.currentSong ? "Paused" : "Paused";
    updateSyncBadge();
  }

  function renderQueue() {
    const list = $("#queueList");
    if (!list) return;
    const queue = sortedQueue();
    const currentSong = room.currentSong;
    const queueTabCount = $("#queueCount");
    const queuePanelCount = $("#queuePanelCount");
    if (queueTabCount) queueTabCount.textContent = String(queue.length);
    if (queuePanelCount) queuePanelCount.textContent = `· ${queue.length} ${queue.length === 1 ? "song" : "songs"}`;

    const totalSeconds = queue.reduce((sum, song) => sum + toNumber(song.durationSeconds), 0);
    const totalNode = $("#queueTotalTime");
    if (totalNode) totalNode.textContent = formatMinutes(totalSeconds);

    if (!queue.length) {
      list.innerHTML = `
        <div class="queue-empty">
          <span class="ripple" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </span>
          <p>The queue is wide open</p>
          <span>Search for a song or paste a link. The first pick gets the room started.</span>
        </div>`;
      return;
    }

    list.innerHTML = queue.map((song, index) => {
      const playing = currentSong && (song.id === currentSong.id);
      const votes = voteCount(song);
      const voted = hasVoted(song);
      const requester = song.addedByName || (room.users[song.addedBy] && room.users[song.addedBy].name) || "someone";
      return `
        <article class="queue-item${playing ? " playing" : ""}" data-song-id="${escapeHtml(song.id)}">
          <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
          <div class="queue-thumb">
            <img src="${escapeHtml(thumbFor(song))}" alt="" loading="lazy" />
            <button type="button" data-queue-action="play" data-song-id="${escapeHtml(song.id)}" aria-label="Play ${escapeHtml(song.title)}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
          <div class="queue-info">
            <span class="queue-name" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span>
            <span class="queue-by">${escapeHtml(requester)} <span class="dot" aria-hidden="true"></span> ${escapeHtml(formatTime(song.durationSeconds))}${playing ? ' <span class="dot" aria-hidden="true"></span> playing' : ""}</span>
          </div>
          <button class="queue-vote${voted ? " voted" : ""}" type="button" data-queue-action="vote" data-song-id="${escapeHtml(song.id)}" aria-label="${voted ? "Remove vote" : "Vote for"} ${escapeHtml(song.title)}" title="${voted ? "Voted" : "Vote this up"}">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
            ${votes}
          </button>
          <button class="queue-remove" type="button" data-queue-action="remove" data-song-id="${escapeHtml(song.id)}" aria-label="Remove ${escapeHtml(song.title)} from queue" title="Remove from queue">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </article>`;
    }).join("");
  }

  function chatMessages() {
    if (!room) return [];
    return Object.values(room.messages)
      .filter((message) => message && (message.type === "system" || message.text))
      .sort((a, b) => toNumber(a.at) - toNumber(b.at));
  }

  function renderChat() {
    const list = $("#chatList");
    if (!list) return;
    const messages = chatMessages();
    const signature = messages.map((message) => `${message.id}:${String(message.text || "").length}:${message.at}`).join("|");
    const countNode = $("#chatCount");
    if (countNode) countNode.textContent = String(messages.filter((message) => message.type !== "system").length);

    if (signature === lastChatSignature) return;

    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    const shouldScroll = !chatInitialised || nearBottom || forceChatScroll || activeTab === "chat";
    const scrollToBottom = shouldScroll;

    if (!messages.length) {
      list.innerHTML = `
        <div class="chat-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>It's quiet in here</p>
          <span>Say hello, call a track, or just let the music do the talking.</span>
        </div>`;
    } else {
      list.innerHTML = messages.map((message) => {
        if (message.type === "system") {
          return `<div class="chat-system">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span>${escapeHtml(message.text)}</span>
          </div>`;
        }
        const own = message.uid === session.userId;
        const name = message.name || "Listener";
        const messageColor = avatarColor(message.color || colorForId(message.uid || name));
        return `<div class="chat-msg${own ? " own" : ""}">
          <span class="avatar ${messageColor}">${escapeHtml(message.initials || initialsFor(name))}</span>
          <div class="chat-content">
            <div class="chat-meta"><strong>${own ? "You" : escapeHtml(name)}</strong><span>${escapeHtml(formatRelative(message.at))}</span></div>
            <div class="chat-bubble">${escapeHtml(message.text)}</div>
          </div>
        </div>`;
      }).join("");
    }

    const newButton = $("#chatNew");
    if (scrollToBottom) {
      window.requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
      if (newButton) newButton.classList.remove("show");
    } else if (activeTab !== "chat" && messages.length > lastChatCount) {
      const dot = $("#chatTabDot");
      if (dot) dot.hidden = false;
    }

    forceChatScroll = false;
    lastChatSignature = signature;
    lastChatCount = messages.length;
    chatInitialised = true;
  }

  function renderPeople() {
    const list = $("#peopleList");
    if (!list) return;
    const users = Object.values(room.users).filter(Boolean);
    const online = users.filter((user) => user.online !== false).sort((a, b) => {
      if (a.host !== b.host) return a.host ? -1 : 1;
      return toNumber(a.joinedAt) - toNumber(b.joinedAt);
    });
    const offline = users.filter((user) => user.online === false);

    const peopleCount = $("#peopleTabCount");
    const peoplePanelCount = $("#peoplePanelCount");
    if (peopleCount) peopleCount.textContent = String(online.length);
    if (peoplePanelCount) peoplePanelCount.textContent = `· ${online.length} ${online.length === 1 ? "person" : "people"}`;

    const renderPerson = (user) => {
      const self = user.id === session.userId;
      const role = user.host ? "Host" : "Listener";
      return `<div class="person">
        <span class="avatar ${avatarColor(user.color)}">${escapeHtml(user.initials || initialsFor(user.name))}
          <span class="person-status${user.online === false ? " offline" : ""}" aria-label="${user.online === false ? "Offline" : "Online"}"></span>
        </span>
        <div class="person-info">
          <div class="person-name">${escapeHtml(user.name || "Listener")} ${self ? '<span class="you">(you)</span>' : ""}</div>
          <div class="person-sub">${user.online === false ? `Seen ${escapeHtml(formatRelative(user.lastSeen || user.joinedAt))} ago` : user.host ? "Keeping the room steady" : "Listening along"}</div>
        </div>
        <span class="role-badge ${user.host ? "host" : "listener"}">${role}</span>
      </div>`;
    };

    const self = selfUser();
    const selfOnline = online.some((user) => user.id === self.id);
    if (!selfOnline) {
      online.push({ ...self, online: true });
      const selfOfflineIndex = offline.findIndex((user) => user.id === self.id);
      if (selfOfflineIndex !== -1) offline.splice(selfOfflineIndex, 1);
    }

    list.innerHTML = `
      <div class="people-group-label">Here now · ${online.length}</div>
      ${online.map(renderPerson).join("")}
      ${offline.length ? `<div class="people-group-label">Stepped away · ${offline.length}</div>${offline.map(renderPerson).join("")}` : ""}
    `;
    const presence = $("#presenceLabel");
    if (presence) presence.textContent = `${online.length} online`;
  }

  function renderTabs() {
    const chatCount = $("#chatCount");
    if (chatCount) chatCount.textContent = String(chatMessages().filter((message) => message.type !== "system").length);
    const peopleCount = $("#peopleTabCount");
    if (peopleCount) peopleCount.textContent = String(onlineUsers().length);
    const queueCount = $("#queueCount");
    if (queueCount) queueCount.textContent = String(sortedQueue().length);
  }

  function updateTimeline(force = false) {
    if (!room) return;
    const now = Date.now();
    if (!force && now - lastTimelineUpdate < 220) return;
    lastTimelineUpdate = now;

    const slider = $("#seekSlider");
    const currentLabel = $("#currentTime");
    const durationLabel = $("#durationTime");
    const currentSong = room.currentSong;
    let duration = currentSong ? toNumber(currentSong.durationSeconds) : 0;
    let localTime = expectedPlaybackTime();

    if (playerReady && player && currentSong) {
      try {
        const playerDuration = toNumber(player.getDuration());
        if (playerDuration > 0) duration = playerDuration;
        if (player.getPlayerState() === window.YT.PlayerState.PLAYING || room.isPlaying) {
          const time = toNumber(player.getCurrentTime());
          if (time >= 0) localTime = time;
        }
      } catch (error) {
        /* The player may still be starting. */
      }
    }

    if (!currentSong) {
      if (slider && !seeking) {
        slider.value = "0";
        slider.style.setProperty("--fill", "0%");
      }
      if (currentLabel) currentLabel.textContent = "0:00";
      if (durationLabel) durationLabel.textContent = "0:00";
      return;
    }

    if (!duration) duration = Math.max(localTime, 1);
    const target = Math.min(localTime, duration);
    if (slider && !seeking) {
      const percent = duration > 0 ? clamp((target / duration) * 100, 0, 100) : 0;
      slider.value = String(target);
      slider.max = String(duration);
      slider.style.setProperty("--fill", `${percent}%`);
      slider.disabled = !currentSong;
    }
    if (currentLabel) currentLabel.textContent = formatTime(target);
    if (durationLabel) durationLabel.textContent = formatTime(duration);
  }

  function updateSyncBadge() {
    const pill = $("#syncPill");
    const text = $("#syncPillText");
    if (!pill || !text) return;
    if (!room || !room.currentSong) {
      text.textContent = "Ready";
      pill.classList.remove("syncing");
      return;
    }
    if (audioBlocked) {
      text.textContent = "Tap for audio";
      pill.classList.add("syncing");
      return;
    }
    if (isBroadcaster()) {
      text.textContent = "Host · syncing";
      pill.classList.remove("syncing");
      return;
    }
    if (!room.isPlaying) {
      text.textContent = "Paused in sync";
      pill.classList.remove("syncing");
      return;
    }
    text.textContent = "In sync";
    pill.classList.remove("syncing");
  }

  /* ------------------------------------------------------------
     Queue, chat, playback actions
     ------------------------------------------------------------ */

  function addToQueue(result, playNow = false) {
    if (!room || !result) return;
    const videoId = result.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) {
      toast("That doesn't look like a valid YouTube video.", "error");
      return;
    }

    const existing = Object.values(room.queue).find((song) => song.videoId === videoId);
    if (existing) {
      if (playNow) startSong(existing);
      else {
        toast("That one's already in the queue. Give it a vote instead.", "default", "Duplicate pick");
        setPath(`queue/${existing.id}/votes/${session.userId}`, true);
      }
      return;
    }

    const song = {
      id: createId("song"),
      videoId,
      title: result.title || "YouTube video",
      channel: result.channel || "YouTube",
      thumbnail: thumbFor(result),
      durationSeconds: Math.max(0, toNumber(result.durationSeconds)),
      addedBy: session.userId,
      addedByName: session.userName,
      addedAt: Date.now(),
      votes: {}
    };

    setPath(`queue/${song.id}`, song);
    if (playNow || !room.currentSong) {
      startSong(song);
      toast(`${song.title.length > 46 ? `${song.title.slice(0, 46)}…` : song.title} is up now.`, "success", playNow ? "Playing your pick" : "First song is on");
    } else {
      toast(`Added to the queue for ${session.userName}'s crew.`, "success", "Track added");
    }
  }

  function toggleVote(songId) {
    if (!room || !room.queue[songId]) return;
    const song = room.queue[songId];
    const voted = hasVoted(song);
    if (cloudEnabled && database) {
      if (voted) removePath(`queue/${songId}/votes/${session.userId}`);
      else setPath(`queue/${songId}/votes/${session.userId}`, true);
      return;
    }
    if (voted) {
      removeByPath(room, `queue/${songId}/votes/${session.userId}`);
    } else {
      setByPath(room, `queue/${songId}/votes/${session.userId}`, true);
    }
    localCommit(true);
  }

  function removeQueueSong(songId) {
    if (!room || !room.queue[songId]) return;
    const song = room.queue[songId];
    removePath(`queue/${songId}`);
    toast(`${song.title || "That track"} left the queue.`, "default", "Removed");
  }

  function sendChat(messageText) {
    const text = String(messageText || "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (!text || !room) return;
    const self = selfUser();
    const message = {
      id: createId("msg"),
      uid: session.userId,
      name: self.name || session.userName,
      initials: self.initials || initialsFor(self.name),
      color: self.color || colorForId(session.userId),
      text,
      at: Date.now()
    };
    forceChatScroll = true;
    setPath(`messages/${message.id}`, message);
    const dot = $("#chatTabDot");
    if (dot) dot.hidden = true;
  }

  /* ------------------------------------------------------------
     YouTube search & direct-link fallback
     ------------------------------------------------------------ */

  function extractVideoId(value) {
    const text = String(value || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    const patterns = [
      /(?:youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/i,
      /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
      /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
      /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
      /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/i,
      /(?:m\.youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function parseIsoDuration(value) {
    const match = String(value || "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!match) return 0;
    return toNumber(match[1]) * 86400 + toNumber(match[2]) * 3600 + toNumber(match[3]) * 60 + toNumber(match[4]);
  }

  async function resolveDirectLink(videoId) {
    let metadata = null;
    try {
      const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { cache: "no-store" });
      if (response.ok) metadata = await response.json();
    } catch (error) {
      /* oEmbed is a convenience; multiple providers are supported below. */
    }

    if (!metadata) {
      try {
        const response = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data && !data.error) metadata = data;
        }
      } catch (error) {
        /* Direct links still work without public metadata. */
      }
    }

    return {
      videoId,
      title: metadata && metadata.title ? decodeHtml(metadata.title) : "Shared YouTube track",
      channel: metadata && metadata.author_name ? decodeHtml(metadata.author_name) : "Direct YouTube link",
      durationSeconds: 0,
      thumbnail: metadata && metadata.thumbnail_url ? metadata.thumbnail_url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      direct: true
    };
  }

  async function searchSongs(query, prefetchedVideoId = null) {
    const term = String(query || "").trim();
    setSearchLoading(true);

    try {
      if (prefetchedVideoId) {
        const direct = await resolveDirectLink(prefetchedVideoId);
        searchState = { results: [direct], query: term, loading: false, mode: "direct" };
        renderSearchResults();
        setSearchModeLabel("Direct link");
        return;
      }

      if (!youtubeKeyConfigured) {
        const normalized = term.toLowerCase();
        const matches = STARTER_CATALOG.filter((song) => {
          if (!normalized) return true;
          return song.title.toLowerCase().includes(normalized) || song.channel.toLowerCase().includes(normalized);
        }).slice(0, 10);
        searchState = { results: matches, query: term, loading: false, mode: "local" };
        renderSearchResults();
        setSearchModeLabel("Local catalog");
        if (term && !matches.length) {
          toast("No local match. Paste a YouTube link to add anything you like.", "default", "Search the open web");
          openDirectLinkField();
        }
        return;
      }

      const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
      endpoint.searchParams.set("part", "snippet");
      endpoint.searchParams.set("type", "video");
      endpoint.searchParams.set("videoEmbeddable", "true");
      endpoint.searchParams.set("maxResults", "10");
      endpoint.searchParams.set("q", term || "music");
      endpoint.searchParams.set("key", YOUTUBE_API_KEY);

      const response = await fetch(endpoint.toString());
      if (!response.ok) {
        const errorInfo = await response.json().catch(() => ({}));
        const reason = errorInfo && errorInfo.error && Array.isArray(errorInfo.error.errors) ? errorInfo.error.errors[0].reason : "";
        const quotaReasons = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"];
        if (quotaReasons.includes(reason)) {
          throw Object.assign(new Error("YouTube API quota reached."), { quota: true });
        }
        if (response.status === 403) {
          throw new Error("YouTube rejected this API key. Check its API and website restrictions.");
        }
        throw new Error(`YouTube search failed (${response.status}).`);
      }

      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const ids = items.map((item) => item.id && item.id.videoId).filter(Boolean);
      const durations = {};

      if (ids.length) {
        try {
          const detailEndpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
          detailEndpoint.searchParams.set("part", "contentDetails");
          detailEndpoint.searchParams.set("id", ids.join(","));
          detailEndpoint.searchParams.set("key", YOUTUBE_API_KEY);
          const detailResponse = await fetch(detailEndpoint.toString());
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            (detailData.items || []).forEach((video) => {
              durations[video.id] = parseIsoDuration(video.contentDetails && video.contentDetails.duration);
            });
          }
        } catch (error) {
          /* Durations are an enhancement, never a blocker. */
        }
      }

      const results = ids.map((videoId, index) => {
        const snippet = items[index].snippet || {};
        const thumbnail = snippet.thumbnails && (snippet.thumbnails.medium || snippet.thumbnails.default);
        return {
          videoId,
          title: decodeHtml(snippet.title || "YouTube video"),
          channel: decodeHtml(snippet.channelTitle || "YouTube"),
          durationSeconds: durations[videoId] || 0,
          thumbnail: thumbnail ? thumbnail.url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        };
      });

      searchState = { results, query: term, loading: false, mode: "youtube" };
      renderSearchResults();
      setSearchModeLabel("YouTube API");
      if (!results.length) toast("No embeddable videos matched. Try a different phrase.", "default", "No results");
    } catch (error) {
      console.error("[MusicRoom] Search error:", error);
      searchState = { results: [], query: term, loading: false, mode: "local" };
      renderSearchResults();
      setSearchModeLabel("Local catalog");
      openDirectLinkField();
      if (error && error.quota) {
        showSearchNotice("YouTube search quota is exhausted. Paste a direct YouTube link below — shared playback still works perfectly.");
      } else {
        showSearchNotice("YouTube search is unavailable right now. Paste a direct YouTube link below to keep the music going.");
      }
    } finally {
      setSearchLoading(false);
    }
  }

  function setSearchModeLabel(mode) {
    const label = $("#searchModeLabel");
    const helper = $("#searchHelperText");
    if (label) label.textContent = mode;
    if (helper) {
      if (youtubeKeyConfigured) {
        helper.innerHTML = "Search the full YouTube catalog. Embeddable videos only — direct links work as a backup.";
      } else {
        helper.innerHTML = "Starter catalog active. Add a YouTube API key in <strong>room.js</strong> for the full catalog.";
      }
    }
  }

  function setSearchLoading(loading) {
    searchState.loading = loading;
    const button = $("#searchButton");
    if (button) {
      button.disabled = loading;
      if (loading) {
        button.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Searching</span>';
      } else {
        button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><span>Search</span>';
      }
    }
    if (loading) {
      const results = $("#searchResults");
      if (results) {
        results.classList.remove("has-results");
        results.innerHTML = `
          <div class="search-loading"><span class="spinner" aria-hidden="true"></span> Looking for the good stuff…</div>
          <div class="skeleton-row"><span class="skeleton" style="width:64px;aspect-ratio:16/9;"></span><span style="flex:1"><span class="skeleton" style="display:block;height:8px;width:75%;"></span><span class="skeleton" style="display:block;height:6px;width:42%;margin-top:5px;"></span></span></div>
          <div class="skeleton-row"><span class="skeleton" style="width:64px;aspect-ratio:16/9;"></span><span style="flex:1"><span class="skeleton" style="display:block;height:8px;width:62%;"></span><span class="skeleton" style="display:block;height:6px;width:36%;margin-top:5px;"></span></span></div>`;
      }
    }
  }

  function renderSearchResults() {
    const container = $("#searchResults");
    const count = $("#searchCount");
    if (!container) return;
    const results = searchState.results;
    if (count) count.textContent = String(results.length);
    container.classList.toggle("has-results", results.length > 0);

    if (!results.length) {
      container.innerHTML = `
        <div class="result-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <p>No songs to show yet</p>
          <span>Search the catalog, or paste any YouTube link using the field above.</span>
        </div>`;
      return;
    }

    container.innerHTML = results.map((result, index) => `
      <div class="search-result">
        <div class="result-thumb">
          <img src="${escapeHtml(result.thumbnail || `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`)}" alt="" loading="lazy" />
          <button class="play-hover" type="button" data-search-action="play" data-result-index="${index}" aria-label="Play ${escapeHtml(result.title)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <span class="result-duration">${result.durationSeconds ? escapeHtml(formatTime(result.durationSeconds)) : "LINK"}</span>
        </div>
        <div class="result-info">
          <span class="result-title" title="${escapeHtml(result.title)}">${escapeHtml(result.title)}</span>
          <span class="result-channel">${escapeHtml(result.channel || "YouTube")}</span>
        </div>
        <div class="result-actions">
          <button class="result-add" type="button" data-search-action="queue" data-result-index="${index}" aria-label="Add ${escapeHtml(result.title)} to queue">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Queue
          </button>
          <button class="result-play" type="button" data-search-action="play" data-result-index="${index}" aria-label="Play ${escapeHtml(result.title)} now">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
      </div>`).join("");
  }

  function showSearchNotice(text) {
    const notice = $("#searchNotice");
    const content = $("#searchNoticeText");
    if (!notice || !content) return;
    content.textContent = text;
    notice.classList.add("show");
    notice.style.display = "flex";
  }

  function hideSearchNotice() {
    const notice = $("#searchNotice");
    if (notice) {
      notice.classList.remove("show");
      notice.style.display = "";
    }
  }

  function openDirectLinkField() {
    const details = $("#linkDetails");
    if (details) details.open = true;
    $("#linkInput")?.focus({ preventScroll: false });
  }

  /* ------------------------------------------------------------
     Sharing / modal / tabs
     ------------------------------------------------------------ */

  function shareUrl() {
    try {
      const base = new URL("index.html", window.location.href);
      base.search = "";
      base.hash = "";
      base.searchParams.set("join", code);
      return base.toString();
    } catch (error) {
      return `index.html?join=${encodeURIComponent(code)}`;
    }
  }

  function updateShareFields() {
    const linkField = $("#roomLinkField");
    const codeField = $("#roomCodeField");
    if (linkField) linkField.value = shareUrl();
    if (codeField) codeField.value = code;
  }

  async function copyText(value, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      toast(successMessage, "success", "Copied");
    } catch (error) {
      toast("Your browser blocked clipboard access. Select the text and copy it manually.", "error", "Couldn't copy");
    }
  }

  function openShareModal() {
    shareModalElement = $("#shareModal");
    if (!shareModalElement) return;
    lastFocusedElement = document.activeElement;
    updateShareFields();
    shareModalElement.classList.add("open");
    shareModalElement.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => $("#copyCodeButton")?.focus(), 100);
  }

  function closeShareModal() {
    if (!shareModalElement) return;
    shareModalElement.classList.remove("open");
    shareModalElement.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
  }

  function openTab(tabName) {
    if (!["queue", "chat", "people"].includes(tabName)) return;
    activeTab = tabName;
    $$(".tab-btn").forEach((button) => {
      const isActive = button.dataset.tab === tabName;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    $$(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `panel${tabName.charAt(0).toUpperCase()}${tabName.slice(1)}`);
    });
    if (tabName === "chat") {
      const dot = $("#chatTabDot");
      if (dot) dot.hidden = true;
      const list = $("#chatList");
      if (list) window.requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
      $("#chatInput")?.focus({ preventScroll: true });
    }
  }

  function shareToWhatsApp() {
    const message = `Join me in MusicRoom — room ${code}. We're listening together: ${shareUrl()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  function shareToTelegram() {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl())}&text=${encodeURIComponent(`Join me in MusicRoom — room ${code}`)}`, "_blank", "noopener");
  }

  /* ------------------------------------------------------------
     Presence / timing loops
     ------------------------------------------------------------ */

  function broadcastPlaybackTime() {
    if (!room || !room.currentSong || !room.isPlaying || hostBroadcastInFlight) return;
    if (!isBroadcaster()) return;
    hostBroadcastInFlight = true;
    const time = ownPlayerTime();
    const patch = {
      currentTime: Math.max(0, time),
      currentTimeAt: serverNow()
    };
    if (cloudEnabled && database) {
      database.ref(`rooms/${code}`).update(patch).catch(() => {}).finally(() => {
        hostBroadcastInFlight = false;
      });
    } else {
      room.currentTime = patch.currentTime;
      room.currentTimeAt = patch.currentTimeAt;
      localCommit(false);
      hostBroadcastInFlight = false;
    }
    updateSyncBadge();
  }

  function driftCheck() {
    if (!room || !room.currentSong || !room.isPlaying || !playerReady || !player) return;
    if (isBroadcaster()) return;
    let state = null;
    let local = 0;
    try {
      state = player.getPlayerState();
      local = toNumber(player.getCurrentTime());
    } catch (error) {
      return;
    }
    const expected = expectedPlaybackTime();
    if (state === window.YT.PlayerState.PLAYING && Math.abs(local - expected) > SYNC_THRESHOLD_SECONDS) {
      try {
        player.seekTo(Math.max(0, expected), true);
        const syncText = $("#syncPillText");
        if (syncText) syncText.textContent = "Re-synced";
        window.setTimeout(updateSyncBadge, 1600);
      } catch (error) {
        /* The player might be between states. */
      }
    } else if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
      try { player.playVideo(); } catch (error) { /* User may need to tap. */ }
      scheduleAudioCheck();
    }
    updateSyncBadge();
  }

  function updateChatFormState() {
    const input = $("#chatInput");
    const button = $("#chatSendBtn");
    if (!input || !button) return;
    const hasText = input.value.trim().length > 0;
    button.disabled = !hasText;
    button.style.opacity = hasText ? "1" : "0.55";
  }

  /* ------------------------------------------------------------
     Event binding
     ------------------------------------------------------------ */

  function bindEvents() {
    $("#shareButton")?.addEventListener("click", openShareModal);
    $("#inviteMiniBtn")?.addEventListener("click", openShareModal);
    $("#copyCodeButton")?.addEventListener("click", () => copyText(code, "Room code copied — go make some noise."));
    $("#copyLinkButton")?.addEventListener("click", () => copyText(shareUrl(), "Invite link copied. Send it to your people."));
    $("#navCopyButton")?.addEventListener("click", () => copyText(code, "Room code copied to your clipboard."));
    $("#shareModalClose")?.addEventListener("click", closeShareModal);
    $("#shareModal")?.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) closeShareModal();
    });
    $("#shareWhatsApp")?.addEventListener("click", shareToWhatsApp);
    $("#shareTelegram")?.addEventListener("click", shareToTelegram);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && shareModalElement && shareModalElement.classList.contains("open")) closeShareModal();
    });

    $$(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => openTab(button.dataset.tab));
    });

    $("#playBtn")?.addEventListener("click", togglePlayback);
    $("#prevBtn")?.addEventListener("click", () => playRelative(-1));
    $("#nextBtn")?.addEventListener("click", () => playRelative(1));
    $("#syncNowBtn")?.addEventListener("click", syncNow);
    $("#audioUnlock")?.addEventListener("click", unlockAudio);
    $("#emptySearchBtn")?.addEventListener("click", () => {
      const input = $("#searchInput");
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus({ preventScroll: true });
      }
    });

    $("#repeatBtn")?.addEventListener("click", () => {
      repeatEnabled = !Boolean(room && room.repeat);
      updateRoot({ repeat: repeatEnabled });
      syncControls();
      toast(repeatEnabled ? "This track will loop when it ends." : "Repeat is off. The queue is back in charge.", "default", repeatEnabled ? "Repeat on" : "Repeat off");
    });

    $("#seekSlider")?.addEventListener("pointerdown", () => { seeking = true; });
    $("#seekSlider")?.addEventListener("input", (event) => {
      seeking = true;
      const value = toNumber(event.target.value);
      const currentLabel = $("#currentTime");
      if (currentLabel) currentLabel.textContent = formatTime(value);
      const duration = toNumber(event.target.max) || 1;
      event.target.style.setProperty("--fill", `${clamp((value / duration) * 100, 0, 100)}%`);
    });
    $("#seekSlider")?.addEventListener("change", (event) => {
      const target = toNumber(event.target.value);
      seeking = false;
      seekTo(target);
    });
    $("#seekSlider")?.addEventListener("pointerup", () => {
      window.setTimeout(() => { seeking = false; updateTimeline(true); }, 60);
    });

    const volumeSlider = $("#volumeSlider");
    if (volumeSlider) {
      volumeSlider.value = String(volume);
      volumeSlider.style.setProperty("--fill", `${volume}%`);
      volumeSlider.addEventListener("input", (event) => {
        volume = clamp(toNumber(event.target.value), 0, 100);
        muted = volume === 0;
        event.target.style.setProperty("--fill", `${volume}%`);
        saveVolume();
        if (playerReady && player) {
          try {
            player.setVolume(volume);
            if (muted) player.mute();
            else player.unMute();
          } catch (error) { /* no-op */ }
        }
      });
    }

    $("#muteBtn")?.addEventListener("click", () => {
      muted = !muted;
      if (playerReady && player) {
        try {
          if (muted) player.mute();
          else {
            player.unMute();
            if (volume === 0) volume = 60;
            player.setVolume(volume);
          }
        } catch (error) { /* no-op */ }
      }
      const slider = $("#volumeSlider");
      if (slider) slider.style.setProperty("--fill", `${muted ? 0 : volume}%`);
      const button = $("#muteBtn");
      if (button) button.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      toast(muted ? "Room audio muted." : "Room audio unmuted.", "default");
    });

    $("#queueList")?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-queue-action]");
      if (!actionButton) return;
      const songId = actionButton.getAttribute("data-song-id");
      const action = actionButton.getAttribute("data-queue-action");
      const song = room && room.queue[songId];
      if (action === "play" && song) startSong(song);
      if (action === "vote") toggleVote(songId);
      if (action === "remove") removeQueueSong(songId);
    });

    $("#searchForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = $("#searchInput") ? $("#searchInput").value.trim() : "";
      const directVideoId = extractVideoId(query);
      hideSearchNotice();
      searchSongs(query, directVideoId);
    });

    $("#searchResults")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-search-action]");
      if (!button) return;
      const index = Number(button.getAttribute("data-result-index"));
      const result = searchState.results[index];
      if (!result) return;
      const action = button.getAttribute("data-search-action");
      addToQueue(result, action === "play");
    });

    $("#linkForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#linkInput");
      const videoId = extractVideoId(input ? input.value : "");
      if (!videoId) {
        toast("That doesn't look like a YouTube link. Try a watch, share, shorts, or live URL.", "error", "Link not recognised");
        input?.focus();
        return;
      }
      const button = $("#linkAddBtn");
      if (button) {
        button.disabled = true;
        button.textContent = "Loading…";
      }
      hideSearchNotice();
      try {
        const metadata = await resolveDirectLink(videoId);
        addToQueue(metadata, false);
        if (input) input.value = "";
        const details = $("#linkDetails");
        if (details) details.open = false;
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Add";
        }
      }
    });

    $("#chatForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#chatInput");
      const value = input ? input.value : "";
      if (!value.trim()) return;
      sendChat(value);
      if (input) {
        input.value = "";
        input.style.height = "";
        input.focus();
      }
      updateChatFormState();
    });

    $("#chatInput")?.addEventListener("input", (event) => {
      const input = event.target;
      input.style.height = "auto";
      input.style.height = `${Math.min(84, input.scrollHeight)}px`;
      updateChatFormState();
    });
    $("#chatInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("#chatForm")?.requestSubmit();
      }
    });
    $("#chatNew")?.addEventListener("click", () => {
      const list = $("#chatList");
      if (list) list.scrollTop = list.scrollHeight;
      $("#chatNew")?.classList.remove("show");
    });

    $("#leaveButton")?.addEventListener("click", () => {
      markOffline();
      window.setTimeout(() => {
        window.location.assign(new URL("index.html", window.location.href).toString());
      }, 80);
    });

    window.addEventListener("pagehide", markOffline);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) markOnlineAgain();
    });

    window.setInterval(() => {
      updateTimeline();
      updateSyncBadge();
    }, 250);

    window.setInterval(() => {
      if (!room) return;
      if (isBroadcaster() && room.currentSong && room.isPlaying) broadcastPlaybackTime();
    }, BROADCAST_INTERVAL_MS);

    window.setInterval(driftCheck, 1000);

    window.setInterval(() => {
      if (!room) return;
      const online = onlineUsers();
      const total = Object.keys(room.users).length;
      if (online.length < total) renderPeople();
      const now = Date.now();
      const staleHost = room.users[room.hostId] && room.users[room.hostId].online === false;
      if (staleHost && room.hostId !== session.userId && isBroadcaster()) updateSyncBadge();
      if (now % 5 === 0) updateShareFields();
    }, 15000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && room) {
        applyPlaybackSync(true);
        updateTimeline(true);
      }
    });
  }

  /* ------------------------------------------------------------
     Boot
     ------------------------------------------------------------ */

  function resolveIdentity() {
    if (window.MusicRoomFirebase && window.MusicRoomFirebase.isConfigured()) {
      database = window.MusicRoomFirebase.init();
      cloudEnabled = Boolean(database);
      if (database) {
        database.ref(".info/serverTimeOffset").on("value", (snapshot) => {
          serverTimeOffset = toNumber(snapshot.val());
        });
      }
    }

    code = sanitizeCode(params.get("code") || params.get("room") || (session && session.roomCode) || "");
    if (!code) {
      showRoomError("No room code yet.", "Open MusicRoom from the home page, create a room, or use an invite link with a room code.");
      return false;
    }

    if (!session || !session.userId || session.roomCode !== code) {
      const name = cleanName(params.get("name")) || "Guest";
      session = {
        userId: createId("guest"),
        userName: name,
        userInitials: initialsFor(name),
        userColor: colorForId(createId("color")),
        roomCode: code,
        at: Date.now()
      };
    }

    session.userName = cleanName(session.userName) || "Guest";
    session.userInitials = session.userInitials || initialsFor(session.userName);
    session.userColor = session.userColor || colorForId(session.userId);
    writeSession(session);

    if (window.MusicRoomFirebase && window.MusicRoomFirebase.isConfigured() && !cloudEnabled) {
      toast("Firebase is configured but unavailable. This room is running locally.", "error", "Cloud connection failed");
    }
    return true;
  }

  function init() {
    if (!resolveIdentity()) return;
    bindEvents();
    setSearchModeLabel("Local catalog");
    youtubeKeyConfigured = /^AIza[0-9A-Za-z_-]{20,}$/.test(YOUTUBE_API_KEY) && !YOUTUBE_API_KEY.includes("YOUR_");
    searchState = { results: STARTER_CATALOG.slice(0, 7), query: "", loading: false, mode: "local" };
    renderSearchResults();
    if (youtubeKeyConfigured) setSearchModeLabel("YouTube API");
    updateChatFormState();
    subscribeToRoom();
    loadYouTubeApi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
