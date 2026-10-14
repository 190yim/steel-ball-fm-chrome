const $ = id => document.getElementById(id);
let stations = [], catalogue = [], favorites = new Set(), favoriteStations = [];
let tab = 'stations', current = null, playing = false, volume = .7, searchTimer = null, searchRun = 0, nowPlayingMetadata = null, searchController = null, playRequestId = 0;

const fallback = [
  {name:'NRJ',country:'France',tags:'Pop · Hits',url:'https://scdn.nrjaudio.fm/adwz1/fr/30001/mp3_128.mp3',favicon:'',stationuuid:'fallback-nrj'},
  {name:'Skyrock',country:'France',tags:'Rap · Hip-Hop',url:'https://icecast.skyrock.net/s/natio_mp3_128k',favicon:'',stationuuid:'fallback-skyrock'},
  {name:'France Inter',country:'France',tags:'Info · Culture',url:'https://icecast.radiofrance.fr/franceinter-midfi.mp3',favicon:'',stationuuid:'fallback-inter'},
  {name:'FIP',country:'France',tags:'Jazz · Monde',url:'https://icecast.radiofrance.fr/fip-midfi.mp3',favicon:'',stationuuid:'fallback-fip'},
  {name:'BBC Radio 1',country:'United Kingdom',tags:'Pop · Dance',url:'https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one',favicon:'',stationuuid:'fallback-bbc'},
  {name:'KEXP',country:'United States',tags:'Indie · Rock',url:'https://kexp-mp3-128.streamguys1.com/kexp128.mp3',favicon:'',stationuuid:'fallback-kexp'}
];
const send = msg => chrome.runtime.sendMessage({...msg,target:'player'}).catch(() => ({ok:false}));
const stationId = s => s?.stationuuid || s?.url || s?.url_resolved || s?.name;
function upsertStation(list, station) {
  if (!station) return list;
  const id = stationId(station);
  const i = list.findIndex(s => stationId(s) === id);
  if (i >= 0) list[i] = {...list[i], ...station}; else list.push(station);
  return list;
}
function allFavoriteStations() {
  const list = favoriteStations.map(s => ({...s}));
  for (const s of stations) if (favorites.has(stationId(s))) upsertStation(list, s);
  if (current && favorites.has(stationId(current))) upsertStation(list, current);
  return list.filter(s => favorites.has(stationId(s)));
}
function logo(el, s) {
  el.replaceChildren();
  if (s?.favicon) {
    const img = document.createElement('img'); img.src = s.favicon; img.alt = '';
    img.onerror = () => el.textContent = (s.name || 'SB').slice(0,2).toUpperCase(); el.append(img);
  } else el.textContent = (s?.name || 'SB').slice(0,2).toUpperCase();
}
function renderTrack() {
  const card = $('trackCard');
  const title = $('trackTitle');
  const artist = $('trackArtist');
  const currentUrl = current?.url_resolved || current?.url || '';
  const metadata = nowPlayingMetadata && nowPlayingMetadata.url === currentUrl ? nowPlayingMetadata : null;
  if (metadata?.available && metadata.title) {
    title.textContent = metadata.title;
    artist.textContent = metadata.artist || 'Artiste non communiqué';
    card.classList.remove('waiting');
  } else {
    title.textContent = 'Titre non communiqué';
    artist.textContent = metadata?.message || (playing ? 'En attente des métadonnées de la radio…' : 'Le titre apparaît quand la radio le transmet');
    card.classList.add('waiting');
  }
}
function renderCurrent() {
  const s = current;
  $('nowName').textContent = s?.name || 'Choisis une radio'; $('nowTags').textContent = s?.tags || 'Le monde en direct';
  logo($('logo'), s); renderTrack(); $('play').textContent = playing ? 'Ⅱ' : '▶'; $('eq').classList.toggle('on', playing);
  $('favNow').textContent = s && favorites.has(stationId(s)) ? '♥' : '♡';
  $('favNow').classList.toggle('on', !!s && favorites.has(stationId(s))); $('volume').value = Math.round(volume * 100);
}
function render() {
  const q = $('search').value.trim().toLowerCase(), country = $('country').value;
  const source = tab === 'favorites' ? allFavoriteStations() : stations;
  const list = source.filter(s => (!q || `${s.name} ${s.tags || ''} ${s.country || ''}`.toLowerCase().includes(q)) && (!country || s.country === country)).slice(0,70);
  $('list').replaceChildren();
  if (!list.length) {
    const d = document.createElement('div'); d.className = 'empty';
    d.textContent = tab === 'favorites' ? (favorites.size ? 'Aucun favori ne correspond à cette recherche.' : 'Aucun favori pour le moment.') : 'Aucune station trouvée.';
    $('list').append(d); return;
  }
  for (const s of list) {
    const row = document.createElement('div'); row.className = 'station' + (stationId(current) === stationId(s) ? ' current' : '');
    const l = document.createElement('div'); l.className = 'logo'; logo(l,s);
    const meta = document.createElement('div'); meta.className = 'meta';
    const n = document.createElement('div'); n.className = 'name'; n.textContent = s.name;
    const t = document.createElement('div'); t.className = 'tags'; t.textContent = s.tags || s.country || 'Radio'; meta.append(n,t); meta.onclick = () => playStation(s);
    const h = document.createElement('button'); h.className = 'heart' + (favorites.has(stationId(s)) ? ' on' : ''); h.textContent = favorites.has(stationId(s)) ? '♥' : '♡'; h.title = favorites.has(stationId(s)) ? 'Retirer des favoris' : 'Ajouter aux favoris'; h.setAttribute('aria-label', h.title); h.onclick = () => toggleFav(s);
    const p = document.createElement('button'); p.className = 'playSmall'; p.textContent = stationId(current) === stationId(s) && playing ? 'Ⅱ' : '▶'; p.title = 'Écouter'; p.setAttribute('aria-label', 'Écouter ' + s.name); p.onclick = () => stationId(current) === stationId(s) && playing ? pause() : playStation(s);
    row.append(l,meta,h,p); $('list').append(row);
  }
}
async function persist() {
  favoriteStations = allFavoriteStations();
  await chrome.storage.local.set({favorites:[...favorites], favoriteStations, volume});
}
async function toggleFav(s) {
  const id = stationId(s);
  if (favorites.has(id)) { favorites.delete(id); favoriteStations = favoriteStations.filter(x => stationId(x) !== id); }
  else { favorites.add(id); upsertStation(favoriteStations, s); }
  try { await persist(); } catch (e) { $('status').textContent = 'Favoris modifiés, mais sauvegarde impossible.'; }
  renderCurrent(); render();
}
async function playStation(s) {
  if (!s) return;
  const url = s.url_resolved || s.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    playing = false;
    $('status').textContent = 'Lecture impossible : URL de flux absente ou invalide.';
    renderCurrent();
    return;
  }

  // Start playback first. Do not wait for storage/favorite writes before sending the command.
  const requestId = ++playRequestId;
  current = s;
  if ((nowPlayingMetadata?.url || '') !== (s.url_resolved || s.url || '')) nowPlayingMetadata = null;
  playing = false;
  renderCurrent();
  render();
  $('status').textContent = volume <= 0
    ? 'Volume à 0 % : augmente le volume pour entendre la radio.'
    : 'Connexion à ' + s.name + '…';

  const r = await send({type:'PLAY_STATION', station:s, url, volume});
  if (requestId !== playRequestId) return;
  if (!r || r.ok === false) {
    playing = false;
    renderCurrent();
    $('status').textContent = 'Lecture impossible : ' + (r?.error || 'le lecteur audio ne répond pas.');
    return;
  }

  // Save state only after the audio command has been dispatched.
  try { await persist(); } catch (e) {
    $('status').textContent = 'Commande envoyée, mais sauvegarde des favoris impossible.';
  }
}
async function pause() { playing = false; renderCurrent(); render(); await send({type:'PAUSE'}); $('status').textContent = 'Lecture en pause'; }
function normalizeStations(data) {
  return data.filter(s => s.name && (s.url_resolved || s.url)).map(s => ({...s,url:s.url_resolved || s.url,stationuuid:s.stationuuid || s.url_resolved || s.url}));
}
async function apiSearch(query, country='', signal) {
  const params = {hidebroken:'true',limit:'100',order:'clickcount',reverse:'true',codec:'MP3'};
  if (query) params.name = query; if (country) params.country = country;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), 10000);
  const abortFromCaller = () => controller.abort(signal?.reason || 'superseded');
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, {once:true});
  }
  try {
    const r = await fetch('https://de1.api.radio-browser.info/json/stations/search?' + new URLSearchParams(params), {signal:controller.signal});
    if (!r.ok) throw Error('API ' + r.status);
    return normalizeStations(await r.json());
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
}
function addFallbacks(list, query='', country='') {
  for (const s of fallback) if ((!query || `${s.name} ${s.tags} ${s.country}`.toLowerCase().includes(query.toLowerCase())) && (!country || s.country === country) && !list.some(x => stationId(x) === stationId(s))) list.push(s);
  return list;
}
async function loadStations() {
  $('status').textContent = 'Chargement du catalogue…';
  try { catalogue = await apiSearch(''); stations = addFallbacks([...catalogue]); $('status').textContent = 'Catalogue chargé · recherche étendue disponible'; }
  catch { catalogue = []; stations = [...fallback]; $('status').textContent = 'Catalogue indisponible : liste de secours affichée.'; }
  // Migrate older favorites that were saved as IDs only, when the station is in the catalogue.
  for (const s of stations) if (favorites.has(stationId(s))) upsertStation(favoriteStations, s);
  for (const s of favoriteStations) if (favorites.has(stationId(s))) upsertStation(stations, s);
  if (current && !stations.some(s => stationId(s) === stationId(current))) stations.unshift(current);
  render();
  try { await persist(); } catch {}
}
async function searchRemote() {
  const q = $('search').value.trim(), country = $('country').value, run = ++searchRun;
  if (searchController) { searchController.abort('nouvelle recherche'); searchController = null; }
  if (tab === 'favorites') { render(); return; }
  if (!q) { stations = addFallbacks([...catalogue], '', country); if (current && !stations.some(s => stationId(s) === stationId(current))) stations.unshift(current); render(); $('status').textContent = 'Catalogue chargé · recherche étendue disponible'; return; }
  if (q.length < 2) { render(); return; }
  searchController = new AbortController();
  const controller = searchController;
  $('status').textContent = 'Recherche de « ' + q + ' » dans le catalogue mondial…';
  try {
    let found = await apiSearch(q, country, controller.signal);
    if (run !== searchRun || controller.signal.aborted) return;
    found = addFallbacks(found, q, country);
    stations = found; $('status').textContent = found.length + ' résultat(s) pour « ' + q + ' »'; render();
  } catch (error) {
    if (run !== searchRun || controller.signal.aborted) return;
    const local = catalogue.filter(s => `${s.name} ${s.tags || ''} ${s.country || ''}`.toLowerCase().includes(q.toLowerCase()) && (!country || s.country === country));
    stations = local.length ? local : addFallbacks([], q, country);
    $('status').textContent = error?.message === 'API 429'
      ? 'Trop de recherches rapprochées · réessaie dans un instant.'
      : 'Recherche en ligne indisponible · résultats locaux';
    render();
  } finally {
    if (searchController === controller) searchController = null;
  }
}
$('play').onclick = () => playing ? pause() : playStation(current || stations[0] || fallback[0]);
$('favNow').onclick = () => current && toggleFav(current);
$('volume').oninput = () => {
  volume = Number($('volume').value)/100;
  chrome.storage.local.set({volume}).catch(()=>{});
  send({type:'SET_VOLUME',volume});
  if (volume <= 0) $('status').textContent = 'Volume à 0 % : augmente le volume pour entendre la radio.';
};
$('search').oninput = () => { searchRun++; render(); if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(searchRemote,350); };
$('country').onchange = () => { if (searchTimer) clearTimeout(searchTimer); searchRemote(); };
$('refresh').onclick = loadStations;
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  tab = b.dataset.tab; $('search').value = ''; $('country').value = '';
  if (searchTimer) clearTimeout(searchTimer); searchRun++;
  if (searchController) { searchController.abort('changement d’onglet'); searchController = null; }
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active',x===b));
  if (tab === 'stations') {
    stations = addFallbacks([...catalogue]);
    for (const s of favoriteStations) upsertStation(stations,s);
    if (current && !stations.some(s => stationId(s) === stationId(current))) stations.unshift(current);
    $('status').textContent = 'Catalogue chargé · recherche étendue disponible';
  }
  render();
});
chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'PLAYER_METADATA' && m.metadata) {
    nowPlayingMetadata = m.metadata;
    renderTrack();
  }
  if (m.type === 'PLAYER_STATE' && m.state) {
    // Ignore stale state from a previous station if the user has already selected
    // another one. The offscreen player remains authoritative for the actual audio,
    // but an older broadcast must not overwrite the popup's latest selection.
    const stateStationId = stationId(m.state.station);
    const currentStationId = stationId(current);
    const stateMatchesCurrent = !m.state.station || !current || stateStationId === currentStationId;
    if (!stateMatchesCurrent) {
      if (typeof m.state.volume === 'number') volume = m.state.volume;
      return;
    }
    playing = !!m.state.playing;
    if (m.state.station) current = m.state.station;
    if (typeof m.state.volume === 'number') volume = m.state.volume;
    if (m.state.error) $('status').textContent = 'Flux indisponible : ' + m.state.error;
    else if (playing && current) $('status').textContent = 'Lecture en cours · ' + current.name;
    renderCurrent(); render();
  }
});
(async () => {
  const data = await chrome.storage.local.get(['favorites','favoriteStations','playerState','volume','nowPlayingMetadata']);
  nowPlayingMetadata = data.nowPlayingMetadata || null;
  favorites = new Set(data.favorites || []); favoriteStations = Array.isArray(data.favoriteStations) ? data.favoriteStations : [];
  volume = typeof data.volume === 'number' && Number.isFinite(data.volume)
    ? Math.max(0, Math.min(1, data.volume))
    : (typeof data.playerState?.volume === 'number' ? Math.max(0, Math.min(1, data.playerState.volume)) : .7);
  if (data.playerState?.station) current = data.playerState.station;
  // Stored playing state can be stale after a browser restart; wait for live audio state instead.
  playing = false;
  renderCurrent(); await loadStations(); if (!current && stations.length) current = stations[0]; renderCurrent(); render();
  // If an offscreen player is already alive, it will publish its actual state.
  send({type:'GET_STATE'});
})();
