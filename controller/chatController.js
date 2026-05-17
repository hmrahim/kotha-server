const chatSchema = require("../models/chatSchema");
const messageSchema = require("../models/messageSchema");
const ConnectionSchema = require("../models/connection");
const { getIO, isUserOnline } = require("../socket");
const { sendPushToUser } = require("../services/fcm");
const User = require("../models/userSchema");

const previewFromMedia = (text, media) => {
  if (text && text.trim()) return text.trim();
  if (!media || media.length === 0) return "";
  const first = media[0];
  switch (first.type) {
    case "image": return "📷 Photo";
    case "video": return "🎥 Video";
    case "audio": return "🎵 Audio";
    case "voice": return "🎙️ Voice message";
    case "document": return `📄 ${first.fileName || "Document"}`;
    case "location": return "📍 Location";
    case "contact": return `👤 ${first.contactName || "Contact"}`;
    default: return "📎 Attachment";
  }
};

const typeFromMedia = (text, media) => {
  if (text && text.trim()) return "text";
  if (!media || media.length === 0) return "text";
  return media[0].type || "text";
};

/**
 * ✅ Ensures a Connection between sender & receiver.
 *  - none           → create pending with sender = me
 *  - pending + me=receiver → auto-accept (FB Messenger style reply)
 *  - pending + me=sender   → keep pending
 *  - accepted               → no change
 *  Returns { connection, justAccepted }
 */
async function ensureConnection(senderId, receiverId, io) {
  let connection = await ConnectionSchema.findOne({
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId },
    ],
  });

  let justAccepted = false;

  if (!connection) {
    connection = await ConnectionSchema.create({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });
    try {
      io && io.to(receiverId.toString()).emit("new_request");
    } catch (_) {}
  } else if (
    connection.status === "pending" &&
    connection.receiver.toString() === senderId.toString()
  ) {
    connection.status = "accepted";
    await connection.save();
    justAccepted = true;
    try {
      io && io.to(connection.sender.toString()).emit("request_accepted");
      io && io.to(connection.receiver.toString()).emit("request_accepted");
    } catch (_) {}
  }

  return { connection, justAccepted };
}

