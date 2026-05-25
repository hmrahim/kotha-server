const admin = require("../config/firebase");
const User = require("../models/userSchema");

const sendPushToUser = async (userId, { title, body, image, data = {} }) => {
  try {
    if (!userId) return;
    const user = await User.findById(userId).select("fcmTokens");
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) return;

    const tokens = user.fcmTokens.filter(Boolean);
    if (tokens.length === 0) return;

    const isCallNotification = data?.type === "incoming_call";

    // ✅ সব data value string এ convert করো (FCM requirement)
    const stringData = Object.entries(data).reduce((acc, [k, v]) => {
      acc[k] = typeof v === "string" ? v : JSON.stringify(v);
      return acc;
    }, {});

    const message = isCallNotification
      ? {
          tokens,
          // ✅ Call: data-only — index.js background handler Notifee দিয়ে দেখাবে
          // notification field নেই — Android system auto notification দেখাবে না
          data: {
            ...stringData,
            title: title || "Incoming Call",
            body:  body  || "",
            image: image || "",
          },
          android: {
            priority: "high",
            ttl: 30000,
            directBootOk: true,
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                sound: "ringtone.mp3",
                badge: 1,
                "mutable-content": 1,
                "content-available": 1,
              },
            },
          },
        }
      : {
          // ✅ Message: data-only — index.js background handler Notifee দিয়ে দেখাবে
          // notification field নেই — duplicate notification বন্ধ
          tokens,
          data: {
            ...stringData,
            title: title || "New message",
            body:  body  || "",
            image: image || "",
          },
          android: {
            priority: "high",
            ttl: 86400000, // 24 hours
            directBootOk: true,
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                sound: "received.mp3",
                badge: 1,
                "mutable-content": 1,
                "content-available": 1,
              },
            },
          },
        };

    const res = await admin.messaging().sendEachForMulticast(message);

    // Invalid token clean up
    const invalidTokens = [];
    res.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument") ||
          code.includes("invalid-registration-token")
        ) {
          invalidTokens.push(tokens[idx]);
        }
        console.warn(`[FCM] token ${idx} failed:`, r.error?.code);
      }
    });

    if (invalidTokens.length > 0) {
      await User.findByIdAndUpdate(userId, {
        $pull: { fcmTokens: { $in: invalidTokens } },
      });
    }

    console.log(
      `📲 Push sent to user ${userId} [${isCallNotification ? "CALL" : "MSG"}]` +
      ` — success: ${res.successCount}, fail: ${res.failureCount}`
    );
  } catch (err) {
    console.log("FCM send error:", err.message);
  }
};

module.exports = { sendPushToUser };