const admin = require("../config/firebase");
const User = require("../models/userSchema");

/**
 * Send push notification to a user (all their devices).
 * Notification এ sender এর name, image, message সব থাকবে।
 */
const sendPushToUser = async (userId, { title, body, image, data = {} }) => {
  try {
    if (!userId) return;
    const user = await User.findById(userId).select("fcmTokens isOnline");
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) return;

    // User online থাকলে push পাঠাবো না — socket এ পাচ্ছে
    if (user.isOnline) return;

    const tokens = user.fcmTokens.filter(Boolean);
    if (tokens.length === 0) return;

    const message = {
      tokens,
      notification: {
        title: title || "New message",
        body: body || "",
        // Sender এর profile image notification এ দেখাবে
        imageUrl: image || undefined,
      },
      data: Object.entries(data).reduce((acc, [k, v]) => {
        acc[k] = typeof v === "string" ? v : JSON.stringify(v);
        return acc;
      }, {}),
      android: {
        priority: "high",
        notification: {
          channelId: "messages",
          sound: "received",
          // Android এ large icon হিসেবে sender এর image
          imageUrl: image || undefined,
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "received.mp3",
            badge: 1,
            "mutable-content": 1, // iOS এ image দেখাতে লাগে
          },
        },
        // iOS এ notification image
        fcmOptions: {
          imageUrl: image || undefined,
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
      }
    });

    if (invalidTokens.length > 0) {
      await User.findByIdAndUpdate(userId, {
        $pull: { fcmTokens: { $in: invalidTokens } },
      });
    }

    console.log(`📲 Push sent to user ${userId} — success: ${res.successCount}, fail: ${res.failureCount}`);
  } catch (err) {
    console.log("FCM send error:", err.message);
  }
};

module.exports = { sendPushToUser };
