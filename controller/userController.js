const ConnectionSchema = require("../models/connection");
const User = require("../models/userSchema");

exports.userPostController = async (req, res) => {
  try {
    const { name, email, firebaseUid } = req.body;
    if (!name || !email || !firebaseUid) {
      return res.status(400).json({ error: "name, email, firebaseUid required" });
    }

    // Check existing
    const existingUser = await User.findOne({ firebaseUid });
    if (existingUser) return res.status(200).json(existingUser);

    // Generate username base
    let base = (name || email.split("@")[0]).toLowerCase();
    base = base.replace(/[^a-z0-9 ]/g, "").trim().replace(/s+/g, "_") || firebaseUid;

    let username = base;
    let exists = await User.findOne({ username });
    let count = 1;
    while (exists) {
      username = `${base}_${count}`;
      exists = await User.findOne({ username });
      count++;
    }

    const newUser = new User({ name, email, firebaseUid, username });
    const savedUser = await newUser.save();
    res.status(200).json(savedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUser = async (req, res) => {
  const uid = req.user.firebaseUid;
  try {
    const user = await User.find({ firebaseUid: { $ne: uid } });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCurrentUser = async (req, res) => {
  const uid = req.user.firebaseUid;
  try {
    const user = await User.findOne({ firebaseUid: uid });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getActiveUer = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ EXACT email match (case-insensitive). নিজেকে result এ আনবে না।
exports.searchUserByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const currentUserId = req.user.id;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const trimmed = email.trim().toLowerCase();

    const user = await User.findOne({ email: trimmed }).select(
      "name email photo username isOnline lastSeen"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    // নিজেকে দেখানো বন্ধ
    if (user._id.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: "You cannot search yourself" });
    }

    const connection = await ConnectionSchema.findOne({
      $or: [
        { sender: currentUserId, receiver: user._id },
        { sender: user._id, receiver: currentUserId },
      ],
    });

    res.status(200).json({
      ...user.toObject(),
      profileImage: user.photo?.url || "",
      connectionStatus: connection?.status || null,
      connectionSender: connection?.sender?.toString() || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Updates user's profile. Accepts BOTH formats from frontend:
 *  - { name, bio, phone, profileImage: "url", coverImage: "url" }
 *  - { name, bio, phone, photo: { url, publicId }, coverPhoto: { url, publicId } }
 */
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone, bio, photo, coverPhoto, profileImage, coverImage } = req.body;
    const firebaseUid = req.user.firebaseUid;

    const updateData = {};
    if (typeof name === "string") updateData.name = name;
    if (typeof email === "string") updateData.email = email;
    if (typeof phone === "string") updateData.phone = phone;
    if (typeof bio === "string") updateData.bio = bio;

    if (typeof profileImage === "string") {
      updateData.photo = { url: profileImage, publicId: "" };
    } else if (photo?.url) {
      updateData.photo = { url: photo.url, publicId: photo.publicId || "" };
    }

    if (typeof coverImage === "string") {
      updateData.coverPhoto = { url: coverImage, publicId: "" };
    } else if (coverPhoto?.url) {
      updateData.coverPhoto = { url: coverPhoto.url, publicId: coverPhoto.publicId || "" };
    }

    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid },
      { $set: updateData },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("updateProfile error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Register/refresh user's FCM token for push notifications.
 */
exports.registerFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token required" });

    await User.findOneAndUpdate(
      { firebaseUid: req.user.firebaseUid },
      { $addToSet: { fcmTokens: token } }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.removeFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token required" });
    await User.findOneAndUpdate(
      { firebaseUid: req.user.firebaseUid },
      { $pull: { fcmTokens: token } }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};




// ─── Block / Unblock ────────────────────────────────────────────────────────

/**
 * Block a user. Blocked user cannot send messages to the blocker.
 */
exports.blockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;

    if (currentUserId.toString() === targetUserId.toString()) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const target = await User.findById(targetUserId);
    if (!target) return res.status(404).json({ message: "User not found" });

    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: targetUserId },
    });

    res.status(200).json({ message: "User blocked successfully", blocked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Unblock a user.
 */
exports.unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: targetUserId },
    });

    res.status(200).json({ message: "User unblocked successfully", blocked: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get block status between current user and a target user.
 * Returns: { blockedByMe, blockedByThem }
 */
exports.getBlockStatus = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;

    const currentUser = await User.findById(currentUserId).select("blockedUsers");
    const targetUser  = await User.findById(targetUserId).select("blockedUsers");

    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const blockedByMe   = currentUser.blockedUsers.some(
      (id) => id.toString() === targetUserId.toString()
    );
    const blockedByThem = targetUser.blockedUsers.some(
      (id) => id.toString() === currentUserId.toString()
    );

    res.status(200).json({ blockedByMe, blockedByThem });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};