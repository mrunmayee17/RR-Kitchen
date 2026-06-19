// Momo voice agent client: Google Sign-In gating + real-time Gemini Live audio
// over a WebSocket to the backend proxy (browser never sees Vertex credentials).

const momo = {
  fab: document.querySelector("#momoFab"),
  panel: document.querySelector("#momoPanel"),
  minimize: document.querySelector("#momoMinimize"),
  close: document.querySelector("#momoClose"),
  authGate: document.querySelector("#momoAuthGate"),
  signInHost: document.querySelector("#googleSignIn"),
  live: document.querySelector("#momoLive"),
  status: document.querySelector("#momoStatus"),
  mic: document.querySelector("#momoMic"),
  stop: document.querySelector("#momoStop"),
  promptInput: document.querySelector("#momoPromptInput"),
  suggestions: document.querySelector(".momo-suggestions"),
  transcript: document.querySelector("#momoTranscript"),
  history: document.querySelector("#momoHistory"),
  historyList: document.querySelector("#momoHistoryList"),
  newChat: document.querySelector("#momoNewChat"),
  historyToggle: document.querySelector("#momoHistoryToggle"),
  historyPanel: document.querySelector("#momoHistoryPanel"),
  signOut: document.querySelector("#momoSignOut"),
  userChip: document.querySelector("#userChip"),
  accountLabel: document.querySelector("#momoAccountLabel"),
  emailForm: document.querySelector("#momoEmailForm"),
  nameInput: document.querySelector("#momoNameInput"),
  emailInput: document.querySelector("#momoEmailInput"),
  passwordInput: document.querySelector("#momoPasswordInput"),
  emailSubmit: document.querySelector("#momoEmailSubmit"),
  authError: document.querySelector("#momoAuthError"),
  authToggle: document.querySelector("#momoAuthToggle"),
  toggleText: document.querySelector("#momoToggleText")
};

const state = {
  user: null,
  googleClientId: null,
  authMode: "signin",
  history: [],
  viewingHistory: false,
  activeHistoryId: null
};

const TARGET_RATE = 16000; // Gemini Live input
const OUTPUT_RATE = 24000; // Gemini Live output
const SPEECH_RMS = 0.012;
const SILENCE_END_MS = 900;
const NO_SPEECH_CANCEL_MS = 10000;
const AUTO_SPEECH_FRAMES = 3;

const session = {
  ws: null,
  micStream: null,
  captureCtx: null,
  workletNode: null,
  sourceNode: null,
  sinkNode: null,
  playCtx: null,
  playHead: 0,
  playSources: [],
  waitingForPlaybackEnd: false,
  audioChunks: [],
  audioSamples: 0,
  audioFlushTimer: null,
  speechActive: false,
  lastSpeechAt: 0,
  turnStartedAt: 0,
  turnHadSpeech: false,
  autoListen: false,
  speechFrameCount: 0,
  wsReady: null,
  wsReadyResolve: null,
  wsReadyReject: null,
  turnReady: false,
  closingTurn: false,
  pendingActivityEnd: false,
  active: false,
  lastUserLine: null,
  lastMomoLine: null
};

// --- Panel open/close ------------------------------------------------------

function openPanel() {
  momo.panel.hidden = false;
  momo.fab.setAttribute("aria-expanded", "true");
  if (state.user) loadHistory();
}
function closePanel() {
  momo.panel.hidden = true;
  momo.fab.setAttribute("aria-expanded", "false");
}
momo.fab.addEventListener("click", () => (momo.panel.hidden ? openPanel() : closePanel()));
momo.minimize.addEventListener("click", closePanel);
momo.close.addEventListener("click", () => {
  stopConversation();
  closePanel();
});

// --- Auth ------------------------------------------------------------------

// Empty the visible chat so every new login starts with a fresh transcript.
function clearTranscript() {
  momo.transcript.innerHTML = "";
  session.lastUserLine = null;
  session.lastMomoLine = null;
}

