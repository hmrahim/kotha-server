const Story = require("../models/storySchema");
const ConnectionSchema = require("../models/connection");
const User = require("../models/userSchema");
const Message = require("../models/messageSchema");
const Chat = require("../models/chatSchema");
const { getIO, isUserOnline } = require("../socket");

// ─── Helper: get connected user ids for current user ─────────────────────────
const getConnectedUserIds = async (userId) => {
  const connections = await ConnectionSchema.find({
    $or: [{ sender: userId }, { receiver: userId }],
    status: "accepted",
  });
  return connections.map((c) =>
    c.sender.toString() === userId.toString()
      ? c.receiver.toString()
      : c.sender.toString()
  );
};

// ─── POST /story — create a story ────────────────────────────────────────────
const createStory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { media } = req.body;

    if (!media || !Array.isArray(media) || media.length === 0) {
      return res.status(400).json({ message: "media is required" });
    }

    // validate each media item
    for (const m of media) {
      if (!["image", "video", "text"].includes(m.type)) {
        return res.status(400).json({ message: "Invalid media type: " + m.type });
      }
      if (m.type !== "text" && !m.url) {
        return res.status(400).json({ message: "url required for image/video" });
      }
    }

    const story = await Story.create({ userId, media });
    const populated = await Story.findById(story._id).populate(
      "userId",
      "name photo username"
    );

    // real-time: notify connected users
    try {
      const io = getIO();
      const connectedIds = await getConnectedUserIds(userId);
      connectedIds.forEach((cid) => {
        io.to(cid).emit("new_story", {
          storyId: story._id,
          userId: userId.toString(),
        });
      });
    } catch (_) {}

    res.status(201).json(populated);
  } catch (err) {
    console.error("createStory error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /stories — get stories of connected users + self ─────────────────────
const getStories = async (req, res) => {
  try {
    const userId = req.user.id;

    const connectedIds = await getConnectedUserIds(userId);
    const allIds = [userId.toString(), ...connectedIds];

    // get all non-expired stories grouped by user
    const stories = await Story.find({
      userId: { $in: allIds },
      expiresAt: { $gt: new Date() },
    })
      .populate("userId", "name photo username isOnline")
      .sort({ createdAt: -1 })
      .lean();

    // group by userId
    const grouped = {};
    for (const story of stories) {
      const uid = story.userId._id.toString();
      if (!grouped[uid]) {
        grouped[uid] = {
          user: story.userId,
          stories: [],
          hasUnseen: false,
        };
      }
      const hasSeen = story.views.some((v) => v.userId?.toString() === userId.toString());
      if (!hasSeen) grouped[uid].hasUnseen = true;
      grouped[uid].stories.push(story);
    }

    // put self first, then others
    const result = Object.values(grouped).sort((a, b) => {
      const aIsMe = a.user._id.toString() === userId.toString();
      const bIsMe = b.user._id.toString() === userId.toString();
      if (aIsMe) return -1;
      if (bIsMe) return 1;
      // unseen first
      if (a.hasUnseen && !b.hasUnseen) return -1;
      if (!a.hasUnseen && b.hasUnseen) return 1;
      return 0;
    });

    res.json(result);
  } catch (err) {
    console.error("getStories error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /story/:storyId/view — mark a story as viewed ──────────────────────
const viewStory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    const story = await Story.findById(storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });

    // avoid duplicate views
    const alreadyViewed = story.views.some(
      (v) => v.userId?.toString() === userId.toString()
    );
    if (!alreadyViewed) {
      story.views.push({ userId, viewedAt: new Date() });
      await story.save();

      // notify story owner via socket
      try {
        const io = getIO();
        io.to(story.userId.toString()).emit("story_viewed", {
          storyId: story._id.toString(),
          viewerId: userId.toString(),
        });
      } catch (_) {}
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("viewStory error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /story/:storyId/reply — reply to a story (goes as DM) ──────────────
const replyStory = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { storyId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) return res.status(400).json({ message: "text required" });

    const story = await Story.findById(storyId).populate("userId", "name _id");
    if (!story) return res.status(404).json({ message: "Story not found" });

    const receiverId = story.userId._id;

    // save reply in story
    story.replies.push({ userId: senderId, text: text.trim(), repliedAt: new Date() });
    await story.save();

    // send as DM message
    let chat = await Chat.findOne({
      participants: { $all: [senderId, receiverId] },
    });
    if (!chat) {
      chat = await Chat.create({
        participants: [senderId, receiverId],
        lastMessage: text.trim(),
        lastMessageType: "text",
        lastSenderId: senderId,
        lastMessageAt: new Date(),
      });
    } else {
      chat.lastMessage = text.trim();
      chat.lastMessageType = "text";
      chat.lastSenderId = senderId;
      chat.lastMessageAt = new Date();
      await chat.save();
    }

    const receiverOnline = isUserOnline(receiverId.toString());
    const newMsg = await Message.create({
      chatId: chat._id,
      senderId,
      text: text.trim(),
      status: receiverOnline ? "delivered" : "sent",
      replyTo: null,
    });

    // emit via socket
    try {
      const io = getIO();
      const msgPayload = {
        _id: newMsg._id,
        chatId: chat._id,
        senderId: senderId.toString(),
        text: newMsg.text,
        media: [],
        status: newMsg.status,
        replyTo: null,
        isForwarded: false,
        createdAt: newMsg.createdAt,
        isStoryReply: true,
        storyId: storyId,
      };
      io.to(receiverId.toString()).emit("receive_message", msgPayload);
      io.to(receiverId.toString()).emit("new_message", { chatId: chat._id });
      io.to(senderId.toString()).emit("chat_updated", { chatId: chat._id });
    } catch (_) {}

    res.json({ ok: true, chatId: chat._id });
  } catch (err) {
    console.error("replyStory error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── DELETE /story/:storyId — delete own story ───────────────────────────────
const deleteStory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    const story = await Story.findById(storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    if (story.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await story.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteStory error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /story/:storyId/views — get viewers list (only story owner) ──────────
const getStoryViews = async (req, res) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    const story = await Story.findById(storyId)
      .populate("views.userId", "name photo username");
    if (!story) return res.status(404).json({ message: "Story not found" });
    if (story.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    res.json(story.views);
  } catch (err) {
    console.error("getStoryViews error:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createStory,
  getStories,
  viewStory,
  replyStory,
  deleteStory,
  getStoryViews,
};