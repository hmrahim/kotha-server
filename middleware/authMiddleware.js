const jwt = require("jsonwebtoken");
const User = require("../models/userSchema");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    
    // ✅ JWT verification (Firebase remove করেছি)
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || "your_access_secret_key"
    );

    // ✅ User খুঁজুন MongoDB থেকে
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
    };

    next();

  } catch (error) {
    console.log("Auth Error:", error.message);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    res.status(401).json({ message: "Unauthorized" });
  }
};

module.exports = authMiddleware;