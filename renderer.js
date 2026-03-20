// ── State ──────────────────────────────────────────────────────
let selectedMp3File = null;
let logEntryCount = 0;
let unreadLogCount = 0;
let currentTab = "settings";
let currentConfig = {};

// ── Map state ──────────────────────────────────────────────────
let leafletMap = null;
let mapMarkers = [];
let lastAlertCities = [];
const citiesCoords = window.CITIES_COORDS || {};

// ── Tab Switching ──────────────────────────────────────────────
function switchTab(name) {
  currentTab = name;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  document.querySelectorAll(".tab-content").forEach((el) => {
    el.classList.remove("active");
  });

  const target = document.getElementById("tab-" + name);
  if (target) target.classList.add("active");

  if (name === "logs") {
    unreadLogCount = 0;
    updateBadge();
    scrollLogToBottom();
  }

  if (name === "map") {
    initMap();
    // Render any alerts that arrived before the map was opened
    updateMapDots(lastAlertCities);
  }
}

function updateBadge() {
  const badge = document.getElementById("logBadge");
  if (!badge) return;
  if (unreadLogCount > 0) {
    badge.textContent = unreadLogCount > 99 ? "99+" : unreadLogCount;
    badge.classList.add("visible");
  } else {
    badge.classList.remove("visible");
  }
}

// ── Load Config ────────────────────────────────────────────────
async function loadConfig() {
  const config = await window.api.getConfig();
  currentConfig = config;
  const ip = await window.api.getLocalIp();

  const city     = document.getElementById("city");
  const speaker  = document.getElementById("speaker");
  const computer = document.getElementById("computer");
  const volume   = document.getElementById("volume");
  const volVal   = document.getElementById("volVal");
  const duration = document.getElementById("songDuration");
  const startH   = document.getElementById("startHour");
  const endH     = document.getElementById("endHour");

  if (city)     city.value     = config.city || "";
  // Speaker IP: leave empty — user must scan or type manually each session
  // Computer IP: auto-detected, shown for reference (readonly)
  if (computer) computer.value = ip;
  if (volume) {
    volume.value = config.volume != null ? config.volume : 0.5;
    if (volVal) volVal.textContent = Math.round(volume.value * 100) + "%";
  }
  if (duration) duration.value = config.song_duration_ms || 60000;
  if (startH)   startH.value   = config.start_hour != null ? config.start_hour : 0;
  if (endH)     endH.value     = config.end_hour != null ? config.end_hour : 23;

  // If there's a saved song name, show it
  if (config.song_name) {
    const songName = document.getElementById("songName");
    if (songName) songName.textContent = "🎵 " + config.song_name;
  }
}

// ── Scan Devices ───────────────────────────────────────────────
async function scanDevices() {
  const btn      = document.getElementById("scanBtn");
  const btnText  = document.getElementById("scanBtnText");
  const hint     = document.getElementById("scanHint");
  const select   = document.getElementById("deviceSelect");

  if (!btn) return;

  // Show loading state
  btn.disabled = true;
  btn.classList.add("scanning");
  btnText.textContent = "סורק...";
  if (hint) {
    hint.textContent = "מחפש מכשירי Cast ברשת...";
    hint.className = "scan-hint";
  }

  const devices = await window.api.scanDevices();

  btn.disabled = false;
  btn.classList.remove("scanning");
  btnText.textContent = "סרוק";

  if (!select) return;

  // Clear old options
  select.innerHTML = "";

  if (devices.length === 0) {
    select.innerHTML = '<option value="">לא נמצאו מכשירים</option>';
    if (hint) {
      hint.textContent = "לא נמצאו מכשירי Cast. הזן את ה-IP של הרמקול ידנית.";
      hint.className = "scan-hint warn";
    }
    return;
  }

  // Populate dropdown
  select.innerHTML = '<option value="">— בחר מכשיר —</option>';
  devices.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.ip;
    opt.textContent = `${d.name}  (${d.ip})`;
    select.appendChild(opt);
  });

  if (hint) {
    hint.textContent = `נמצאו ${devices.length} מכשירים. בחר אחד למילוי ה-IP.`;
    hint.className = "scan-hint ok";
  }
}

function disableTestBtn() {
  const testBtn = document.getElementById("testBtn");
  if (testBtn) testBtn.disabled = true;
}

// When user picks a device from the dropdown → fill IP field
document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("deviceSelect");
  if (select) {
    select.addEventListener("change", () => {
      if (select.value) {
        const speaker = document.getElementById("speaker");
        if (speaker) speaker.value = select.value;
      }
      disableTestBtn();
    });
  }

  // Disable Test Sound on any config field change
  const watchIds = ["city", "speaker", "volume", "songDuration", "startHour", "endHour"];
  watchIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", disableTestBtn);
  });

  // MP3 file input change
  const mp3Input = document.getElementById("mp3file");
  if (mp3Input) {
    mp3Input.addEventListener("change", () => {
      const file = mp3Input.files[0];
      if (file) {
        selectedMp3File = file;
        const songName = document.getElementById("songName");
        if (songName) {
          songName.textContent = "🎵 " + file.name;
          songName.className = "song-name changed";
        }
        disableTestBtn();
      }
    });
  }
});