exports.createChatPostController = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, message, media, replyTo } = req.body;

    if (!receiverId || !senderId) {
      return res.status(400).json({ error: "Invalid request data" });
    }

    if (!message?.trim() && (!media || media.length === 0)) {
      return res.status(400).json({ error: "Message or media required" });
    }

    const io = getIO();

    // ✅ Block check — sender blocked by receiver OR sender blocked receiver
    const [senderUser, receiverUser] = await Promise.all([
      User.findById(senderId).select("blockedUsers"),
      User.findById(receiverId).select("blockedUsers"),
    ]);

    const senderIsBlocked = receiverUser?.blockedUsers?.some(
      (id) => id.toString() === senderId.toString()
    );
    const receiverIsBlocked = senderUser?.blockedUsers?.some(
      (id) => id.toString() === receiverId.toString()
    );

    if (senderIsBlocked) {
      return res.status(403).json({ error: "blocked", message: "You have been blocked by this user" });
    }
    if (receiverIsBlocked) {
      return res.status(403).json({ error: "blocked", message: "You have blocked this user. Unblock to send messages" });
    }

    // ✅ Ensure connection (create pending OR auto-accept on reply)
    const { connection, justAccepted } = await ensureConnection(senderId, receiverId, io);
    if (connection.status === "rejected") {
      return res.status(403).json({ error: "Connection rejected" });
    }

    const preview = previewFromMedia(message, media);
    const mtype = typeFromMedia(message, media);

    let chat = await chatSchema.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    if (!chat) {
      chat = await chatSchema.create({
        participants: [senderId, receiverId],
        lastMessage: preview,
        lastMessageType: mtype,
        lastSenderId: senderId,
        lastMessageAt: new Date(),
      });
    } else {
      chat.lastMessage = preview;
      chat.lastMessageType = mtype;
      chat.lastSenderId = senderId;
      chat.lastMessageAt = new Date();
      // ── নতুন message এলে receiver এর chat reappear করবে ──
      // যখন B → A কে message পাঠায়, তখন A (receiver) এর hiddenFor সরিয়ে দাও
      // কিন্তু sender নিজে যদি chat delete করে থাকে, সেটা সরানো হবে না
      if (chat.hiddenFor && chat.hiddenFor.length > 0) {
        chat.hiddenFor = chat.hiddenFor.filter(
          (id) => id.toString() !== receiverId.toString()
        )
        // sender নিজে যদি hide করে থাকে, সেটা সরানো হবে না — সে নিজে message
        // করছে মানে সে নিজেই দেখতে চাইছে, তাই sender এর hide-ও সরাও
        chat.hiddenFor = chat.hiddenFor.filter(
          (id) => id.toString() !== senderId.toString()
        )
      }
      await chat.save();
    }

    const receiverOnline = isUserOnline(receiverId);
    const initialStatus = receiverOnline ? "delivered" : "sent";

    const newMessage = await messageSchema.create({
      chatId: chat._id,
      senderId,
      text: message || "",
      media: media || [],
      status: initialStatus,
      replyTo: replyTo || null,
    });

    const populated = await messageSchema
      .findById(newMessage._id)
      .populate("replyTo", "text media senderId");

    const msgPayload = {
      _id: populated._id,
      chatId: chat._id,
      senderId,
      text: populated.text,
      media: populated.media,
      status: populated.status,
      replyTo: populated.replyTo || null,
      createdAt: populated.createdAt,
    };

    io.to(receiverId.toString()).emit("receive_message", msgPayload);
    io.to(receiverId.toString()).emit("new_message", { chatId: chat._id });
    io.to(senderId.toString()).emit("message_sent", msgPayload);

    if (justAccepted) {
      io.to(senderId.toString()).emit("chat_updated", { chatId: chat._id });
      io.to(receiverId.toString()).emit("chat_updated", { chatId: chat._id });
    }

    // Push notification if receiver is offline
    if (!receiverOnline) {
      const sender = await User.findById(senderId).select("name");
      sendPushToUser(receiverId, {
        title: sender?.name || "New message",
        body: preview || "Sent you a message",
        data: { chatId: chat._id.toString(), senderId: senderId.toString(), type: "message" },
      });
    }

    res.status(200).json({
      chat,
      message: populated,
      connectionStatus: connection.status,
      justAccepted,
    });
  } catch (error) {
    console.error("createChatPost error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.id;

    const chat = await chatSchema.findOne({
      participants: { $all: [senderId, receiverId] },
    });
    if (!chat) return res.status(200).json([]);

    let messages = await messageSchema
      .find({ chatId: chat._id })
      .populate("replyTo", "text media senderId")
      .sort({ createdAt: 1 });

    messages = messages.filter(
      (m) => !m.deletedFor?.some((id) => id.toString() === senderId.toString())
    );

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteMessageController = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { deleteFor } = req.body;

    if (!messageId || !deleteFor) {
      return res.status(400).json({ error: "messageId and deleteFor required" });
    }

    const message = await messageSchema.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const io = getIO();

    if (deleteFor === "everyone") {
      if (message.senderId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Only sender can delete for everyone" });
      }
      message.isDeleted = true;
      message.text = "";
      message.media = [];
      await message.save();

      const chat = await chatSchema.findById(message.chatId);
      if (chat) {
        chat.participants.forEach((pid) => {
          io.to(pid.toString()).emit("message_deleted", {
            messageId: message._id.toString(),
            chatId: message.chatId.toString(),
            deleteFor: "everyone",
          });
        });
      }
      return res.status(200).json({ success: true, deleteFor: "everyone" });
    }

    if (deleteFor === "me") {
      const alreadyDeleted = message.deletedFor?.some(
        (id) => id.toString() === userId.toString()
      );
      if (!alreadyDeleted) {
        message.deletedFor.push(userId);
        await message.save();
      }
      io.to(userId.toString()).emit("message_deleted", {
        messageId: message._id.toString(),
        chatId: message.chatId.toString(),
        deleteFor: "me",
      });
      return res.status(200).json({ success: true, deleteFor: "me" });
    }

    res.status(400).json({ error: "Invalid deleteFor value" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.editMessageController = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) return res.status(400).json({ error: "text required" });

    const message = await messageSchema.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only sender can edit" });
    }

    message.text = text.trim();
    message.isEdited = true;
    await message.save();

    const io = getIO();
    const chat = await chatSchema.findById(message.chatId);
    if (chat) {
      chat.participants.forEach((pid) => {
        io.to(pid.toString()).emit("message_edited", {
          messageId: message._id.toString(),
          chatId: message.chatId.toString(),
          text: message.text,
        });
      });
    }

    res.status(200).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markSeenController = async (req, res) => {
  const senderId = req.user.id;
  try {
    const { chatId } = req.params;
    const chat = await chatSchema.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const otherUser = chat.participants.find(
      (id) => id.toString() !== senderId.toString()
    );
    if (!otherUser) return res.status(400).json({ message: "Other user not found" });

    const result = await messageSchema.updateMany(
      { chatId, senderId: otherUser, status: { $in: ["sent", "delivered"] } },
      { $set: { status: "seen", seen: true } }
    );

    if (result.modifiedCount > 0) {
      const io = getIO();
      io.to(otherUser.toString()).emit("messages_seen", {
        chatId: chatId.toString(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Error marking seen" });
  }
};

// ✅ export helper for socketController to reuse
exports.ensureConnection = ensureConnection;
// ─── Set Chat Background ──────────────────────────────────────────────────────
exports.setChatBackground = async (req, res) => {
  try {
    const myId = req.user.id
    const { chatId } = req.params
    const { type, value, presetId } = req.body  // presetId = 'rosegold', 'twilight' etc.

    const chat = await chatSchema.findOne({ _id: chatId, participants: myId })
    if (!chat) return res.status(404).json({ message: 'Chat not found' })

    // FIX: use bgType instead of type to avoid mongoose reserved keyword conflict
    chat.chatBackground = {
      bgType:   type     || 'default',
      value:    value    || null,
      presetId: presetId || 'default',
    }
    await chat.save()

    // Normalize payload for client — send as 'type' so client doesn't need to change
    const bgPayload = {
      type:     chat.chatBackground.bgType,
      value:    chat.chatBackground.value,
      presetId: chat.chatBackground.presetId,
    }

    const io = getIO()
    chat.participants.forEach((pid) => {
      io.to(pid.toString()).emit('chat_background_changed', {
        chatId: chat._id.toString(),
        background: bgPayload,
      })
    })

    res.json({ success: true, chatId: chat._id.toString(), background: bgPayload })
  } catch (err) {
    console.error('setChatBackground error:', err)
    res.status(500).json({ message: 'Error setting background' })
  }
}

// ─── Get Chat Background ──────────────────────────────────────────────────────
exports.getChatBackground = async (req, res) => {
  try {
    const myId = req.user.id
    const { receiverId } = req.params

    const chat = await chatSchema.findOne({
      participants: { $all: [myId, receiverId] },
    }).select('chatBackground _id')

    if (!chat) return res.json({ background: { type: 'default', value: null, presetId: 'default' } })
    // Normalize bgType → type for client
    const bg = chat.chatBackground || {}
    res.json({
      chatId: chat._id,
      background: {
        type:     bg.bgType   || 'default',
        value:    bg.value    || null,
        presetId: bg.presetId || 'default',
      }
    })
  } catch (err) {
    res.status(500).json({ message: 'Error getting background' })
  }
}

// ─── Hide Chat (WhatsApp style delete) ───────────────────────────────────────
// DELETE /hide-chat/:receiverId
// সব message deletedFor[myId] করে + chat hiddenFor[myId] করে
// নতুন message আসলে chat reappear করবে (শুধু নতুন message দেখাবে)
exports.hideChatController = async (req, res) => {
  try {
    const myId = req.user.id
    const { receiverId } = req.params

    const chat = await chatSchema.findOne({
      participants: { $all: [myId, receiverId] },
    })

    if (!chat) return res.status(404).json({ message: 'Chat not found' })

    // 1. সব message এ myId → deletedFor তে add করো (bulk update)
    await messageSchema.updateMany(
      {
        chatId: chat._id,
        deletedFor: { $ne: myId }, // আগে থেকে deleted না থাকলে
      },
      { $addToSet: { deletedFor: myId } }
    )

    // 2. Chat → hiddenFor তে myId add করো
    const alreadyHidden = chat.hiddenFor?.some(
      (id) => id.toString() === myId.toString()
    )
    if (!alreadyHidden) {
      chat.hiddenFor = chat.hiddenFor || []
      chat.hiddenFor.push(myId)
      await chat.save()
    }

    res.json({ success: true })
  } catch (err) {
    console.error('hideChat error:', err)
    res.status(500).json({ message: 'Error deleting chat' })
  }
}

// ─── Set Nickname ─────────────────────────────────────────────────────────────
// PATCH /set-nickname/:receiverId  body: { targetUserId, nickname }
// targetUserId = যার nickname সেট করতে চাও (নিজে বা অন্যজন)
exports.setNicknameController = async (req, res) => {
  try {
    const myId = req.user.id
    const { receiverId } = req.params
    const { targetUserId, nickname } = req.body

    if (!targetUserId) {
      return res.status(400).json({ message: 'targetUserId required' })
    }

    // chat খোঁজো অথবা তৈরি করো
    let chat = await chatSchema.findOne({
      participants: { $all: [myId, receiverId] },
    })
    if (!chat) {
      chat = await chatSchema.create({
        participants: [myId, receiverId],
        lastMessage: '',
        lastMessageType: 'text',
        lastSenderId: myId,
        lastMessageAt: new Date(),
      })
    }

    // targetUserId টা participant কিনা চেক করো
    const isParticipant = chat.participants.some(
      (p) => p.toString() === targetUserId.toString()
    )
    if (!isParticipant) {
      return res.status(400).json({ message: 'targetUserId is not a participant' })
    }

    // nickname set বা remove করো
    if (!chat.nicknames) chat.nicknames = new Map()
    if (nickname && nickname.trim()) {
      chat.nicknames.set(targetUserId.toString(), nickname.trim())
    } else {
      chat.nicknames.delete(targetUserId.toString())
    }
    await chat.save()

    // socket দিয়ে দুজনকেই জানাও
    const io = getIO()
    const nicknamesObj = Object.fromEntries(chat.nicknames)
    chat.participants.forEach((pid) => {
      io.to(pid.toString()).emit('nicknames_updated', {
        chatId: chat._id.toString(),
        nicknames: nicknamesObj,
      })
    })

    res.json({ success: true, nicknames: nicknamesObj })
  } catch (err) {
    console.error('setNickname error:', err)
    res.status(500).json({ message: 'Error setting nickname' })
  }
}

// ─── Get Nicknames ────────────────────────────────────────────────────────────
// GET /get-nicknames/:receiverId
exports.getNicknamesController = async (req, res) => {
  try {
    const myId = req.user.id
    const { receiverId } = req.params

    const chat = await chatSchema.findOne({
      participants: { $all: [myId, receiverId] },
    }).select('nicknames _id')

    if (!chat) return res.json({ nicknames: {} })

    const nicknamesObj = chat.nicknames ? Object.fromEntries(chat.nicknames) : {}
    res.json({ chatId: chat._id, nicknames: nicknamesObj })
  } catch (err) {
    res.status(500).json({ message: 'Error getting nicknames' })
  }
}

// ─── Set Chat Background by receiverId (chatId না থাকলে) ─────────────────────
exports.setChatBackgroundByReceiver = async (req, res) => {
  try {
    const myId = req.user.id
    const { receiverId } = req.params
    const { type, value } = req.body

    // chat খোঁজো অথবা তৈরি করো
    let chat = await chatSchema.findOne({
      participants: { $all: [myId, receiverId] },
    })
    if (!chat) {
      chat = await chatSchema.create({
        participants: [myId, receiverId],
        lastMessage: '',
        lastMessageType: 'text',
        lastSenderId: myId,
        lastMessageAt: new Date(),
      })
    }

    // FIX: use bgType instead of type to avoid mongoose reserved keyword conflict
    const { presetId } = req.body
    chat.chatBackground = {
      bgType:   type     || 'default',
      value:    value    || null,
      presetId: presetId || 'default',
    }
    await chat.save()

    const bgPayload = {
      type:     chat.chatBackground.bgType,
      value:    chat.chatBackground.value,
      presetId: chat.chatBackground.presetId,
    }

    const io = getIO()
    chat.participants.forEach((pid) => {
      io.to(pid.toString()).emit('chat_background_changed', {
        chatId: chat._id.toString(),
        background: bgPayload,
      })
    })

    res.json({ success: true, chatId: chat._id.toString(), background: bgPayload })
  } catch (err) {
    console.error('setChatBackgroundByReceiver error:', err)
    res.status(500).json({ message: 'Error setting background' })
  }
}