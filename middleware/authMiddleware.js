const admin = require("../config/firebase");
const User = require("../models/userSchema");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const firebaseUid = decoded.uid;

    let user = await User.findOne({ firebaseUid });

    if (!user) {
      // ✅ username যোগ করা হয়েছে
      user = await User.create({
        name:        decoded.name         || "No Name",
        username:    decoded.email?.split("@")[0] || firebaseUid, // ✅ email থেকে username বানাচ্ছি
        email:       decoded.email        || "",
        firebaseUid: firebaseUid,
      })
    }

    req.user = {
      id:          user._id,
      firebaseUid: firebaseUid,
    }

    next()

  } catch (error) {
    console.log("Auth Error:", error.message) // ✅ পুরো error এর বদলে শুধু message
    res.status(401).json({ message: "Unauthorized" })
  }
}

module.exports = authMiddleware