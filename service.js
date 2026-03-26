const { net, app: electronApp } = require("electron");
const path = require("path");
const fs = require("fs");

const { Client, DefaultMediaReceiver } = require("castv2-client");
const express = require("express");

const userMusicPath = path.join(electronApp.getPath("appData"), "MusicAlert");
console.log("[MusicAlert] userMusicPath:", userMusicPath);

// ── Copy default song to userData so Express can serve it ───
(function ensureDefaultSong() {
  const dst = path.join(userMusicPath, "baby_shark.mp3");
  if (!fs.existsSync(dst)) {
    const candidates = [
      path.join(process.resourcesPath || "", "baby_shark.mp3"), // packaged
      path.join(__dirname, "baby_shark.mp3")                    // dev
    ];
    for (const src of candidates) {
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (e) {}
        break;
      }
    }
  }
})();

let alertPlaying = false;
let lastAlertId = null;

// ── Express music server ────────────────────────────────────
const musicApp = express();

// Serve audio files directly (avoids express.static asar issues)
musicApp.get("/music/:file", (req, res) => {
  const filePath = path.join(userMusicPath, req.params.file);
  console.log("[MusicAlert] GET /music/" + req.params.file + " → " + filePath + " exists:" + fs.existsSync(filePath));
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found: " + filePath);
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(filePath);
});


const server = musicApp.listen(3000, () => {
  console.log("Music server running on port 3000");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("Port 3000 already in use — another instance may be running.");
  } else {
    console.error("Music server error:", err.message);
  }
});

// ── Playback ────────────────────────────────────────────────

function playMusic(config, log, force = false) {
  if (alertPlaying && !force) return;

  alertPlaying = true;

  let song = "baby_shark.mp3";
  const customSong = path.join(userMusicPath, "alarm.mp3");
  if (fs.existsSync(customSong)) song = "alarm.mp3";

  const contentId   = `http://${config.computer_ip}:3000/music/${song}?t=${Date.now()}`;
  const contentType = "audio/mp3";

  const client = new Client();

  client.on("error", (err) => {
    log("Cast error: " + err.message, "error");
    try { client.close(); } catch (e) {}
    alertPlaying = false;
  });

  client.connect(config.speaker_ip, () => {
    client.launch(DefaultMediaReceiver, (err, player) => {
      if (err) {
        log("Launch error: " + err.message, "error");
        try { client.close(); } catch (e) {}
        alertPlaying = false;
        return;
      }

      client.setVolume({ level: parseFloat(config.volume) || 0.5 }, () => {});

      const media = {
        contentId,
        contentType,
        streamType: "BUFFERED"
      };

      player.load(media, { autoplay: true }, (loadErr) => {
        if (loadErr) {
          log("Player load error: " + loadErr.message, "error");
          try { client.close(); } catch (e) {}
          alertPlaying = false;
          return;
        }

        log(`Playing: ${song}`, "action");

        const duration = parseInt(config.song_duration_ms) || 60000;

        setTimeout(() => {
          try {
            player.stop(() => {
              try { client.close(); } catch (e) {}
              alertPlaying = false;
            });
          } catch (e) {
            try { client.close(); } catch (e2) {}
            alertPlaying = false;
          }
        }, duration);
      });
    });
  });
}

// ── Alert polling ────────────────────────────────────────────

function checkAlert(config, log, sendAlerts) {
  const request = net.request(
    "https://www.oref.org.il/WarningMessages/alert/alerts.json"
  );

  request.setHeader("Referer", "https://www.oref.org.il/");
  request.setHeader("X-Requested-With", "XMLHttpRequest");
  request.setHeader("User-Agent", "Mozilla/5.0");

  request.on("response", (response) => {
    let data = "";
    const decoder = new TextDecoder("utf-8");

    response.on("data", (chunk) => {
      data += decoder.decode(chunk, { stream: true });
    });

    response.on("end", () => {
      try {
        const cleanData = data.replace(/^\uFEFF/, "").trim();

        if (!cleanData) {
          log("Checked — no active alerts", "check");
          sendAlerts([]);
          return;
        }

        const json = JSON.parse(cleanData);
        const alertId = json?.id;
        const alertTitle = json?.title || "";
        const cities = json?.data || [];

        // "האירוע הסתיים" = event ended — do not play music
        if (alertTitle === "האירוע הסתיים") {
          log(`ℹ️ Event ended: ${cities.slice(0, 3).join(", ")}${cities.length > 3 ? "..." : ""}`, "info");
          sendAlerts([]);
          return;
        }

        if (cities.length === 0) {
          log("Checked — no active alerts", "check");
          sendAlerts([]);
          return;
        }

        sendAlerts(cities);

        const inMyCity = cities.includes(config.city);

        if (inMyCity) {
          log(
            `🚨 ALERT IN YOUR CITY (${config.city})! All areas: ${cities.join(", ")}`,
            "alert-mine"
          );
        } else {
          log(
            `⚠️ Alert in other areas: ${cities.join(", ")}`,
            "alert-other"
          );
        }

        if (!inMyCity) return;

        if (alertId === lastAlertId) {
          log(`Alert already handled (ID: ${alertId})`, "info");
          return;
        }

        lastAlertId = alertId;

        // Time range check
        const currentHour = new Date().getHours();
        const start = parseInt(config.start_hour) ?? 0;
        const end   = parseInt(config.end_hour)   ?? 23;
        const inRange = start <= end
          ? currentHour >= start && currentHour <= end   // normal:    07–22
          : currentHour >= start || currentHour <= end;  // overnight: 22–06

        if (!inRange) {
          log(`🕐 Alert in your city but outside active hours (${start}:00–${end}:00) — skipping`, "info");
          return;
        }

        playMusic(config, log);

      } catch (err) {
        log("Parse error: " + err.message, "error");
      }
    });
  });

  request.on("error", (err) => {
    log("API error: " + err.message, "error");
    sendAlerts([]);
  });

  request.end();
}

// ── Exports ──────────────────────────────────────────────────

module.exports.playTest = function (config, log) {
  const logFn = log || console.log;
  // Force-play even if something is already playing
  alertPlaying = false;
  playMusic(config, logFn, true);
};

module.exports.startService = function (config, log, sendAlerts) {
  const sa = sendAlerts || (() => {});
  log(`Service started — polling every 5s`, "action");

  checkAlert(config, log, sa);

  setInterval(() => {
    checkAlert(config, log, sa);
  }, 5000);
};
