const { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Force consistent userData path for both dev (npm start) and packaged exe
app.setPath("userData", path.join(app.getPath("appData"), "MusicAlert"));

const service = require("./service");

const configPath = path.join(app.getPath("userData"), "config.json");
let mainWindow = null;
let tray = null;

let config = {
  city: "עכו",
  speaker_ip: "",
  speaker_name: "",
  computer_ip: "",
  volume: 0.5,
  start_hour: 0,
  end_hour: 23,
  song_duration_ms: 60000,
  check_interval_ms: 5000
};

if (fs.existsSync(configPath)) {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config = { ...config, ...saved };
  } catch (e) {
    console.error("Failed to load config:", e.message);
  }
}

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Always keep computer_ip up-to-date
config.computer_ip = getLocalIp();

function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString("he-IL", { hour12: false });
  const entry = { msg, type, time };
  console.log(`[${time}][${type}] ${msg}`);
  if (mainWindow) {
    mainWindow.webContents.send("log-message", entry);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 820,
    minWidth: 580,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true
    },
    icon: path.join(__dirname, "icon.png"),
    title: "Music Alert"
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── Single instance lock ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — focus it and quit this one
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true });

  tray = new Tray(path.join(__dirname, "icon.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Settings",
      click: () => {
        if (!mainWindow) createWindow();
        else mainWindow.show();
      }
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);

  tray.setToolTip("Music Alert");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });

  config.computer_ip = getLocalIp();
  createWindow();
  service.startService(config, log, (cities) => {
    if (mainWindow) mainWindow.webContents.send("alert-data", cities);
  });
});

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.handle("getConfig", () => config);

ipcMain.handle("getLocalIp", () => getLocalIp());

ipcMain.handle("scanDevices", async () => {
  return new Promise((resolve) => {
    try {
      const bonjour = require("bonjour")();
      const devices = [];
      const seen = new Set();

      const browser = bonjour.find({ type: "googlecast" });

      browser.on("up", (svc) => {
        const ip = svc.addresses && svc.addresses[0];
        if (ip && !seen.has(ip)) {
          seen.add(ip);
          devices.push({
            name: svc.name || svc.host || ip,
            ip
          });
        }
      });

      setTimeout(() => {
        try { browser.stop(); } catch (e) {}
        try { bonjour.destroy(); } catch (e) {}
        resolve(devices);
      }, 4000);

    } catch (err) {
      console.error("Scan error:", err.message);
      resolve([]);
    }
  });
});

ipcMain.handle("testSound", () => {
  log("Test sound triggered", "action");
  service.playTest(config, log);
});

ipcMain.handle("saveConfig", (e, newConfig) => {
  // Update in-place so service always sees latest values
  Object.assign(config, newConfig);
  config.computer_ip = getLocalIp();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log(
    `Settings saved — City: ${config.city} | Speaker: ${config.speaker_name || config.speaker_ip || "not set"}`,
    "action"
  );
});

ipcMain.handle("saveMp3", (e, buffer, name) => {
  const filePath = path.join(app.getPath("userData"), "alarm.mp3");
  fs.writeFileSync(filePath, Buffer.from(buffer));
  log(`Song updated: ${name || "alarm.mp3"}`, "action");
});
