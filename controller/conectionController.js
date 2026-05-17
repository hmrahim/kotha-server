// controller/connectionController.js
const User = require("../models/userSchema");
const ConnectionSchema = require("../models/connection");
const chatSchema = require("../models/chatSchema");
const messageSchema = require("../models/messageSchema");
const { getIO } = require("../socket");

// 📤 Send Request
exports.sendRequestController = async (req, res) => {
  try {
    const receiverId = req.body.id;
    const senderId = req.user.id;

    if (!receiverId) return res.status(400).json({ message: "Receiver id required" });
    if (receiverId === senderId.toString()) {
      return res.status(400).json({ message: "Cannot send request to yourself" });
    }

    const existing = await ConnectionSchema.findOne({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    });
    if (existing) return res.status(400).json({ message: "Request already exists" });

    const connection = await ConnectionSchema.create({
      sender: senderId,
      receiver: receiverId,
    });

    try {
      const io = getIO();
      io.to(receiverId.toString()).emit("new_request");
    } catch (_) {}

    res.status(200).json({ message: "Request sent", connection });
  } catch (error) {
    console.log("sendRequest error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

exports.getSentRequests = async (req, res) => {
  try {
    const requests = await ConnectionSchema.find({
      sender: req.user.id.toString(),
      status: "pending",
    }).populate("receiver", "name email photo username");
    res.status(200).json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReceivedRequests = async (req, res) => {
  try {
    const requests = await ConnectionSchema.find({
      receiver: req.user.id.toString(),
      status: "pending",
    }).populate("sender", "name email photo username");
    res.status(200).json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.acceptRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await ConnectionSchema.findByIdAndUpdate(
      id,
      { status: "accepted" },
      { new: true }
    );
    if (!connection) return res.status(404).json({ message: "Request not found" });

    const existingChat = await chatSchema.findOne({
      participants: { $all: [connection.sender, connection.receiver] },
    });

    if (!existingChat) {
      await chatSchema.create({
        participants: [connection.sender, connection.receiver],
      });
    }

    try {
      const io = getIO();
      io.to(connection.sender.toString()).emit("request_accepted");
      io.to(connection.receiver.toString()).emit("request_accepted");
    } catch (_) {}

    res.json({ message: "Request accepted", connection });
  } catch (err) {
    console.log("acceptRequest error:", err.message);
    res.status(500).json({ message: err.message });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await ConnectionSchema.findByIdAndDelete(id);

    if (connection) {
      try {
        const io = getIO();
        io.to(connection.sender.toString()).emit("request_rejected");
      } catch (_) {}
    }
    res.json({ message: "Request rejected" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * ✅ Returns ONLY users with whom I have an accepted connection
 *    OR a pending request that I SENT (so I can still see my own outgoing chat).
 *
 *  - lastMessage, lastMessageAt, lastMessageType, lastSenderId
 *  - unreadCount, lastSeen (boolean, whether lastMessage was seen)
 *  - chatId, connectionStatus, isPendingByMe
 *
 * Sorted by lastMessageAt desc.
 */
exports.getConnectedUsers = async (req, res) => {
  try {
    const myId = req.user.id;

    // 1. find connections involving me, exclude pending where I'm receiver (those are requests)
    const connections = await ConnectionSchema.find({
      $or: [
        { sender: myId, status: { $in: ["pending", "accepted"] } },
        { receiver: myId, status: "accepted" },
      ],
    }).lean();

    const peerInfo = {}; // peerId -> { connectionStatus, isPendingByMe }
    connections.forEach((c) => {
      const peerId =
        c.sender.toString() === myId.toString()
          ? c.receiver.toString()
          : c.sender.toString();
      peerInfo[peerId] = {
        connectionStatus: c.status,
        isPendingByMe:
          c.status === "pending" && c.sender.toString() === myId.toString(),
      };
    });

    const peerIds = Object.keys(peerInfo);
    if (peerIds.length === 0) return res.status(200).json([]);

    const users = await User.find(
      { _id: { $in: peerIds } },
      "name email photo coverPhoto username bio phone isOnline lastSeen createdAt"
    ).lean();

    // 2. chats involving me — hidden chats আলাদা করে track করো
    const allMyChats = await chatSchema
      .find({ participants: { $all: [myId] } })
      .lean();

    // hidden chat এর peer ids বের করো
    const hiddenPeerIds = new Set()
    allMyChats.forEach((c) => {
      const isHiddenForMe = c.hiddenFor?.some(
        (id) => id.toString() === myId.toString()
      )
      if (isHiddenForMe) {
        const peer = c.participants.find((p) => p.toString() !== myId.toString())
        if (peer) hiddenPeerIds.add(peer.toString())
      }
    })

    // visible chats only (hidden না)
    const chats = allMyChats.filter((c) => {
      return !c.hiddenFor?.some((id) => id.toString() === myId.toString())
    })

    const chatByPeer = {};
    chats.forEach((c) => {
      const peer = c.participants.find((p) => p.toString() !== myId.toString());
      if (peer && peerInfo[peer.toString()]) {
        chatByPeer[peer.toString()] = c;
      }
    });

    const chatIds = Object.values(chatByPeer).map((c) => c._id);

    const unreadAgg = chatIds.length
      ? await messageSchema.aggregate([
          {
            $match: {
              chatId: { $in: chatIds },
              senderId: { $ne: myId },
              status: { $in: ["sent", "delivered"] },
            },
          },
          { $group: { _id: "$chatId", count: { $sum: 1 } } },
        ])
      : [];
    const unreadMap = {};
    unreadAgg.forEach((u) => {
      unreadMap[u._id.toString()] = u.count;
    });

    const lastMsgs = chatIds.length
      ? await messageSchema.aggregate([
          { $match: { chatId: { $in: chatIds } } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: "$chatId",
              status: { $first: "$status" },
              senderId: { $first: "$senderId" },
            },
          },
        ])
      : [];
    const lastMsgMap = {};
    lastMsgs.forEach((m) => {
      lastMsgMap[m._id.toString()] = m;
    });

    const enriched = users.map((u) => {
      const chat = chatByPeer[u._id.toString()];
      const cid = chat?._id?.toString();
      const lm = cid ? lastMsgMap[cid] : null;
      const info = peerInfo[u._id.toString()] || {};

      return {
        ...u,
        profileImage: u.photo?.url || "",
        coverImage: u.coverPhoto?.url || "",
        chatId: cid || null,
        lastMessage: chat?.lastMessage || "",
        lastMessageType: chat?.lastMessageType || "text",
        lastSenderId: chat?.lastSenderId || lm?.senderId || null,
        lastMessageAt: chat?.lastMessageAt || chat?.updatedAt || null,
        lastSeen: lm
          ? lm.senderId?.toString() === myId.toString()
            ? lm.status === "seen"
            : true
          : true,
        unreadCount: (cid && unreadMap[cid]) || 0,
        connectionStatus: info.connectionStatus || null,
        isPendingByMe: !!info.isPendingByMe,
      };
    });

    // hidden chat এর users বাদ দাও — reload এ আর আসবে না
    const visible = enriched.filter(
      (u) => !hiddenPeerIds.has(u._id?.toString())
    );

    visible.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      }
      if (a.lastMessageAt && !b.lastMessageAt) return -1;
      if (!a.lastMessageAt && b.lastMessageAt) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });

    res.status(200).json(visible);
  } catch (err) {
    console.log("getConnectedUsers error:", err.message);
    res.status(500).json({ message: err.message });
  }
};

/**
 * ✅ Message Requests — pending connections where I'm the receiver.
 * Returns sender user info + chat last message preview/time/unreadCount.
 */
exports.getMessageRequests = async (req, res) => {
  try {
    const myId = req.user.id;

    const requests = await ConnectionSchema.find({
      receiver: myId,
      status: "pending",
    })
      .populate("sender", "name email photo username isOnline lastSeen")
      .lean();

    if (requests.length === 0) return res.status(200).json([]);

    const senderIds = requests.map((r) => r.sender._id);

    // find chats between me and each sender
    const chats = await chatSchema
      .find({
        participants: { $all: [myId] },
        $expr: { $in: ["$participants", []] }, // placeholder, replaced below
      })
      .lean()
      .catch(() => []);

    // simpler: query all chats where I'm a participant, filter in code
    const allMyChats = await chatSchema
      .find({ participants: myId })
      .lean();

    const chatByPeer = {};
    allMyChats.forEach((c) => {
      const peer = c.participants.find((p) => p.toString() !== myId.toString());
      if (peer) chatByPeer[peer.toString()] = c;
    });

    const chatIds = senderIds
      .map((sid) => chatByPeer[sid.toString()]?._id)
      .filter(Boolean);

    const unreadAgg = chatIds.length
      ? await messageSchema.aggregate([
          {
            $match: {
              chatId: { $in: chatIds },
              senderId: { $ne: myId },
              status: { $in: ["sent", "delivered"] },
            },
          },
          { $group: { _id: "$chatId", count: { $sum: 1 } } },
        ])
      : [];
    const unreadMap = {};
    unreadAgg.forEach((u) => {
      unreadMap[u._id.toString()] = u.count;
    });

    const enriched = requests.map((r) => {
      const sender = r.sender;
      const chat = chatByPeer[sender._id.toString()];
      const cid = chat?._id?.toString();
      return {
        _id: r._id, // connection id
        connectionId: r._id,
        createdAt: r.createdAt,
        user: {
          _id: sender._id,
          name: sender.name,
          email: sender.email,
          username: sender.username,
          profileImage: sender.photo?.url || "",
          isOnline: sender.isOnline || false,
          lastSeen: sender.lastSeen || null,
        },
        chatId: cid || null,
        lastMessage: chat?.lastMessage || "",
        lastMessageType: chat?.lastMessageType || "text",
        lastMessageAt: chat?.lastMessageAt || r.createdAt,
        unreadCount: (cid && unreadMap[cid]) || 0,
      };
    });

    enriched.sort(
      (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
    );

    res.status(200).json(enriched);
  } catch (err) {
    console.log("getMessageRequests error:", err.message);
    res.status(500).json({ message: err.message });
  }
};

exports.getUnseenCount = async (req, res) => {
  try {
    const myId = req.user.id;
    const chats = await chatSchema.find({ participants: myId });
    const unseenCounts = await Promise.all(
      chats.map(async (chat) => {
        const count = await messageSchema.countDocuments({
          chatId: chat._id,
          senderId: { $ne: myId },
          status: { $in: ["sent", "delivered"] },
        });
        const otherId = chat.participants.find(
          (p) => p.toString() !== myId.toString()
        );
        return { userId: otherId, count };
      })
    );
    res.json(unseenCounts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};