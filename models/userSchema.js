const { Schema, model } = require("mongoose");

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: "" },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    bio: { type: String, default: "" },

    firebaseUid: {
      type: String,
      required: true,
      unique: true,
    },

    photo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    coverPhoto: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    // FCM tokens for push notifications (multi-device)
    fcmTokens: { type: [String], default: [] },

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Number, default: null },

    // Block system
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtuals so frontend can use simple keys
userSchema.virtual("profileImage").get(function () {
  return this.photo?.url || "";
});
userSchema.virtual("coverImage").get(function () {
  return this.coverPhoto?.url || "";
});

const User = model("User", userSchema);

module.exports = User;