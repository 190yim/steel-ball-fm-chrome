// Steel Ball FM — service worker Manifest V3
const OFFSCREEN_PATH = "player.html";
let creatingOffscreen = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Maintenir la lecture radio après la fermeture du popup."
  });
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();

  // createDocument() peut se terminer avant que player.js ait installé son listener.
  // On attend un PONG, puis on envoie la commande, avec quelques tentatives.
  let ready = false;
  let lastError = null;
  for (let i = 0; i < 12; i++) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: "offscreen-player",
        type: "PING"
      });
      if (response && response.ok && response.pong) {
        ready = true;
        break;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  if (!ready) throw new Error(lastError?.message || "Le lecteur audio en arrière-plan ne répond pas.");
  return await chrome.runtime.sendMessage({ ...message, target: "offscreen-player" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "player") {
    (async () => {
      try {
        const response = await sendToOffscreen(message);
        sendResponse(response || { ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Erreur du lecteur audio." });
      }
    })();
    return true;
  }

  // Do not answer messages intended for the offscreen player. Its own listener
  // must be the only listener that responds to PING and playback commands.
  if (message?.target === "offscreen-player") return;

  if (message?.type === "PLAYER_METADATA_CHANGED") {
    if (message.metadata) {
      chrome.storage.local.set({ nowPlayingMetadata: message.metadata }).catch(() => {});
      chrome.runtime.sendMessage({ type: "PLAYER_METADATA", metadata: message.metadata }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "PLAYER_STATE_CHANGED") {
    // The service worker persists state because chrome.storage is unavailable offscreen.
    if (message.state) {
      chrome.storage.local.set({ playerState: message.state }).catch(() => {});
      chrome.runtime.sendMessage({ type: "PLAYER_STATE", state: message.state }).catch(() => {});
    }
    sendResponse({ ok: true });
  }
});