function applyAuthState() {
  const signedIn = Boolean(state.user);
  momo.authGate.hidden = signedIn;
  momo.live.hidden = !signedIn;
  momo.userChip.hidden = !signedIn;
  momo.userChip.textContent = signedIn ? `Hi, ${state.user.name.split(" ")[0]}` : "";
  if (momo.accountLabel && signedIn) momo.accountLabel.textContent = state.user.email || "Signed in";
  if (!signedIn) stopConversation();
}

// Toggle the email form between "sign in" and "create account" modes.
function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  momo.nameInput.hidden = !signup;
  momo.nameInput.required = signup;
  momo.passwordInput.autocomplete = signup ? "new-password" : "current-password";
  momo.passwordInput.placeholder = signup ? "Create a password (min 8 characters)" : "Password";
  momo.emailSubmit.textContent = signup ? "Create account" : "Sign in";
  momo.toggleText.textContent = signup ? "Already have an account?" : "New to Momo?";
  momo.authToggle.textContent = signup ? "Sign in" : "Create an account";
  momo.authError.hidden = true;
}

async function submitEmailAuth(event) {
  event.preventDefault();
  const signup = state.authMode === "signup";
  const body = {
    email: momo.emailInput.value.trim(),
    password: momo.passwordInput.value,
    name: momo.nameInput.value.trim()
  };
  momo.authError.hidden = true;
  momo.emailSubmit.disabled = true;
  try {
    const response = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Could not sign you in. Please try again.");
    state.user = data;
    momo.emailForm.reset();
    setAuthMode("signin");
    clearTranscript();
    applyAuthState();
    loadHistory();
  } catch (error) {
    momo.authError.textContent = error.message;
    momo.authError.hidden = false;
  } finally {
    momo.emailSubmit.disabled = false;
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/me");
    state.user = response.ok ? await response.json() : null;
  } catch {
    state.user = null;
  }
  applyAuthState();
  loadHistory();
}

async function handleCredential(googleResponse) {
  try {
    const response = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: googleResponse.credential })
    });
    if (!response.ok) throw new Error((await response.json()).detail || "Sign-in failed.");
    state.user = await response.json();
    clearTranscript();
    applyAuthState();
    loadHistory();
  } catch (error) {
    momo.status.textContent = error.message;
  }
}

function renderSignInButton() {
  if (!window.google || !state.googleClientId) return;
  window.google.accounts.id.initialize({ client_id: state.googleClientId, callback: handleCredential });
  window.google.accounts.id.renderButton(momo.signInHost, {
    theme: "filled_blue", size: "large", text: "continue_with", shape: "pill", width: 360
  });
}