// ── Save Settings ──────────────────────────────────────────────
async function save() {
  const ip = await window.api.getLocalIp();

  // Save MP3 first if a new file was selected
  if (selectedMp3File) {
    const arrayBuffer = await selectedMp3File.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    await window.api.saveMp3(buffer, selectedMp3File.name);
    selectedMp3File = null; // clear after save
  }

  // Get the device name from dropdown if selected
  const select      = document.getElementById("deviceSelect");
  const speakerName = select && select.value
    ? (select.options[select.selectedIndex]?.text || "")
    : "";

  const volume = parseFloat(document.getElementById("volume")?.value) || 0.5;

  const config = {
    city:            document.getElementById("city")?.value?.trim()        || "",
    speaker_ip:      document.getElementById("speaker")?.value?.trim()     || "",
    speaker_name:    speakerName,
    computer_ip:     ip,
    volume:          volume,
    song_duration_ms: parseInt(document.getElementById("songDuration")?.value) || 60000,
    start_hour:      parseInt(document.getElementById("startHour")?.value) || 0,
    end_hour:        parseInt(document.getElementById("endHour")?.value)   || 23,
    song_name:       document.getElementById("songName")?.textContent?.replace("🎵 ", "") || ""
  };

  await window.api.saveConfig(config);
  currentConfig = config;

  // Enable Test Sound now that config is saved
  const testBtn = document.getElementById("testBtn");
  if (testBtn) testBtn.disabled = false;

  // Brief visual feedback on Save button
  const btn = document.querySelector(".btn-primary");
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "✅ נשמר!";
    btn.style.background = "#276749";
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = "";
    }, 1500);
  }
}

// ── Test Sound ─────────────────────────────────────────────────
async function testSound() {
  // If a new file was selected but not yet saved, write it to disk first
  if (selectedMp3File) {
    const arrayBuffer = await selectedMp3File.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    await window.api.saveMp3(buffer, selectedMp3File.name);
    selectedMp3File = null;
  }

  await window.api.testSound();

  const btn = document.querySelector(".btn-secondary");
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = "▶ מנגן...";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
}

// ── Logs ───────────────────────────────────────────────────────
function scrollLogToBottom() {
  const logBox = document.getElementById("logBox");
  if (logBox) logBox.scrollTop = logBox.scrollHeight;
}

function updateLogCount() {
  const el = document.getElementById("logCount");
  if (el) el.textContent = logEntryCount + " entr" + (logEntryCount === 1 ? "y" : "ies");
}

function clearLogs() {
  const logBox = document.getElementById("logBox");
  if (logBox) logBox.innerHTML = "";
  logEntryCount = 0;
  unreadLogCount = 0;
  updateLogCount();
  updateBadge();
}

// Listen for log messages from main process
window.api.onLog((entry) => {
  const logBox = document.getElementById("logBox");
  if (!logBox) return;

  const { msg, type, time } = entry;

  const row = document.createElement("div");
  row.className = "log-entry log-" + (type || "info");

  const timeEl = document.createElement("span");
  timeEl.className = "log-time";
  timeEl.textContent = "[" + (time || "") + "]";

  const msgEl = document.createElement("span");
  msgEl.className = "log-msg";
  msgEl.textContent = msg;

  row.appendChild(timeEl);
  row.appendChild(msgEl);
  logBox.appendChild(row);

  logEntryCount++;
  updateLogCount();

  // Auto-scroll if user is near bottom or on logs tab
  const nearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 80;
  if (nearBottom || currentTab === "logs") {
    logBox.scrollTop = logBox.scrollHeight;
  }

  // Badge for unread when on settings tab
  if (currentTab !== "logs" && type !== "check") {
    unreadLogCount++;
    updateBadge();
  }
});

// ── Map ────────────────────────────────────────────────────────
function initMap() {
  if (leafletMap) return; // already initialised

  leafletMap = L.map("mapContainer", {
    center: [31.5, 35.0],
    zoom: 7,
    zoomControl: true
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19
    }
  ).addTo(leafletMap);
}

function updateMapDots(cities) {
  if (!leafletMap) return;

  // Clear existing markers
  mapMarkers.forEach((m) => leafletMap.removeLayer(m));
  mapMarkers = [];

  const badge   = document.getElementById("mapAlertBadge");
  const noAlert = document.getElementById("mapNoAlerts");

  if (!cities || cities.length === 0) {
    if (badge)   { badge.textContent = ""; badge.classList.remove("visible"); }
    if (noAlert) noAlert.style.display = "inline";
    return;
  }

  if (noAlert) noAlert.style.display = "none";
  if (badge) {
    badge.textContent = `🔴 ${cities.length} אזעקות פעילות`;
    badge.classList.add("visible");
  }

  cities.forEach((cityName) => {
    const coords = citiesCoords[cityName];
    if (!coords) return;

    const isMyCity = cityName === currentConfig.city;

    const marker = L.circleMarker([coords.lat, coords.lng], {
      radius:      isMyCity ? 16 : 10,
      color:       isMyCity ? "#ffffff" : "#e63946",
      weight:      isMyCity ? 3 : 1,
      fillColor:   "#e63946",
      fillOpacity: isMyCity ? 0.95 : 0.75
    })
      .addTo(leafletMap)
      .bindTooltip(cityName, { permanent: false, direction: "top" });

    mapMarkers.push(marker);
  });
}

// Listen for live alert data from the polling service
window.api.onAlertData((cities) => {
  lastAlertCities = cities;
  if (currentTab === "map") {
    updateMapDots(cities);
  }
});

// ── Init ───────────────────────────────────────────────────────
loadConfig();
