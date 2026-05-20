const admin = require("../config/firebase");
const User = require("../models/userSchema");

/**
 * Send push notification to a user (all their devices).
 *
 * ✅ KEY DESIGN:
 * - Regular message notification: notification + data (system tray এ দেখায়)
 * - Incoming CALL notification: data-only (notification field নেই)
 *   কারণ call এ app কে wake up করে full-screen UI দেখাতে হয়,
 *   সেটা শুধু data-only message দিয়ে সম্ভব — notification field থাকলে
 *   Android system নিজেই handle করে, app কে জানায় না।
 */
const sendPushToUser = async (userId, { title, body, image, data = {} }) => {
  try {
    if (!userId) return;
    const user = await User.findById(userId).select("fcmTokens");
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) return;

    const tokens = user.fcmTokens.filter(Boolean);
    if (tokens.length === 0) return;

    const isCallNotification = data?.type === "incoming_call";

    // ✅ FIX: Call notification — data-only
    // data-only message এ Android background/killed state এ
    // @react-native-firebase/messaging এর setBackgroundMessageHandler fire হয়
    // সেখান থেকে Notifee দিয়ে full-screen call UI দেখানো হবে
    const message = isCallNotification
      ? {
          tokens,
          // ✅ notification field নেই — data-only
          data: {
            ...Object.entries(data).reduce((acc, [k, v]) => {
              acc[k] = typeof v === "string" ? v : JSON.stringify(v);
              return acc;
            }, {}),
            // Notifee এ দেখানোর জন্য title/body data এ রাখো
            title: title || "Incoming Call",
            body: body || "",
            image: image || "",
          },
          android: {
            priority: "high",
            // ✅ ttl: 30 seconds — call 35s timeout এর মধ্যে পৌঁছাতে হবে
            ttl: 30000,
            // ✅ data-only এ directBootOk — device restart এর পরেও আসে
            directBootOk: true,
          },
        }
      : {
          // ✅ notification + data — Android system tray এ directly দেখায়
          // background/killed দুটোতেই কাজ করে, setBackgroundMessageHandler এর দরকার নেই
          tokens,
          notification: {
            title: title || "New message",
            body:  body  || "",
          },
          data: Object.entries(data).reduce((acc, [k, v]) => {
            acc[k] = typeof v === "string" ? v : JSON.stringify(v);
            return acc;
          }, {}),
          android: {
            priority: "high",
            notification: {
              channelId: "messages",
              sound:     "received",
              imageUrl:  image || undefined,
            },
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                sound: "received.mp3",
                badge: 1,
                "mutable-content": 1,
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