async function waitForGoogle(retries = 40) {
  while (retries-- > 0) {
    if (window.google?.accounts?.id) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

momo.emailForm.addEventListener("submit", submitEmailAuth);
momo.authToggle.addEventListener("click", () => {
  setAuthMode(state.authMode === "signup" ? "signin" : "signup");
});

momo.signOut.addEventListener("click", async () => {
  stopConversation();
  await fetch("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.history = [];
  state.viewingHistory = false;
  state.activeHistoryId = null;
  momo.historyList.innerHTML = "";
  if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
  applyAuthState();
});

momo.newChat.addEventListener("click", startFreshChat);
momo.historyToggle.addEventListener("click", async () => {
  const open = momo.historyPanel.hidden;  // currently hidden -> we're opening it
  if (open) await loadHistory();
  momo.historyPanel.hidden = !open;
  momo.historyToggle.textContent = open ? "›" : "‹";
  const label = open ? "Hide previous chats" : "Show previous chats";
  momo.historyToggle.title = label;
  momo.historyToggle.setAttribute("aria-label", label);
});

// --- Transcript ------------------------------------------------------------

// Build a single chat bubble and append it to the transcript; returns the
// text span so live transcription can keep appending fragments to it.
function buildLine(role, text, when) {
  const line = document.createElement("div");
  line.className = `momo-line ${role}`;
  if (role === "momo") {
    const avatar = document.createElement("div");
    avatar.className = "momo-avatar momo-line-avatar";
    avatar.setAttribute("aria-hidden", "true");
    line.append(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "momo-bubble";

  const bubbleText = document.createElement("span");
  bubbleText.className = "momo-bubble-text";
  bubbleText.textContent = text;

  const bubbleTime = document.createElement("span");
  bubbleTime.className = "momo-bubble-time";
  bubbleTime.textContent = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(when);

  bubble.append(bubbleText, bubbleTime);
  line.append(bubble);
  momo.transcript.append(line);
  return bubbleText;
}

function appendTranscript(role, text, key) {
  // Live transcription arrives in fragments; append to the current line per role.
  const last = key === "user" ? session.lastUserLine : session.lastMomoLine;
  if (last) {
    last.textContent += text;
  } else {
    const bubbleText = buildLine(role, text, new Date());
    if (key === "user") session.lastUserLine = bubbleText;
    else session.lastMomoLine = bubbleText;
  }
  momo.transcript.scrollTop = momo.transcript.scrollHeight;
}

function endTurnLines() {
  session.lastUserLine = null;
  session.lastMomoLine = null;
}

// --- Previous chats (left sidebar) -----------------------------------------

function formatChatDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso || "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function renderHistoryList(sessions) {
  momo.historyList.innerHTML = "";
  if (!Array.isArray(sessions) || !sessions.length) {
    const empty = document.createElement("p");
    empty.className = "momo-history-empty";
    empty.textContent = "No chats yet.";
    momo.historyList.append(empty);
    return;
  }
  sessions.forEach((chat) => {
    const item = document.createElement("div");
    item.role = "button";
    item.tabIndex = 0;
    item.className = "momo-history-item";
    item.dataset.chatId = chat.id || "";
    if (state.viewingHistory && chat.id === state.activeHistoryId) {
      item.classList.add("active");
    }

    const meta = document.createElement("span");
    meta.className = "momo-history-meta";

    const date = document.createElement("span");
    date.className = "momo-history-date";
    date.textContent = formatChatDate(chat.date);

    const title = document.createElement("span");
    title.className = "momo-history-title";
    title.textContent = chat.title || "Chat";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "momo-history-delete";
    deleteButton.title = "Delete chat";
    deleteButton.setAttribute("aria-label", `Delete ${chat.title || "chat"}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteHistorySession(chat);
    });

    meta.append(date, title);
    item.append(meta, deleteButton);
    item.addEventListener("click", () => viewHistorySession(chat, item));
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      viewHistorySession(chat, item);
    });
    momo.historyList.append(item);
  });
}

async function loadHistory() {
  if (!state.user) return;
  try {
    const response = await fetch("/api/momo/history");
    const data = response.ok ? await response.json() : [];
    state.history = Array.isArray(data) ? data : [];
  } catch {
    state.history = [];
  }
  renderHistoryList(state.history);
}

function viewHistorySession(chat, item) {
  stopConversation();
  state.viewingHistory = true;
  state.activeHistoryId = chat.id || null;
  clearTranscript();
  (chat.messages || []).forEach((msg) => {
    const role = msg.role === "user" ? "user" : "momo";
    buildLine(role, msg.content, new Date(msg.created_at));
  });
  endTurnLines();
  momo.historyList.querySelectorAll(".momo-history-item.active")
    .forEach((el) => el.classList.remove("active"));
  if (item) item.classList.add("active");
  closeHistoryPanel();
  momo.status.textContent = `Viewing your chat from ${formatChatDate(chat.date)}.`;
  momo.transcript.scrollTop = 0;
}

async function deleteHistorySession(chat) {
  if (!chat?.id) return;
  const label = chat.title || "this chat";
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

  const deletingActive = state.activeHistoryId === chat.id;
  const row = Array.from(momo.historyList.querySelectorAll(".momo-history-item"))
    .find((item) => item.dataset.chatId === chat.id);
  const button = row?.querySelector(".momo-history-delete");
  if (button) button.disabled = true;
  momo.status.textContent = "Deleting chat...";

  try {
    const response = await fetch(`/api/momo/history/${encodeURIComponent(chat.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Could not delete that chat.");
    if (deletingActive) {
      state.viewingHistory = false;
      state.activeHistoryId = null;
      clearTranscript();
    }
    await loadHistory();
    momo.status.textContent = "Chat deleted.";
  } catch (error) {
    if (button) button.disabled = false;
    momo.status.textContent = error.message || "Could not delete that chat.";
  }
}

function closeHistoryPanel() {
  momo.historyPanel.hidden = true;
  momo.historyToggle.textContent = "‹";
  momo.historyToggle.title = "Show previous chats";
  momo.historyToggle.setAttribute("aria-label", "Show previous chats");
}

async function startFreshChat() {
  if (!state.user) {
    momo.status.textContent = "Please sign in to start a new chat.";
    return;
  }
  stopConversation();
  state.viewingHistory = false;
  state.activeHistoryId = null;
  clearTranscript();
  momo.historyList.querySelectorAll(".momo-history-item.active")
    .forEach((el) => el.classList.remove("active"));
  closeHistoryPanel();
  momo.newChat.disabled = true;
  momo.status.textContent = "Starting a new chat...";
  try {
    const response = await fetch("/api/momo/session", { method: "POST" });
    if (!response.ok) throw new Error("Could not start a new chat.");
    await loadHistory();
    momo.status.textContent = "New chat ready. Tap the mic or pick a suggestion.";
  } catch (error) {
    momo.status.textContent = error.message || "Could not start a new chat.";
  } finally {
    momo.newChat.disabled = false;
  }
}

// When the user begins talking/typing while browsing history, start fresh.
function leaveHistoryView() {
  if (!state.viewingHistory) return;
  state.viewingHistory = false;
  state.activeHistoryId = null;
  clearTranscript();
  momo.historyList.querySelectorAll(".momo-history-item.active")
    .forEach((el) => el.classList.remove("active"));
}

// --- Audio playback (24 kHz PCM16 from the model) --------------------------

function ensurePlayCtx() {
  if (!session.playCtx) {
    session.playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_RATE });
    session.playHead = session.playCtx.currentTime;
  }
}

function playPcm16(arrayBuffer) {
  ensurePlayCtx();
  setMicActive(true);
  session.autoListen = false;
  session.waitingForPlaybackEnd = false;
  const int16 = new Int16Array(arrayBuffer);
  if (!int16.length) return;
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

  const buffer = session.playCtx.createBuffer(1, float32.length, OUTPUT_RATE);
  buffer.copyToChannel(float32, 0);
  const src = session.playCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(session.playCtx.destination);

  const now = session.playCtx.currentTime;
  if (session.playHead < now) session.playHead = now;
  src.start(session.playHead);
  session.playHead += buffer.duration;
  session.playSources.push(src);
  src.onended = () => {
    session.playSources = session.playSources.filter((s) => s !== src);
    finishTurnIfPlaybackDone();
  };
}

function stopPlayback() {
  session.playSources.forEach((src) => {
    try { src.stop(); } catch {}
  });
  session.playSources = [];
  session.waitingForPlaybackEnd = false;
  if (session.playCtx) session.playHead = session.playCtx.currentTime;
}

function finishTurnIfPlaybackDone() {
  if (!session.waitingForPlaybackEnd || session.playSources.length) return;
  session.waitingForPlaybackEnd = false;
  session.autoListen = true;
  setMicActive(true);
  momo.status.textContent = "Listening — ask your next question or tap pause.";
}

// --- Audio capture (mic -> 16 kHz PCM16 -> WebSocket) ----------------------

function sendControl(type) {
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type }));
}

function sendEvent(event) {
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify(event));
}

function clearAudioQueue() {
  if (session.audioFlushTimer) {
    clearTimeout(session.audioFlushTimer);
    session.audioFlushTimer = null;
  }
  session.audioChunks = [];
  session.audioSamples = 0;
}

function resetTurnSocket() {
  session.ws = null;
  session.wsReady = null;
  session.wsReadyResolve = null;
  session.wsReadyReject = null;
  session.turnReady = false;
  session.closingTurn = false;
  session.pendingActivityEnd = false;
}

function closeTurnSocket() {
  if (!session.ws) return;
  const ws = session.ws;
  ws.momoIntentionalClose = true;
  try { ws.send("end"); } catch {}
  try { ws.close(); } catch {}
  resetTurnSocket();
  if (session.active) momo.status.textContent = "Listening — ask your next question.";
}

function ensureTurnSocket() {
  if (session.ws?.readyState === WebSocket.OPEN && session.turnReady) {
    return Promise.resolve();
  }
  if (session.wsReady) return session.wsReady;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/momo`);
  ws.binaryType = "arraybuffer";
  session.ws = ws;
  session.turnReady = false;
  session.closingTurn = false;
  session.pendingActivityEnd = false;
  momo.status.textContent = "Connecting to Momo...";

  session.wsReady = new Promise((resolve, reject) => {
    session.wsReadyResolve = resolve;
    session.wsReadyReject = reject;
  });

  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      playPcm16(event.data);
      return;
    }
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleControlMessage(msg);
  });

  ws.addEventListener("close", (event) => {
    const wasIntentional = Boolean(ws.momoIntentionalClose);
    const rejectReady = session.wsReadyReject;
    if (ws !== session.ws) return;
    resetTurnSocket();

    if (event.code === 4401) {
      momo.status.textContent = "Please sign in again to talk to Momo.";
      stopConversation();
      return;
    }

    if (rejectReady && !wasIntentional) {
      rejectReady(new Error("Momo disconnected before this turn was ready."));
    }

    if (session.active) {
      if (!wasIntentional) {
        clearAudioQueue();
        session.speechActive = false;
      }
      momo.status.textContent = wasIntentional
        ? "Listening — ask your next question."
        : "Momo reconnected. Ask your next question.";
    }
  });

  ws.addEventListener("error", () => {
    if (session.wsReadyReject) session.wsReadyReject(new Error("Connection error."));
    if (session.active) momo.status.textContent = "Connection hiccup. Ask again.";
  });

  return session.wsReady;
}

function startSpeechTurn() {
  if (session.speechActive) return;
  session.speechActive = true;
  session.lastSpeechAt = Date.now();
  session.turnStartedAt = session.lastSpeechAt;
  session.turnHadSpeech = false;
  ensureTurnSocket()
    .then(() => {
      sendControl("activity_start");
      flushAudioQueue();
      if (session.pendingActivityEnd) {
        session.pendingActivityEnd = false;
        sendControl("activity_end");
      }
    })
    .catch(() => {
      clearAudioQueue();
      session.speechActive = false;
      momo.status.textContent = "Momo had trouble connecting. Tap the mic and try again.";
    });
}

function endSpeechTurn() {
  if (!session.speechActive) return;
  flushAudioQueue();
  session.speechActive = false;
  if (!session.turnReady) {
    session.pendingActivityEnd = true;
    return;
  }
  sendControl("activity_end");
}

function rms(float32) {
  if (!float32.length) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

function flushAudioQueue() {
  if (session.audioFlushTimer) {
    clearTimeout(session.audioFlushTimer);
    session.audioFlushTimer = null;
  }
  if (!session.audioSamples) {
    return;
  }
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN || !session.turnReady) {
    return;
  }

  const packet = new Int16Array(session.audioSamples);
  let offset = 0;
  session.audioChunks.forEach((chunk) => {
    packet.set(chunk, offset);
    offset += chunk.length;
  });
  session.audioChunks = [];
  session.audioSamples = 0;
  session.ws.send(packet.buffer);
}

function queueAudio(pcm16) {
  session.audioChunks.push(pcm16);
  session.audioSamples += pcm16.length;

  // Send about 100ms of 16 kHz PCM per packet. This keeps latency low without
  // flooding the Live WebSocket with tiny AudioWorklet frames.
  if (session.audioSamples >= TARGET_RATE / 10) {
    flushAudioQueue();
    return;
  }
  if (!session.audioFlushTimer) {
    session.audioFlushTimer = setTimeout(flushAudioQueue, 100);
  }
}

function floatTo16kPcm16(float32, inputRate) {
  if (inputRate === TARGET_RATE) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / TARGET_RATE;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    const sample = (float32[i0] || 0) * (1 - frac) + (float32[i0 + 1] || 0) * frac;
    out[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  return out;
}

async function startCapture() {
  session.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  session.captureCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
  await session.captureCtx.audioWorklet.addModule("momo-worklet.js");

  session.sourceNode = session.captureCtx.createMediaStreamSource(session.micStream);
  session.workletNode = new AudioWorkletNode(session.captureCtx, "capture-processor");
  const inputRate = session.captureCtx.sampleRate;

  session.workletNode.port.onmessage = (event) => {
    const now = Date.now();
    const level = rms(event.data);
    if (!session.speechActive) {
      if (!session.active || !session.autoListen || session.waitingForPlaybackEnd) return;
      if (level >= SPEECH_RMS) {
        session.speechFrameCount += 1;
        if (session.speechFrameCount >= AUTO_SPEECH_FRAMES) {
          startSpeechTurn();
          session.lastSpeechAt = now;
          session.turnHadSpeech = true;
        }
      } else {
        session.speechFrameCount = 0;
      }
      if (!session.speechActive) return;
    }

    if (level >= SPEECH_RMS) {
      session.lastSpeechAt = now;
      session.turnHadSpeech = true;
    }

    const pcm16 = floatTo16kPcm16(event.data, inputRate);
    if (pcm16.length) queueAudio(pcm16);

    if (session.speechActive && session.turnHadSpeech && now - session.lastSpeechAt >= SILENCE_END_MS) {
      endSpeechTurn();
    } else if (session.speechActive && !session.turnHadSpeech && now - session.turnStartedAt >= NO_SPEECH_CANCEL_MS) {
      clearAudioQueue();
      session.speechActive = false;
      closeTurnSocket();
      momo.status.textContent = "I did not hear anything. Tap the mic and try again.";
    }
  };

  // Keep the worklet processing without echoing the mic to the speakers.
  session.sinkNode = session.captureCtx.createGain();
  session.sinkNode.gain.value = 0;
  session.sourceNode.connect(session.workletNode);
  session.workletNode.connect(session.sinkNode);
  session.sinkNode.connect(session.captureCtx.destination);
}

// --- Session lifecycle -----------------------------------------------------

function setMicActive(active) {
  session.active = active;
  if (!active) {
    session.autoListen = false;
    session.speechFrameCount = 0;
  }
  momo.mic.textContent = active ? "⏸" : "🎙";
  momo.mic.setAttribute("aria-label", active ? "Pause listening" : "Start talking");
  momo.mic.title = active ? "Pause listening" : "Start talking";
  momo.mic.classList.toggle("momo-mic-active", active);
  momo.stop.disabled = !active;
  momo.promptInput.placeholder = active ? "Listening..." : "Ask Momo...";
}

async function startConversation() {
  if (session.active) {
    stopConversation();
    momo.status.textContent = "Paused. Tap the mic when you want to talk again.";
    return;
  }
  leaveHistoryView();
  momo.status.textContent = "Starting microphone...";
  try {
    await startCapture();
  } catch (error) {
    momo.status.textContent = "Microphone access is needed to talk to Momo.";
    return;
  }
  setMicActive(true);
  session.autoListen = false;
  startSpeechTurn();
  momo.status.textContent = "Listening — ask your question.";
}

function selectedRecipeTitle() {
  return document.querySelector("#recipeTitle")?.textContent?.trim() || "this recipe";
}

function suggestionPrompt(label) {
  const recipeTitle = selectedRecipeTitle();
  switch (label) {
    case "Repeat ingredients":
      return `Repeat the ingredients for ${recipeTitle}.`;
    case "What’s next?":
      return `What is the next step for ${recipeTitle}?`;
    case "Start over":
      return `Start over from the beginning for ${recipeTitle}.`;
    default:
      return label;
  }
}

async function sendTextTurn(prompt) {
  if (!state.user) {
    momo.status.textContent = "Please sign in to talk to Momo.";
    return;
  }
  leaveHistoryView();
  if (session.speechActive) endSpeechTurn();
  appendTranscript("user", prompt, "user");
  endTurnLines();
  setMicActive(true);
  momo.status.textContent = "Asking Momo...";
  try {
    await ensureTurnSocket();
    sendEvent({ type: "text_prompt", text: prompt });
  } catch {
    momo.status.textContent = "Momo had trouble connecting. Try again.";
    closeTurnSocket();
  }
}

function handleControlMessage(msg) {
  switch (msg.type) {
    case "ready":
      session.turnReady = true;
      if (session.wsReadyResolve) session.wsReadyResolve();
      momo.status.textContent = "Momo is listening.";
      break;
    case "user_transcript":
      appendTranscript("user", msg.text, "user");
      break;
    case "momo_transcript":
      appendTranscript("momo", msg.text, "momo");
      break;
    case "interrupted":
      stopPlayback();
      break;
    case "turn_complete":
      endTurnLines();
      closeTurnSocket();
      session.waitingForPlaybackEnd = true;
      momo.status.textContent = "Momo is finishing...";
      finishTurnIfPlaybackDone();
      loadHistory();  // pick up the exchange that was just saved
      break;
    case "error":
      momo.status.textContent = `Momo error: ${msg.detail}`;
      break;
    case "guardrail_blocked":
      appendTranscript("momo", msg.detail, "momo");
      endTurnLines();
      closeTurnSocket();
      teardownAudio();
      setMicActive(false);
      momo.status.textContent = "Cooking questions only.";
      break;
    default:
      break;
  }
}

function teardownAudio() {
  endSpeechTurn();
  flushAudioQueue();
  stopPlayback();
  if (session.workletNode) { try { session.workletNode.disconnect(); } catch {} }
  if (session.sourceNode) { try { session.sourceNode.disconnect(); } catch {} }
  if (session.sinkNode) { try { session.sinkNode.disconnect(); } catch {} }
  if (session.captureCtx) { session.captureCtx.close().catch(() => {}); }
  if (session.micStream) session.micStream.getTracks().forEach((t) => t.stop());
  session.workletNode = session.sourceNode = session.sinkNode = null;
  session.captureCtx = null;
  session.micStream = null;
  session.speechActive = false;
  session.lastSpeechAt = 0;
  session.turnStartedAt = 0;
  session.turnHadSpeech = false;
  session.speechFrameCount = 0;
}

function stopConversation() {
  if (session.ws) {
    endSpeechTurn();
    flushAudioQueue();
    closeTurnSocket();
  }
  clearAudioQueue();
  teardownAudio();
  resetTurnSocket();
  setMicActive(false);
  endTurnLines();
}

momo.mic.addEventListener("click", startConversation);
momo.stop.addEventListener("click", () => {
  stopConversation();
  momo.status.textContent = "Stopped. Tap “Start talking” to chat again.";
});
momo.suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const prompt = suggestionPrompt(button.textContent.trim());
  momo.promptInput.placeholder = button.textContent.trim();
  sendTextTurn(prompt);
});
momo.promptInput.addEventListener("focus", () => {
  momo.status.textContent = "Use the mic to talk to Momo.";
});
momo.promptInput.form.addEventListener("submit", (event) => {
  event.preventDefault();
  startConversation();
});

// --- Init ------------------------------------------------------------------

async function init() {
  try {
    const config = await (await fetch("/api/config")).json();
    state.googleClientId = config.google_client_id || null;
  } catch {
    state.googleClientId = null;
  }

  await loadSession();

  if (!state.googleClientId) {
    momo.signInHost.innerHTML = "<p>Sign-in is not configured yet. Set GOOGLE_OAUTH_CLIENT_ID on the server.</p>";
  } else if (await waitForGoogle()) {
    renderSignInButton();
  } else {
    momo.signInHost.innerHTML = "<p>Could not load Google Sign-In. Check your connection.</p>";
  }
}

init();
