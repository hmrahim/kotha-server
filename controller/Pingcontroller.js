const http = require("http");
const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const BASE_URL = process.env.APP_URL || "http://localhost:5000";
const PING_URL = BASE_URL + "/api/ping";

// ─── Ping Function ────────────────────────────────────────────────────────────
const pingServer = () => {
  // http বা https — URL দেখে নিজেই বুঝবে
  const client = PING_URL.startsWith("https") ? https : http;

  client
    .get(PING_URL, (res) => {
      console.log(`[Self-Ping] ✅ Success | Status: ${res.statusCode} | Time: ${new Date().toLocaleTimeString()}`);
    })
    .on("error", (err) => {
      console.error(`[Self-Ping] ❌ Failed | Error: ${err.message} | Time: ${new Date().toLocaleTimeString()}`);
    });
};

// ─── Start Ping ───────────────────────────────────────────────────────────────
let pingInterval = null;

const startPing = () => {
  if (pingInterval) {
    console.log("[Self-Ping] ⚠️  Already running.");
    return;
  }

  console.log(`[Self-Ping] 🚀 Started | Interval: every 14 minutes | URL: ${PING_URL}`);

  // First ping immediately on start
  pingServer();

  // Then ping every 14 minutes
  pingInterval = setInterval(pingServer, PING_INTERVAL_MS);
};

// ─── Stop Ping (optional) ─────────────────────────────────────────────────────
const stopPing = () => {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
    console.log("[Self-Ping] 🛑 Stopped.");
  }
};

// ─── Ping Status Route Handler ────────────────────────────────────────────────
const pingHandler = (req, res) => {
  res.status(200).json({
    status: "alive",
    message: "Server is running 🟢",
    time: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime() / 60)} minutes`,
  });
};

module.exports = { startPing, stopPing, pingHandler };