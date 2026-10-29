/* ============================================================
   MusicRoom · Landing & room provisioning logic
   ============================================================ */

(function () {
  "use strict";

  const SESSION_KEY = "musicroom.session.v1";
  const ROOM_PREFIX = "musicroom.room.";
  const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const DEMO_CODE = "DEMO01";
  const AVATAR_COLORS = ["green", "amber", "blue", "pink", "red", ""];

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  let database = null;
  let cloudEnabled = false;

  /* ------------------------------------------------------------
     Session helpers
     ------------------------------------------------------------ */

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.warn("[MusicRoom] Session storage is unavailable.", error);
    }
  }

  function createUserId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID().replace(/-/g, "").slice(0, 14);
    }
    return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function randomRoomCode() {
    const bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
  }

  function colorForId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function initialsFor(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function sanitizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
  }

  function roomStorageKey(code) {
    return `${ROOM_PREFIX}${code}`;
  }

  function getLocalRoom(code) {
    try {
      const raw = localStorage.getItem(roomStorageKey(code));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.code ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function saveLocalRoom(room) {
    localStorage.setItem(roomStorageKey(room.code), JSON.stringify(room));
  }

  /* ------------------------------------------------------------
     Toast notifications
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

    const remove = () => {
      item.classList.add("out");
      window.setTimeout(() => item.remove(), 240);
    };

    window.setTimeout(remove, type === "error" ? 6200 : 4200);
    item.addEventListener("click", remove);
  }

  /* ------------------------------------------------------------
     Form validation
     ------------------------------------------------------------ */

  function setFieldError(input, errorNode, message) {
    if (!errorNode) return;
    errorNode.textContent = message || "";
    errorNode.classList.toggle("show", Boolean(message));
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function validateName(input, errorNode) {
    const name = cleanName(input ? input.value : "");
    if (!name) {
      setFieldError(input, errorNode, "Tell the room what to call you.");
      return null;
    }
    if (name.length < 2) {
      setFieldError(input, errorNode, "Use at least 2 characters.");
      return null;
    }
    if (!/[a-zA-Z0-9\u00C0-\u024F]/.test(name)) {
      setFieldError(input, errorNode, "Please include a letter or number.");
      return null;
    }
    setFieldError(input, errorNode, "");
    return name;
  }

  function setLoading(button, loading, loadingText, idleMarkup) {
    if (!button) return;
    if (loading) {
      button.disabled = true;
      button.dataset.idleMarkup = button.innerHTML;
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
    } else {
      button.disabled = false;
      button.innerHTML = idleMarkup || button.dataset.idleMarkup || "Continue";
    }
  }

  /* ------------------------------------------------------------
     Room existence / provisioning
     ------------------------------------------------------------ */

  async function roomExists(code) {
    if (cloudEnabled && database) {
      const snapshot = await database.ref(`rooms/${code}`).once("value");
      return snapshot.exists();
    }
    return Boolean(getLocalRoom(code));
  }

  async function getRoom(code) {
    if (cloudEnabled && database) {
      const snapshot = await database.ref(`rooms/${code}`).once("value");
      return snapshot.exists() ? snapshot.val() : null;
    }
    return getLocalRoom(code);
  }

  function buildUser(name, userId, isHost) {
    return {
      id: userId,
      name,
      initials: initialsFor(name),
      color: colorForId(userId),
      host: Boolean(isHost),
      online: true,
      joinedAt: Date.now()
    };
  }

  function buildRoom(code, name, hostUser) {
    return {
      version: 1,
      code,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hostId: hostUser.id,
      hostName: hostUser.name,
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      currentTimeAt: Date.now(),
      queue: {},
      messages: {
        welcome: {
          id: "welcome",
          type: "system",
          text: `Room created. Invite your people with code ${code}, then queue the first song.`,
          at: Date.now()
        }
      },
      users: {
        [hostUser.id]: hostUser
      }
    };
  }

  async function persistRoom(room) {
    if (cloudEnabled && database) {
      await database.ref(`rooms/${room.code}`).set(room);
    } else {
      saveLocalRoom(room);
    }
  }

  async function goToRoom(code, session) {
    writeSession(session);
    const target = new URL("room.html", window.location.href);
    target.searchParams.set("code", code);
    window.location.assign(target.toString());
  }

  function createSession(user, code) {
    return {
      userId: user.id,
      userName: user.name,
      userInitials: user.initials,
      userColor: user.color,
      roomCode: code,
      at: Date.now()
    };
  }

  /* ------------------------------------------------------------
     Create room
     ------------------------------------------------------------ */

  async function handleCreate(event) {
    event.preventDefault();
    const nameInput = $("#createName");
    const roomNameInput = $("#createRoomName");
    const nameError = $("#createNameError");
    const roomNameError = $("#createRoomNameError");
    const button = $("#createButton");

    const name = validateName(nameInput, nameError);
    if (!name) {
      nameInput?.focus();
      return;
    }

    const rawRoomName = roomNameInput ? roomNameInput.value.replace(/\s+/g, " ").trim() : "";
    if (rawRoomName.length > 40) {
      setFieldError(roomNameInput, roomNameError, "Keep the room name under 40 characters.");
      roomNameInput?.focus();
      return;
    }
    setFieldError(roomNameInput, roomNameError, "");

    const roomName = rawRoomName || `${name.split(" ")[0]}'s room`;
    const userId = createUserId();
    const user = buildUser(name, userId, true);

    setLoading(button, true, "Setting the stage…");
    try {
      let code = randomRoomCode();
      let attempts = 0;
      while (await roomExists(code)) {
        code = randomRoomCode();
        attempts += 1;
        if (attempts > 8) throw new Error("Could not reserve a room code. Please try again.");
      }

      const room = buildRoom(code, roomName, user);
      await persistRoom(room);

      toast(`Room ${code} is ready. You're the host.`, "success", "The stage is yours");
      await goToRoom(code, createSession(user, code));
    } catch (error) {
      console.error("[MusicRoom] Room creation failed:", error);
      const message = error && error.message ? error.message : "Room creation failed. Please try again.";
      toast(
        cloudEnabled
          ? `${message} Check your Firebase rules and connection.`
          : message,
        "error",
        "Couldn't create that room"
      );
    } finally {
      setLoading(button, false, "", '<span>Create my room</span><span class="lp-form-submit-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg></span>');
    }
  }

  /* ------------------------------------------------------------
     Join room
     ------------------------------------------------------------ */

  async function handleJoin(event) {
    event.preventDefault();
    const nameInput = $("#joinName");
    const codeInput = $("#joinCode");
    const nameError = $("#joinNameError");
    const codeError = $("#joinCodeError");
    const button = $("#joinButton");

    const name = validateName(nameInput, nameError);
    const code = sanitizeCode(codeInput ? codeInput.value : "");

    if (code.length !== 6) {
      setFieldError(codeInput, codeError, "Enter the full 6-character room code.");
    } else {
      setFieldError(codeInput, codeError, "");
    }

    if (!name) {
      nameInput?.focus();
      return;
    }
    if (code.length !== 6) {
      codeInput?.focus();
      return;
    }

    setLoading(button, true, "Finding the room…");
    try {
      const existing = await getRoom(code);
      if (!existing) {
        setFieldError(codeInput, codeError, "We couldn't find that room. Double-check the code?");
        toast("That room doesn't exist yet. Check the code or create a new one.", "error", "Room not found");
        codeInput?.focus();
        codeInput?.select();
        return;
      }

      const priorSession = readSession();
      const returningUserId = priorSession && priorSession.roomCode === code ? priorSession.userId : "";
      const knownUser = returningUserId && existing.users ? existing.users[returningUserId] : null;
      const userId = knownUser ? returningUserId : createUserId();
      const existingHostId = existing.hostId || "";
      const isHost = existingHostId === userId;
      const user = buildUser(name, userId, isHost);

      existing.users = existing.users && typeof existing.users === "object" ? existing.users : {};
      existing.users[userId] = user;
      existing.updatedAt = Date.now();
      existing.messages = existing.messages && typeof existing.messages === "object" ? existing.messages : {};
      const joinKey = `joined_${userId}`;
      existing.messages[joinKey] = {
        id: joinKey,
        type: "system",
        text: `${user.name} joined the room.`,
        at: Date.now()
      };

      if (cloudEnabled && database) {
        await database.ref(`rooms/${code}/users/${userId}`).set(user);
        await database.ref(`rooms/${code}/messages/${joinKey}`).set(existing.messages[joinKey]);
        await database.ref(`rooms/${code}`).update({ updatedAt: Date.now() });
      } else {
        saveLocalRoom(existing);
      }

      toast(`Welcome to ${existing.name || "the room"}, ${user.name}.`, "success", "You're in");
      await goToRoom(code, createSession(user, code));
    } catch (error) {
      console.error("[MusicRoom] Join failed:", error);
      const message = error && error.message ? error.message : "Could not join this room. Please try again.";
      toast(message, "error", "Join failed");
    } finally {
      setLoading(button, false, "", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg><span>Enter the room</span>');
    }
  }

  /* ------------------------------------------------------------
     Demo room
     ------------------------------------------------------------ */

  const DEMO_TRACKS = {
    t1: {
      id: "demo-tame",
      videoId: "sBzrzS1Ag_g",
      title: "The Less I Know The Better",
      channel: "Tame Impala",
      thumbnail: "https://i.ytimg.com/vi/sBzrzS1Ag_g/hqdefault.jpg",
      durationSeconds: 216,
      addedBy: "maya",
      addedByName: "Maya",
      addedAt: Date.now() - 1000 * 60 * 34,
      votes: { maya: true, leo: true, zoe: true, alex: true }
    },
    t2: {
      id: "demo-frank",
      videoId: "uzS3WG6__G4",
      title: "Seigfried",
      channel: "Frank Ocean",
      thumbnail: "https://i.ytimg.com/vi/uzS3WG6__G4/hqdefault.jpg",
      durationSeconds: 334,
      addedBy: "zoe",
      addedByName: "Zoe",
      addedAt: Date.now() - 1000 * 60 * 21,
      votes: { zoe: true, leo: true, alex: true }
    },
    t3: {
      id: "demo-radiohead",
      videoId: "fHiGbolFFGw",
      title: "Weird Fishes / Arpeggi",
      channel: "Radiohead",
      thumbnail: "https://i.ytimg.com/vi/fHiGbolFFGw/hqdefault.jpg",
      durationSeconds: 318,
      addedBy: "leo",
      addedByName: "Leo",
      addedAt: Date.now() - 1000 * 60 * 12,
      votes: { leo: true, maya: true }
    },
    t4: {
      id: "demo-m83",
      videoId: "dX3k_QDnzHE",
      title: "Midnight City",
      channel: "M83",
      thumbnail: "https://i.ytimg.com/vi/dX3k_QDnzHE/hqdefault.jpg",
      durationSeconds: 243,
      addedBy: "maya",
      addedByName: "Maya",
      addedAt: Date.now() - 1000 * 60 * 7,
      votes: { maya: true }
    }
  };

  function buildDemoRoom(user) {
    const now = Date.now();
    const queue = JSON.parse(JSON.stringify(DEMO_TRACKS));
    const people = [
      { id: "maya", name: "Maya", color: "green", host: false, online: true, initials: "MA" },
      { id: "leo", name: "Leo", color: "blue", host: false, online: true, initials: "LE" },
      { id: "zoe", name: "Zoe", color: "pink", host: false, online: false, initials: "ZO" }
    ];

    const users = {
      [user.id]: { ...user, host: true, online: true, joinedAt: now }
    };
    people.forEach((person) => {
      users[person.id] = { ...person, joinedAt: now - 1000 * 60 * 48 };
    });

    return {
      version: 1,
      code: DEMO_CODE,
      name: "After Hours",
      createdAt: now - 1000 * 60 * 52,
      updatedAt: now,
      hostId: user.id,
      hostName: user.name,
      currentSong: {
        ...DEMO_TRACKS.t1,
        addedBy: "maya",
        addedByName: "Maya",
        addedAt: now - 1000 * 60 * 34
      },
      isPlaying: false,
      currentTime: 68,
      currentTimeAt: now,
      queue,
      messages: {
        m1: { id: "m1", type: "system", text: "Maya opened the room. The aux cord is safe with us.", at: now - 1000 * 60 * 51 },
        m2: { id: "m2", uid: "maya", name: "Maya", color: "green", initials: "MA", text: "okay but this bassline is illegal", at: now - 1000 * 60 * 9 },
        m3: { id: "m3", uid: "leo", name: "Leo", color: "blue", initials: "LE", text: "adding something for later — no skipping allowed", at: now - 1000 * 60 * 7 },
        m4: { id: "m4", type: "system", text: "Zoe stepped away for a snack.", at: now - 1000 * 60 * 4 },
        m5: { id: "m5", uid: "zoe", name: "Zoe", color: "pink", initials: "ZO", text: "i'm back. did we get to Midnight City yet??", at: now - 1000 * 60 * 2 }
      },
      users
    };
  }

  async function openDemoRoom() {
    const demoButton = $("#demoButton");
    const originalMarkup = demoButton ? demoButton.innerHTML : "";
    if (demoButton) {
      demoButton.disabled = true;
      demoButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Opening the demo…';
    }

    try {
      const userId = createUserId();
      const user = buildUser("You", userId, true);
      let room = getLocalRoom(DEMO_CODE);

      if (!room) {
        room = buildDemoRoom(user);
      } else {
        room.users = room.users && typeof room.users === "object" ? room.users : {};
        const isReturningHost = room.hostId === userId;
        room.users[userId] = {
          ...buildUser("You", userId, isReturningHost),
          host: Boolean(isReturningHost)
        };

        // The demo room is only useful if its active visitor can drive the
        // shared timeline. If the original host has gone, hand them the keys.
        const previousHost = room.users[room.hostId];
        if (!previousHost || previousHost.online === false || room.hostId === userId) {
          Object.values(room.users).forEach((participant) => {
            if (participant && typeof participant === "object") participant.host = false;
          });
          room.hostId = userId;
          room.hostName = room.users[userId].name;
          room.users[userId].host = true;
        }

        room.updatedAt = Date.now();
        room.messages = room.messages && typeof room.messages === "object" ? room.messages : {};
        room.messages[`joined_${userId}`] = {
          id: `joined_${userId}`,
          type: "system",
          text: "You joined the demo room.",
          at: Date.now()
        };
      }

      saveLocalRoom(room);
      toast("This room is fully interactive. Add a song or say hi.", "success", "Welcome to After Hours");
      await goToRoom(DEMO_CODE, createSession({ ...user, host: room.hostId === userId }, DEMO_CODE));
    } catch (error) {
      console.error("[MusicRoom] Could not open demo:", error);
      toast("Your browser blocked local storage. Disable private mode and try again.", "error", "Demo unavailable");
    } finally {
      if (demoButton) {
        demoButton.disabled = false;
        demoButton.innerHTML = originalMarkup;
      }
    }
  }

  /* ------------------------------------------------------------
     Form buttons / page interactions
     ------------------------------------------------------------ */

  function focusDestination(selector) {
    const target = $(selector);
    if (!target) return;
    const start = $("#start");
    if (start) start.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => target.focus({ preventScroll: true }), 380);
  }

  function bindLandingInteractions() {
    const nav = $("#siteNav");
    const menuToggle = $("#menuToggle");
    const mobileMenu = $("#mobileMenu");

    const updateNav = () => {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 10);
    };
    updateNav();
    window.addEventListener("scroll", updateNav, { passive: true });

    if (menuToggle && mobileMenu) {
      menuToggle.addEventListener("click", () => {
        const isOpen = mobileMenu.classList.toggle("open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
        menuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
      });

      $$(".mobile-menu a", document).forEach((link) => {
        link.addEventListener("click", () => {
          mobileMenu.classList.remove("open");
          menuToggle.setAttribute("aria-expanded", "false");
        });
      });
    }

    $$("[data-focus-join]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        focusDestination("#joinName");
      });
    });

    $$("[data-focus-create]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        focusDestination("#createName");
      });
    });

    $$("[data-share-network]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const network = link.getAttribute("data-share-network");
        const roomCode = sanitizeCode(new URLSearchParams(window.location.search).get("join") || "");
        const shareUrl = roomCode
          ? `${window.location.origin}${window.location.pathname}?join=${roomCode}`
          : window.location.href.split("#")[0];
        const message = roomCode
          ? `Join me in MusicRoom — room ${roomCode}. We're listening together.`
          : "MusicRoom — listen together, wherever you are.";
        if (network === "whatsapp") {
          window.open(`https://wa.me/?text=${encodeURIComponent(`${message} ${shareUrl}`)}`, "_blank", "noopener");
        } else if (network === "telegram") {
          window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(message)}`, "_blank", "noopener");
        }
      });
    });

    const codeInput = $("#joinCode");
    if (codeInput) {
      codeInput.addEventListener("input", () => {
        const caretAtEnd = codeInput.selectionEnd === codeInput.value.length;
        const cleaned = sanitizeCode(codeInput.value);
        codeInput.value = cleaned;
        if (caretAtEnd) codeInput.setSelectionRange(cleaned.length, cleaned.length);
        if (cleaned.length === 6) setFieldError(codeInput, $("#joinCodeError"), "");
      });
    }

    const createName = $("#createName");
    if (createName) {
      createName.addEventListener("input", () => {
        if (createName.value.trim()) setFieldError(createName, $("#createNameError"), "");
      });
    }

    const joinName = $("#joinName");
    if (joinName) {
      joinName.addEventListener("input", () => {
        if (joinName.value.trim()) setFieldError(joinName, $("#joinNameError"), "");
      });
    }

    $("#createForm")?.addEventListener("submit", handleCreate);
    $("#joinForm")?.addEventListener("submit", handleJoin);
    $("#demoButton")?.addEventListener("click", openDemoRoom);
    $("#heroDemoPlay")?.addEventListener("click", openDemoRoom);
    $("#footerDemo")?.addEventListener("click", (event) => {
      event.preventDefault();
      openDemoRoom();
    });
    $("#footerDemoTwo")?.addEventListener("click", (event) => {
      event.preventDefault();
      openDemoRoom();
    });

    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();
  }

  function hydrateInviteLink() {
    const params = new URLSearchParams(window.location.search);
    const invitedCode = sanitizeCode(params.get("join") || params.get("code") || "");
    if (!invitedCode || invitedCode.length < 4) return;

    const codeInput = $("#joinCode");
    if (codeInput) codeInput.value = invitedCode;

    const banner = $("#inviteBanner");
    const bannerCode = $("#inviteCodeText");
    if (banner && bannerCode) {
      bannerCode.textContent = invitedCode;
      banner.classList.remove("hidden");
    }

    const fill = $("#inviteFill");
    if (fill) {
      fill.addEventListener("click", () => focusDestination("#joinName"));
    }

    const joinArticle = $("#joinForm")?.closest("article");
    if (joinArticle) {
      joinArticle.style.border = "1px solid rgba(216, 255, 95, 0.42)";
      joinArticle.style.boxShadow = "0 0 0 1px rgba(216, 255, 95, 0.1), 0 24px 56px rgba(216, 255, 95, 0.08)";
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    url.searchParams.delete("code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function init() {
    if (window.MusicRoomFirebase && window.MusicRoomFirebase.isConfigured()) {
      database = window.MusicRoomFirebase.init();
      cloudEnabled = Boolean(database);
      if (!cloudEnabled) {
        console.warn("[MusicRoom] Firebase is configured but unavailable; using local demo mode.");
      }
    }

    bindLandingInteractions();
    hydrateInviteLink();

    const existingSession = readSession();
    if (existingSession && existingSession.roomCode && getLocalRoom(existingSession.roomCode) && !cloudEnabled) {
      // A prior session is left untouched; the user is free to create or join another room.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
