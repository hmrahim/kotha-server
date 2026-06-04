const { createChatPostController, getMessages, markSeenController, deleteMessageController, editMessageController, setChatBackground, getChatBackground, setChatBackgroundByReceiver, setNicknameController, getNicknamesController, hideChatController } = require("../controller/chatController");
const { sendRequestController, getSentRequests, getReceivedRequests, acceptRequest, rejectRequest, getConnectedUsers, getUnseenCount, getMessageRequests } = require("../controller/conectionController");
const { userPostController, getUser, getCurrentUser, getActiveUer, searchUserByEmail, updateProfile, registerFcmToken, removeFcmToken, blockUser, unblockUser, getBlockStatus, signup, login, logout, refreshToken, changePassword, verifyEmail, resendVerificationEmail, forgotPassword, resetPassword, verifyResetOtp } = require("../controller/userController");
const { createStory, getStories, viewStory, replyStory, deleteStory, getStoryViews } = require("../controller/storyController");
const authMiddleware = require("../middleware/authMiddleware");
const { getCallHistory, getCallsBetween, deleteCallEntry, rejectCallById } = require("../controller/callController");
const { pingHandler } = require("../controller/Pingcontroller");

const router = require("express").Router();

router.post("/auth/signup", signup);
router.post("/auth/login", login);
router.post("/auth/refresh-token", refreshToken);
router.post("/auth/logout", logout);
router.post("/auth/change-password", authMiddleware, changePassword);
router.post("/auth/verify-email", verifyEmail); // OTP verify — POST, body: { userId, otp }
router.post("/auth/resend-verification", authMiddleware, resendVerificationEmail);


router.post("/auth/forgot-password", forgotPassword);         // Step 1: OTP পাঠাও
router.post("/auth/verify-reset-otp", verifyResetOtp);        // Step 2: OTP verify
router.post("/auth/reset-password", resetPassword);           // Step 3: নতুন password
 
router.post("/user", userPostController);
router.get("/user", authMiddleware, getUser);
router.get("/get-current-user", authMiddleware, getCurrentUser);
router.get("/get-active-user/:id", authMiddleware, getActiveUer);
router.get("/search-user/:email", authMiddleware, searchUserByEmail);
router.patch("/update-profile", authMiddleware, updateProfile);

router.post("/register-fcm-token", authMiddleware, registerFcmToken);
router.post("/remove-fcm-token", authMiddleware, removeFcmToken);

router.post("/block-user/:targetUserId", authMiddleware, blockUser);
router.post("/unblock-user/:targetUserId", authMiddleware, unblockUser);
router.get("/block-status/:targetUserId", authMiddleware, getBlockStatus);

router.post("/create-chat", authMiddleware, createChatPostController);
router.get("/get-message/:id", authMiddleware, getMessages);
router.patch("/mark-seen/:chatId", authMiddleware, markSeenController);
router.delete("/delete-for-me/:messageId", authMiddleware, deleteMessageController);
router.delete("/messages/:messageId", authMiddleware, deleteMessageController);
router.patch("/messages/:messageId", authMiddleware, editMessageController);

router.post("/send-request", authMiddleware, sendRequestController);
router.get("/get-sent-requests", authMiddleware, getSentRequests);
router.get("/get-received-requests", authMiddleware, getReceivedRequests);
router.patch("/accept-request/:id", authMiddleware, acceptRequest);
router.delete("/reject-request/:id", authMiddleware, rejectRequest);
router.get("/get-connected-users", authMiddleware, getConnectedUsers);
router.get("/get-unseen-count", authMiddleware, getUnseenCount);
router.get("/get-message-requests", authMiddleware, getMessageRequests);

router.post("/story", authMiddleware, createStory);
router.get("/stories", authMiddleware, getStories);
router.post("/story/:storyId/view", authMiddleware, viewStory);
router.post("/story/:storyId/reply", authMiddleware, replyStory);
router.delete("/story/:storyId", authMiddleware, deleteStory);
router.get("/story/:storyId/views", authMiddleware, getStoryViews);

router.patch("/set-nickname/:receiverId", authMiddleware, setNicknameController);
router.get("/get-nicknames/:receiverId", authMiddleware, getNicknamesController);
router.delete("/hide-chat/:receiverId", authMiddleware, hideChatController);

router.patch("/chat-background/:chatId", authMiddleware, setChatBackground);
router.get("/chat-background/:receiverId", authMiddleware, getChatBackground);
router.patch("/chat-background-by-receiver/:receiverId", authMiddleware, setChatBackgroundByReceiver);

router.get("/calls/history", authMiddleware, getCallHistory);
router.delete("/calls/history/:id", authMiddleware, deleteCallEntry);
router.get("/calls/between/:otherId", authMiddleware, getCallsBetween);
router.post("/calls/:callId/reject", rejectCallById);

router.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
router.get("/ping", pingHandler);

module.exports = router;