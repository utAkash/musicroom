# MusicRoom

A real-time, collaborative listening room for YouTube. Create a room, share a six-character code, and everyone hears the same song at the same moment. The queue is democratic, the chat is live, and there are no accounts, ads, or build tools.

**Stack:** plain HTML5, CSS3, ES6, Firebase Realtime Database (v10 compat CDN), YouTube IFrame Player API, YouTube Data API v3, GitHub, and Vercel. **Hosting cost:** $0 on the free tiers.

---

## Contents

1. [What you get](#what-you-get)
2. [Design direction](#design-direction)
3. [How the app behaves out of the box](#how-the-app-behaves-out-of-the-box)
4. [Project structure](#project-structure)
5. [Step 1 — Create a free Firebase Realtime Database](#step-1--create-a-free-firebase-realtime-database)
6. [Step 2 — Get a free YouTube Data API v3 key](#step-2--get-a-free-youtube-data-api-v3-key)
7. [Step 3 — Deploy to Vercel from GitHub](#step-3--deploy-to-vercel-from-github)
8. [Run it locally](#run-it-locally)
9. [How synchronization works](#how-synchronization-works)
10. [Data model](#data-model)
11. [Troubleshooting](#troubleshooting)
12. [Security and cost notes](#security-and-cost-notes)

---

## What you get

| Area | Behaviour |
| --- | --- |
| Landing page | Editorial ink-and-cream identity, electric-lime accents, live-session console preview, create/join forms, feature bento, story photography, FAQ, invite-link detection and a full demo-room entry point |
| Rooms | Unique six-character codes using a collision-resistant alphabet, optional room name, host role, invite link parsing, share modal |
| Search | YouTube Data API v3 search with embeddable filtering, thumbnail metadata, duration lookup, loading/error states |
| Search fallback | The starter catalog works without any API key. Any YouTube watch, share, shorts, live, embed, or bare video ID can be pasted directly. Quota errors automatically surface the direct-link field. |
| Player | YouTube IFrame Player API, custom play/pause/previous/next/sync controls, timeline, volume, mute, loop, audio-unlock overlay for browser autoplay rules |
| Sync | Active broadcaster writes the current time to Firebase every three seconds; listeners compare against their local player and soft-seek when drift exceeds three seconds |
| Queue | Shared and vote-ranked. Anyone can queue, vote, play, or remove a track. The active broadcaster auto-advances when a track ends |
| Chat | Live messages, system notices, colour-coded avatars, timestamps, Enter-to-send, Shift+Enter for a new line, bounded auto-scroll |
| Presence | Online/offline status using `onDisconnect()`, host vs listener roles, live listener counts |
| Sharing | Copy room code, copy invite link, WhatsApp and Telegram share actions |
| Accessibility | Labelled controls, visible focus states, keyboard-friendly tabs and modal, `aria-live` notifications, reduced-motion support |

---

## Design direction

The landing page uses an editorial music-culture direction rather than a generic SaaS template: deep ink surfaces, warm cream panels, electric lime accents, coral details, Bricolage Grotesque display type, Instrument Serif italic accents, and DM Mono metadata. Its signature element is a realistic live-session console with a concert cover, synced listener positions, floating queue and chat pieces, and a rotating perfect-sync stamp. The rest of the page follows an asymmetric magazine layout with a large conversion block, a four-card feature bento, a numbered how-it-works sequence, a photographic human moment, a plain-language FAQ, and an oversized closing wordmark.

The room experience keeps its focused dark console layout so playback, queue, chat, and presence remain immediately legible once the session begins.

---

## How the app behaves out of the box

You can open `index.html` immediately and use every feature. While the Firebase configuration is still using `YOUR_*` placeholder values, MusicRoom runs in **local demo mode**:

- Rooms are saved in `localStorage`.
- Changes are streamed across open tabs on the same browser with `BroadcastChannel` and the `storage` event.
- A pre-populated “After Hours” demo room is available from the landing page.
- The built-in starter catalog and direct YouTube links replace YouTube API search.

Once you add real Firebase credentials, the same UI automatically switches to cloud rooms. Once you add a real YouTube API key, search switches to the global YouTube catalog. No other code changes are needed.

> Local demo mode cannot sync between different devices or browsers. Firebase mode can.

---

## Project structure

```text
musicroom/
├── index.html          # Landing page, create/join flows, demo entry
├── room.html           # Active room layout and dialogs
├── style.css           # Unified responsive design system
├── app.js              # Landing logic, room provisioning, invites
├── room.js             # Player, sync, search, queue, chat, presence
├── firebase-config.js  # Isolated Firebase config and initialization
├── vercel.json         # Clean URLs, rewrites, security/cache headers
├── package.json        # Static app metadata and local dev script
└── README.md           # This guide
```

No bundler, framework, `npm install`, or build step is required. All libraries are loaded from CDNs.

---

## Step 1 — Create a free Firebase Realtime Database

You need a Firebase project with **Realtime Database** enabled. Firestore is not used.

### 1.1 Create the project

1. Go to the [Firebase console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Name it something like `musicroom-live`, then continue.
4. Google Analytics is optional. You can disable it for a leaner setup.
5. Wait for the project to be created.

### 1.2 Enable Realtime Database

1. In the left sidebar, open **Build → Realtime Database**.
2. Click **Create Database**.
3. Choose a region close to your listeners.
4. Start in **test mode** for the first successful deployment. The guide below gives a safer ruleset before you invite the public.
5. Realtime Database is free on the Spark plan with a daily bandwidth/connection allowance that is plenty for a small listening room.

### 1.3 Find your web app configuration

1. Open **Project settings** (gear icon) → **General**.
2. Scroll to **Your apps** and click the web icon `</>`.
3. Register an app named `MusicRoom Web`.
4. Copy the generated `firebaseConfig` values.
5. If your Realtime Database URL is not shown, open the database and copy the URL above the data viewer. It looks like:
   `https://your-project-id-default-rtdb.firebaseio.com` (or a regional URL).

### 1.4 Paste the config

Open `firebase-config.js`. Replace every placeholder in the object at the **top of the file**:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Use your exact values. `databaseURL` is required for Realtime Database.

> The Firebase web API key is a public identifier, not an admin secret. Your database security rules are the actual security boundary.

### 1.5 Security rules

For development with trusted friends, this is enough:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Paste it into **Realtime Database → Rules**, then click **Publish**.

A more deliberate ruleset validates the room shape and blocks accidental malformed writes:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['code', 'name', 'hostId', 'users'])",
        "code": {
          ".validate": "newData.isString() && newData.val().matches(/^[A-Z0-9]{6}$/)"
        },
        "name": {
          ".validate": "newData.isString() && newData.val().length <= 40"
        },
        "currentSong": {
          ".validate": "!newData.exists() || newData.hasChildren(['videoId', 'title'])"
        },
        "isPlaying": { ".validate": "newData.isBoolean()" },
        "currentTime": { ".validate": "newData.isNumber() && newData.val() >= 0" },
        "queue": {
          "$songId": {
            ".validate": "!newData.exists() || newData.hasChildren(['videoId', 'title'])"
          }
        },
        "messages": {
          "$messageId": {
            ".validate": "!newData.exists() || (newData.hasChildren(['at']) && newData.child('at').isNumber())"
          }
        }
      }
    }
  }
}
```

**Important:** MusicRoom intentionally has no sign-in, so rules cannot identify individual users. For a public deployment, add Firebase App Check (reCAPTCHA v3), a scheduled database cleanup function, and stricter rate limits. Never use rules that grant write access to your entire Firebase project.

### 1.6 Authorized domains

The Firebase web SDK does not require an OAuth redirect for Realtime Database, but it is good hygiene to add your production domain under **Authentication → Settings → Authorized domains** (or the equivalent project-level list). Local previews on `localhost` are permitted by default.

---

## Step 2 — Get a free YouTube Data API v3 key

Search is optional, but the global catalog is much more useful with it. Direct YouTube links always remain available as a fallback.

### 2.1 Enable the API

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select the same project used by Firebase, or create a new one.
3. Open **APIs & Services → Library**.
4. Search for **YouTube Data API v3**.
5. Click it and press **Enable**.

### 2.2 Create an API key

1. Open **APIs & Services → Credentials**.
2. Click **Create credentials → API key**.
3. Copy the key.
4. Click the key to edit it and add an **Application restriction → Websites**.
5. Add your domains and local testing origins:
   - `https://your-project.vercel.app/*`
   - `https://your-custom-domain.com/*`
   - `http://localhost:3000/*`
6. Under **API restrictions**, choose **Restrict key → YouTube Data API v3**.
7. Save.

### 2.3 Paste the key

Open `room.js`. The first configuration constant is at the very top of the file:

```js
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY_HERE";
```

Replace it with your key. Do not add spaces or quotes inside the key.

### 2.4 Quota is finite

The free YouTube Data API quota is **10,000 units per day** by default. A search request costs 100 units, and duration lookup (videos endpoint) adds a small cost. That is roughly 100 searches per day per Google Cloud project. If the quota is exhausted:

- Search shows a friendly notice.
- The direct YouTube link field opens automatically.
- Users can still paste any YouTube watch/share/shorts/live URL.
- Queueing, sync, chat, and playback continue to work.

For heavy production usage, add server-side caching or a proxy, split across projects, or request a quota increase from Google. Never expose a server-side billing credential in client code.

### 2.5 YouTube terms

This app embeds YouTube content using the official IFrame Player API. Ensure your use complies with the [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service) and [Developer Policies](https://developers.google.com/youtube/terms/developer-policies). Do not download, proxy, or separate audio from YouTube videos.

---

## Step 3 — Deploy to Vercel from GitHub

### 3.1 Put the files on GitHub

From the project folder:

```bash
git init
git add .
git commit -m "Build MusicRoom"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/musicroom.git
git push -u origin main
```

Create the empty repository on GitHub first. Keep your real keys in private source control if your repository is public — remember that `room.js` and `firebase-config.js` run in the browser, so the keys are visible to visitors anyway. Restrict them in Google Cloud and rely on database rules for safety.

### 3.2 Import into Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New → Project**.
3. Import your `musicroom` repository.
4. For **Framework Preset**, choose **Other**.
5. Leave **Build Command** empty. There is no build step.
6. Set **Output Directory** to `.` (or leave the default root).
7. Set **Install Command** to none/empty if Vercel offers the option.
8. Click **Deploy**.

Vercel will serve the static HTML, CSS, and JS files. `vercel.json` adds clean URLs, `/room`, `/join`, and `/listen` routes, security headers, and sensible caching.

### 3.3 After deployment

1. Open the generated `https://your-project.vercel.app` URL.
2. Create a room.
3. Open the invite link in a second browser or device.
4. Add your Vercel domain to the YouTube API key's HTTP referrer restrictions.
5. Test search, playback sync, queue voting, chat, and presence.
6. Commit and push any changes; Vercel redeploys automatically.

### 3.4 Optional custom domain

Vercel supports free custom domains on hobby projects. Add the domain in **Project → Settings → Domains**, then update:

- Your Google Cloud API key website restrictions.
- Any Firebase authorized domain list you use.
- Your GitHub repository README links.

---

## Run it locally

Because the app uses browser APIs and CDN scripts, run it through a local HTTP server rather than opening the file directly:

```bash
# Option A — Node (the package.json script)
npm run dev

# Option B — Python (already installed on many machines)
python3 -m http.server 3000

# Option C — VS Code Live Server
# Right-click index.html → Open with Live Server
```

Then open `http://localhost:3000`.

To test live sync locally without Firebase, open two tabs (not two different browsers) and join the same room. Local demo mode uses `BroadcastChannel`.

To test cloud sync, configure Firebase, open the same room on two devices, and check the People tab.

---

## How synchronization works

1. The host — or, if the host disconnects, the earliest online listener — acts as the **time broadcaster**.
2. The broadcaster writes `currentTime` and `currentTimeAt` to the room every three seconds while playing.
3. Every listener computes the expected room position:

   ```text
   expected = currentTime + (now - currentTimeAt) / 1000
   ```

4. Once per second, the listener compares `expected` with `player.getCurrentTime()`.
5. If the absolute difference exceeds **3 seconds**, the listener calls `player.seekTo(expected, true)` and the sync badge briefly reads “Re-synced.”
6. Play/pause/seek/next actions are written to the same room state, so every client receives the change and applies it through the IFrame API.
7. Browsers can block unmuted autoplay. When that happens MusicRoom shows a **Tap to join the audio** overlay; one tap starts the video at the room's current position.
8. Videos that disallow embedding are reported with a friendly playback error. The broadcaster advances to the next queue item.

This is a lightweight leader/follower model. It avoids a server, tolerates modest clock differences, and reacts to real playback drift without continuously scrubbing.

---

## Data model

```text
rooms/{ROOM_CODE}
├── version: 1
├── code: "X7K2P9"
├── name: "Saturday rotation"
├── createdAt: 1780000000000
├── updatedAt: 1780000000000
├── hostId: "u_ab12..."
├── hostName: "Alex"
├── currentSong: {
│     id, videoId, title, channel, thumbnail, durationSeconds,
│     addedBy, addedByName, addedAt, votes
│   }
├── isPlaying: true
├── currentTime: 83.42
├── currentTimeAt: 1780000000000
├── repeat: false
├── queue: {
│     "song_123": { id, videoId, title, channel, thumbnail, durationSeconds,
│                    addedBy, addedByName, addedAt, votes: { "user_id": true } }
│   }
├── messages: {
│     "msg_123": { id, uid, name, initials, color, text, at },
│     "system_1": { id, type: "system", text, at }
│   }
└── users: {
      "user_id": { id, name, initials, color, host, online, joinedAt }
    }
```

Rooms are never auto-deleted by the client. Add a Firebase scheduled Cloud Function or a cron job if you need retention limits.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| “That room isn't on this device” | You are in local demo mode and opened a room from another browser/device | Configure Firebase in `firebase-config.js`, then create a new room |
| “Permission denied” in console | Realtime Database rules reject reads/writes, or Realtime Database is not enabled | Publish the rules above and verify the `databaseURL` |
| Search always uses the starter catalog | YouTube key missing, malformed, or restricted | Put the key in `room.js`, check the Google Cloud API restriction, and redeploy |
| Search notice about quota | YouTube Data API daily limit reached | Use a direct YouTube link; wait for the quota reset or request more quota |
| Video shows a playback error | The uploader disabled embedding, the video is private, or the ID is invalid | Add another song; avoid embed-disabled videos |
| Listeners cannot hear audio | Browser autoplay policy blocked unmuted playback | Tap the **Tap to join the audio** overlay, or the room's play button once |
| Playback drifts slowly | A listener's browser throttled the player while backgrounded | Press the sync-now button beside the volume; MusicRoom also corrects drift over 3 seconds |
| Host closes their tab | The original host is offline | Any remaining listener can control playback; MusicRoom elects the earliest online user as the time broadcaster |
| Presence says online after closing | Firebase `onDisconnect` has not fired yet or the browser is suspended | Normal server-side cleanup follows when the connection closes |
| Share links point at the wrong route | Deploying to a sub-path rather than a domain root | Put the static site at the root of the Vercel project, or adjust `vercel.json` rewrites |

---

## Security and cost notes

- **No accounts** means there is no authentication boundary. Treat rooms as semi-public and never paste secrets into room names, chat, or song titles.
- The Firebase web config and YouTube API key are intended for client use, but must be restricted by domain/API in Google Cloud.
- Apply rules carefully. The permissive development rules are not suitable for a high-traffic public site.
- Messages are escaped before rendering, and thumbnails are restricted to YouTube hosts when generated. User URLs are only used for images supplied by YouTube/oEmbed.
- Firebase Realtime Database free-tier limits reset daily. Monitor usage in the Firebase console.
- Vercel hobby hosting and the Firebase Spark plan are sufficient for friends and small communities. Add rate limiting, App Check, retention, and moderation before a large public launch.
- Keep a privacy policy and terms page for any production launch, especially if you enable analytics or advertising.

---

## Quick start checklist

- [ ] Firebase project created
- [ ] Realtime Database enabled
- [ ] Database rules published
- [ ] `firebase-config.js` updated with real values
- [ ] YouTube Data API v3 enabled
- [ ] API key restricted in Google Cloud
- [ ] `room.js` key updated
- [ ] Repository pushed to GitHub
- [ ] Vercel project imported and deployed
- [ ] Production domain added to the API key restrictions
- [ ] Two-device playback and presence test passed

Made for the aux-cord generation. Free, open web, no ads.
