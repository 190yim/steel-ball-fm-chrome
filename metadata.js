// Best-effort ICY/Shoutcast metadata reader, isolated from the stable audio playback code.
(() => {
  const audio = document.getElementById("audio");
  let controller = null;
  let activeUrl = "";
  let runId = 0;
  let metadataWatchdog = null;
  const MAX_METADATA_CONNECTION_MS = 90000;

  function sendMetadata(payload) {
    chrome.runtime.sendMessage({ type: "PLAYER_METADATA_CHANGED", metadata: payload }).catch(() => {});
  }

  function parseStreamTitle(raw) {
    const match = raw.match(/StreamTitle\s*=\s*'((?:\\.|[^'])*)'/i) ||
                  raw.match(/StreamTitle\s*=\s*"((?:\\.|[^"])*)"/i);
    if (!match) return null;
    const value = match[1].replace(/\\(['"\\])/g, "$1").replace(/\0/g, "").trim();
    if (!value) return null;
    const parts = value.split(/\s+-\s+/, 2);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return { title: parts[1].trim(), artist: parts[0].trim(), raw: value };
    }
    return { title: value, artist: "", raw: value };
  }

  function stop() {
    runId++;
    activeUrl = "";
    if (controller) controller.abort();
    controller = null;
    if (metadataWatchdog) clearTimeout(metadataWatchdog);
    metadataWatchdog = null;
  }

  async function watch(url) {
    stop();
    if (!url || !/^https?:\/\//i.test(url)) return;
    const thisRun = runId;
    activeUrl = url;
    controller = new AbortController();
    const signal = controller.signal;
    // This is a metadata-only secondary connection. Cap its lifetime so it cannot
    // duplicate the radio stream indefinitely if the server never yields metadata.
    metadataWatchdog = setTimeout(() => {
      if (thisRun === runId) {
        metadataWatchdog = null;
        // Do not restart automatically: a second live-stream connection can consume
        // bandwidth indefinitely. A new play/pause cycle may start a fresh attempt.
        controller?.abort("metadata-timeout");
        sendMetadata({ url, title: "", artist: "", available: false, message: "Recherche des titres arrêtée après 90 s pour limiter la connexion réseau." });
      }
    }, MAX_METADATA_CONNECTION_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "Icy-MetaData": "1" },
        cache: "no-store",
        signal
      });
      if (!response.ok || !response.body) {
        sendMetadata({ url, title: "", artist: "", available: false, message: "Les informations du morceau ne sont pas accessibles pour cette radio." });
        try { await response.body?.cancel(); } catch {}
        if (thisRun === runId) stop();
        return;
      }
      const intervalHeader = response.headers.get("icy-metaint") || response.headers.get("Icy-MetaInt");
      const interval = Number(intervalHeader);
      if (!Number.isFinite(interval) || interval <= 0) {
        try { await response.body.cancel(); } catch {}
        sendMetadata({ url, title: "", artist: "", available: false, message: "Cette radio ne transmet pas de métadonnées ICY lisibles." });
        if (thisRun === runId) stop();
        return;
      }

      sendMetadata({ url, title: "", artist: "", available: false, message: "Recherche des informations du morceau…" });
      const reader = response.body.getReader();
      let audioRemaining = interval;
      let metadataRemaining = null;
      let metadataParts = [];
      let metadataLength = 0;

      while (thisRun === runId && !signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          if (audioRemaining > 0) {
            const count = Math.min(audioRemaining, value.length - offset);
            audioRemaining -= count;
            offset += count;
            continue;
          }
          if (metadataRemaining === null) {
            metadataRemaining = value[offset++] * 16;
            if (metadataRemaining === 0) {
              audioRemaining = interval;
              metadataRemaining = null;
            }
            continue;
          }
          const count = Math.min(metadataRemaining, value.length - offset);
          metadataParts.push(value.slice(offset, offset + count));
          metadataLength += count;
          metadataRemaining -= count;
          offset += count;
          if (metadataRemaining === 0) {
            const bytes = new Uint8Array(metadataLength);
            let cursor = 0;
            for (const part of metadataParts) { bytes.set(part, cursor); cursor += part.length; }
            const raw = new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "").trim();
            const parsed = parseStreamTitle(raw);
            if (parsed && thisRun === runId) {
              sendMetadata({ url, ...parsed, available: true, message: "" });
            }
            metadataParts = [];
            metadataLength = 0;
            metadataRemaining = null;
            audioRemaining = interval;
          }
        }
      }
      try { await reader.cancel(); } catch {}
    } catch (error) {
      if (error?.name !== "AbortError" && thisRun === runId) {
        sendMetadata({ url, title: "", artist: "", available: false, message: "Métadonnées non accessibles pour cette radio." });
      }
    }
  }

  audio.addEventListener("playing", () => {
    const url = audio.currentSrc || audio.src;
    if (url && url !== activeUrl) watch(url);
  });
  audio.addEventListener("pause", () => {
    stop();
    const url = audio.currentSrc || audio.src;
    if (url) sendMetadata({ url, title: "", artist: "", available: false, message: "Lecture en pause." });
  });
  audio.addEventListener("emptied", stop);
  audio.addEventListener("error", () => {
    const url = audio.currentSrc || audio.src;
    stop();
    if (url) sendMetadata({ url, title: "", artist: "", available: false, message: "Impossible de lire les métadonnées de ce flux." });
  });
})();
