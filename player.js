const audio = document.getElementById("audio");
let activeStation = null;
let lastError = "";

function publishState(extra = {}) {
  const data = {
    station: activeStation,
    url: audio.currentSrc || audio.src || "",
    playing: !audio.paused,
    volume: audio.volume,
    error: lastError,
    ...extra
  };
  // Offscreen documents only expose chrome.runtime; ask the service worker to persist state.
  chrome.runtime.sendMessage({ type: "PLAYER_STATE_CHANGED", state: data }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen-player") return;
  if (message.type === "PING") {
    sendResponse({ ok: true, pong: true });
    return;
  }
  (async () => {
    try {
      switch (message.type) {
        case "PLAY_STATION": {
          activeStation = message.station;
          lastError = "";
          const url = message.url || message.station?.url;
          if (!url) throw new Error("L’URL de la station est absente.");
          if (audio.src !== url) {
            audio.src = url;
            audio.load();
          }
          audio.volume = typeof message.volume === "number" ? message.volume : audio.volume;
          publishState({ station: activeStation, url, playing: false, error: "" });
          await audio.play();
          publishState({ station: activeStation, url, playing: true, error: "" });
          break;
        }
        case "TOGGLE_PLAY":
          if (audio.paused) await audio.play(); else audio.pause();
          publishState();
          break;
        case "PAUSE":
          audio.pause();
          publishState({ playing: false });
          break;
        case "SET_VOLUME":
          audio.volume = Math.max(0, Math.min(1, Number(message.volume)));
          publishState({ volume: audio.volume });
          break;
        case "GET_STATE":
          publishState();
          break;
      }
      sendResponse({ ok: true });
    } catch (error) {
      lastError = error.message || "Lecture impossible.";
      publishState({ playing: false, error: lastError });
      sendResponse({ ok: false, error: lastError });
    }
  })();
  return true;
});

audio.addEventListener("playing", () => {
  lastError = "";
  publishState({ playing: true });
});
audio.addEventListener("pause", () => publishState({ playing: false }));
audio.addEventListener("error", () => {
  lastError = "Flux indisponible ou incompatible avec le navigateur.";
  publishState({ playing: false, error: lastError });
});
