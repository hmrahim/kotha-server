const crypto = require("crypto");
const { sendVerificationEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail } = require("../services/emailService");
const ConnectionSchema = require("../models/connection");
const User = require("../models/userSchema");
const jwt = require("jsonwebtoken");

const generateAccessToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_ACCESS_SECRET || "your_access_secret_key",
    { expiresIn: "15m" }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET || "your_refresh_secret_key",
    { expiresIn: "7d" }
  );
};

exports.signup = async (req, res) => {
  console.log(req.body);
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }
    let base = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "_");
    if (!base) base = email.split("@")[0];
    let username = base;
    let exists = await User.findOne({ username });
    let count = 1;
    while (exists) {
      username = `${base}_${count}`;
      exists = await User.findOne({ username });
      count++;
    }

    const emailOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      username,
      phone: phone || "",
      emailOtp,
      emailOtpExpires,
      isEmailVerified: false,
    });
    await user.save();

    try {
      await sendVerificationEmail(user.email, user.name, emailOtp);
      console.log("OTP email sent to:", user.email);
    } catch (err) {
      console.error("Email send error:", err);
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.status(201).json({
      message: "Signup successful. Please check your email for the OTP to verify your account.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isEmailVerified: false,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const validTokens = [];
    for (const rt of user.refreshTokens) {
      try {
        jwt.verify(rt, process.env.JWT_REFRESH_SECRET || "your_refresh_secret_key");
        validTokens.push(rt);
      } catch {
        // expired — skip
      }
    }
    user.refreshTokens = validTokens;
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push(refreshToken);
    await user.save();
    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isEmailVerified: user.isEmailVerified,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || "your_refresh_secret_key");
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }
    const user = await User.findById(decoded.userId);
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push(newRefreshToken);
    await user.save();
    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.json({ message: "Logged out" });
    }
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || "your_refresh_secret_key");
    } catch {
      return res.json({ message: "Logged out" });
    }
    await User.findByIdAndUpdate(decoded.userId, {
      $pull: { refreshTokens: refreshToken },
    });
    res.json({ message: "Logout successful" });
  } catch (error) {
    res.json({ message: "Logged out" });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both passwords are required" });
    }
    const user = await User.findById(req.user.id);
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    user.password = newPassword;
    user.refreshTokens = [];
    await user.save();
    res.json({ message: "Password changed successfully. Please login again." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.userPostController = async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(200).json(existingUser);
    res.status(400).json({ error: "User must signup first" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUser = async (req, res) => {
  const userId = req.user.id;
  try {
    const users = await User.find({ _id: { $ne: userId } });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCurrentUser = async (req, res) => {
  const userId = req.user.id;
  try {
    const user = await User.findById(userId);
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

exports.searchUserByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const currentUserId = req.user.id;
    if (!email) return res.status(400).json({ message: "Email is required" });
    const trimmed = email.trim().toLowerCase();
    const user = await User.findOne({ email: trimmed }).select("name email photo username isOnline lastSeen");
    if (!user) return res.status(404).json({ message: "User not found" });
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

exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone, bio, photo, coverPhoto, profileImage, coverImage } = req.body;
    const userId = req.user.id;
    const updateData = {};
    if (typeof name === "string") updateData.name = name;
    if (typeof email === "string") updateData.email = email.toLowerCase();
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
    const updatedUser = await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true });
    if (!updatedUser) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    console.error("updateProfile error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.registerFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token required" });
    await User.findByIdAndUpdate(req.user.id, { $addToSet: { fcmTokens: token } });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.removeFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token required" });
    await User.findByIdAndUpdate(req.user.id, { $pull: { fcmTokens: token } });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;
    if (currentUserId.toString() === targetUserId.toString()) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }
    const target = await User.findById(targetUserId);
    if (!target) return res.status(404).json({ message: "User not found" });
    await User.findByIdAndUpdate(currentUserId, { $addToSet: { blockedUsers: targetUserId } });
    res.status(200).json({ message: "User blocked successfully", blocked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;
    await User.findByIdAndUpdate(currentUserId, { $pull: { blockedUsers: targetUserId } });
    res.status(200).json({ message: "User unblocked successfully", blocked: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getBlockStatus = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUserId } = req.params;
    const currentUser = await User.findById(currentUserId).select("blockedUsers");
    const targetUser = await User.findById(targetUserId).select("blockedUsers");
    if (!targetUser) return res.status(404).json({ message: "User not found" });
    const blockedByMe = currentUser.blockedUsers.some((id) => id.toString() === targetUserId.toString());
    const blockedByThem = targetUser.blockedUsers.some((id) => id.toString() === currentUserId.toString());
    res.status(200).json({ blockedByMe, blockedByThem });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ✅ FIX: OTP string হিসেবে compare করা হচ্ছে
exports.verifyEmail = async (req, res) => {
  try {
    const { otp, userId } = req.body;
    if (!otp || !userId) {
      return res.status(400).json({ error: "OTP and userId are required" });
    }
    const otpString = String(otp).trim();
    const user = await User.findOne({
      _id: userId,
      emailOtp: otpString,
      emailOtpExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }
    user.isEmailVerified = true;
    user.emailOtp = null;
    user.emailOtpExpires = null;
    await user.save();
    res.json({ message: "Email verified successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ FIX: findByIdAndUpdate দিয়ে atomic update — password pre-save hook trigger হবে না
exports.resendVerificationEmail = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.isEmailVerified) {
      return res.status(400).json({ error: "Email is already verified" });
    }
    if (user.emailOtpExpires) {
      const timeLeft = user.emailOtpExpires - Date.now();
      const eightMinMs = 8 * 60 * 1000;
      if (timeLeft > eightMinMs) {
        const waitSec = Math.ceil((timeLeft - eightMinMs) / 1000);
        return res.status(429).json({ error: `Please wait ${waitSec} seconds before requesting again` });
      }
    }
    const emailOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const emailOtpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await User.findByIdAndUpdate(req.user.id, {
      $set: { emailOtp, emailOtpExpires },
    });

    try {
      await sendVerificationEmail(user.email, user.name, emailOtp);
      console.log("OTP resent to:", user.email);
    } catch (err) {
      console.error("Email send error:", err);
      return res.status(500).json({ error: "Email পাঠানো যায়নি। আবার চেষ্টা করো।" });
    }
    res.json({ message: "OTP sent. Please check your inbox." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};










exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
 
    const user = await User.findOne({ email: email.toLowerCase() });
 
    // Security: user না থাকলেও একই message দাও (enumeration prevent)
    if (!user) {
      return res.json({ message: "If that email exists, a reset OTP has been sent." });
    }
 
    // Rate limit: আগের OTP এখনো 8 মিনিটের বেশি valid থাকলে আবার পাঠাবো না
    if (user.passwordResetOtpExpires) {
      const timeLeft = user.passwordResetOtpExpires - Date.now();
      if (timeLeft > 8 * 60 * 1000) {
        const waitSec = Math.ceil((timeLeft - 8 * 60 * 1000) / 1000);
        return res.status(429).json({ error: `Please wait ${waitSec} seconds before requesting again` });
      }
    }
 
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 মিনিট
 
    // findByIdAndUpdate দিয়ে করি — password pre-save hook trigger হবে না
    await User.findByIdAndUpdate(user._id, {
      $set: {
        passwordResetOtp: otp,
        passwordResetOtpExpires: otpExpires,
        passwordResetSessionToken: null,
        passwordResetSessionExpires: null,
      },
    });
 
    // Email পাঠাও (fire and forget — error হলেও response block হবে না)
    sendPasswordResetOtpEmail(user.email, user.name, otp).catch((err) =>
      console.error("Reset OTP email error:", err.message)
    );
 
    res.json({ message: "If that email exists, a reset OTP has been sent." });
  } catch (error) {
    console.error("forgotPassword error:", error);
    res.status(500).json({ error: error.message });
  }
};
 
// STEP 2 — OTP verify করো, session token দাও
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }
 
    const user = await User.findOne({
      email: email.toLowerCase(),
      passwordResetOtp: String(otp).trim(),
      passwordResetOtpExpires: { $gt: new Date() },
    });
 
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }
 
    // OTP সঠিক — এখন একটা short-lived session token দাও
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 মিনিট
 
    await User.findByIdAndUpdate(user._id, {
      $set: {
        passwordResetOtp: null,
        passwordResetOtpExpires: null,
        passwordResetSessionToken: sessionToken,
        passwordResetSessionExpires: sessionExpires,
      },
    });
 
    res.json({
      message: "OTP verified. You can now reset your password.",
      resetSessionToken: sessionToken,
    });
  } catch (error) {
    console.error("verifyResetOtp error:", error);
    res.status(500).json({ error: error.message });
  }
};
 
// STEP 3 — নতুন password set করো
exports.resetPassword = async (req, res) => {
  try {
    const { resetSessionToken, newPassword } = req.body;
 
    if (!resetSessionToken) {
      return res.status(400).json({ error: "Reset session token is required" });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
 
    const user = await User.findOne({
      passwordResetSessionToken: resetSessionToken,
      passwordResetSessionExpires: { $gt: new Date() },
    });
 
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset session. Please start over." });
    }
 
    // password set করো — pre-save hook hash করবে
    user.password = newPassword;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
    user.passwordResetSessionToken = null;
    user.passwordResetSessionExpires = null;
    user.refreshTokens = []; // সব device থেকে logout
    await user.save();
 
    res.json({ message: "Password reset successful. Please log in." });
  } catch (error) {
    console.error("resetPassword error:", error);
    res.status(500).json({ error: error.message });
  }
};