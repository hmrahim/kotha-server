// app.js — Kotha chat server (Express + Socket.IO + MongoDB + Firebase Admin)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");

const connectDB = require("./config/database");
const router = require("./routes/router");
const { initSocket } = require("./socket");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: "*", credentials: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

app.get("/", (req, res) =>
  res.json({ message: "Kotha Chat Backend running 🚀", ts: Date.now() })
);

// 404
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

// Error handler
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const server = http.createServer(app);
initSocket(server);

connectDB();

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = { app, server };
