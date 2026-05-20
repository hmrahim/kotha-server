const { createChatPostController, getMessages, markSeenController, deleteMessageController, editMessageController, setChatBackground, getChatBackground, setChatBackgroundByReceiver, setNicknameController, getNicknamesController, hideChatController } = require("../controller/chatController");
const { sendRequestController, getSentRequests, getReceivedRequests, acceptRequest, rejectRequest, getConnectedUsers, getUnseenCount, getMessageRequests } = require("../controller/conectionController");
const { userPostController, getUser, getCurrentUser, getActiveUer, searchUserByEmail, updateProfile, registerFcmToken, removeFcmToken, blockUser, unblockUser, getBlockStatus } = require("../controller/userController");
const { createStory, getStories, viewStory, replyStory, deleteStory, getStoryViews } = require("../controller/storyController");
const authMiddleware = require("../middleware/authMiddleware");
const { getAgoraToken, getCallHistory, getCallsBetween, deleteCallEntry } = require("../controller/callController");


const router = require("express").Router();

// User
router.post("/user", userPostController);
router.get("/user", authMiddleware, getUser);
router.get("/get-current-user", authMiddleware, getCurrentUser);
router.get("/get-active-user/:id", authMiddleware, getActiveUer);
router.get("/search-user/:email", authMiddleware, searchUserByEmail);
router.patch("/update-profile", authMiddleware, updateProfile);

// FCM (push notifications)
router.post("/register-fcm-token", authMiddleware, registerFcmToken);
router.post("/remove-fcm-token", authMiddleware, removeFcmToken);

// Block / Unblock
router.post("/block-user/:targetUserId", authMiddleware, blockUser);
router.post("/unblock-user/:targetUserId", authMiddleware, unblockUser);
router.get("/block-status/:targetUserId", authMiddleware, getBlockStatus);

// Chat
router.post("/create-chat", authMiddleware, createChatPostController);
router.get("/get-message/:id", authMiddleware, getMessages);
router.patch("/mark-seen/:chatId", authMiddleware, markSeenController);
router.delete("/delete-for-me/:messageId", authMiddleware, deleteMessageController);
router.delete("/messages/:messageId", authMiddleware, deleteMessageController);
router.patch("/messages/:messageId", authMiddleware, editMessageController);

// Connections
router.post("/send-request", authMiddleware, sendRequestController);
router.get("/get-sent-requests", authMiddleware, getSentRequests);
router.get("/get-received-requests", authMiddleware, getReceivedRequests);
router.patch("/accept-request/:id", authMiddleware, acceptRequest);
router.delete("/reject-request/:id", authMiddleware, rejectRequest);
router.get("/get-connected-users", authMiddleware, getConnectedUsers);
router.get("/get-unseen-count", authMiddleware, getUnseenCount);

// ✅ Message Requests (pending where I'm the receiver)
router.get("/get-message-requests", authMiddleware, getMessageRequests);

// ✅ Stories
router.post("/story", authMiddleware, createStory);
router.get("/stories", authMiddleware, getStories);
router.post("/story/:storyId/view", authMiddleware, viewStory);
router.post("/story/:storyId/reply", authMiddleware, replyStory);
router.delete("/story/:storyId", authMiddleware, deleteStory);
router.get("/story/:storyId/views", authMiddleware, getStoryViews);

// Nickname
router.patch("/set-nickname/:receiverId", authMiddleware, setNicknameController);
router.get("/get-nicknames/:receiverId", authMiddleware, getNicknamesController);

// Hide Chat (WhatsApp style)
router.delete("/hide-chat/:receiverId", authMiddleware, hideChatController);

// Chat Background
router.patch("/chat-background/:chatId", authMiddleware, setChatBackground);
router.get("/chat-background/:receiverId", authMiddleware, getChatBackground);
router.patch("/chat-background-by-receiver/:receiverId", authMiddleware, setChatBackgroundByReceiver);

// Health check
router.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ─── Agora / Call ─────────────────────────────────────────────────────────────
router.post("/agora/token", authMiddleware, getAgoraToken);
router.get("/calls/history", authMiddleware, getCallHistory);
router.delete("/calls/history/:id", authMiddleware, deleteCallEntry);
// দুইজনের মধ্যে call history — chat screen এ messages এর সাথে merge করার জন্য
router.get("/calls/between/:otherId", authMiddleware, getCallsBetween);


module.exports = router;