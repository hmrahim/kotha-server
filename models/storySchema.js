const mongoose = require("mongoose");
require("./userSchema");

// Each media item inside a story
const storyMediaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "text"],
      required: true,
    },
    url: { type: String, default: "" },          // cloudinary url for image/video
    public_id: { type: String, default: "" },
    thumb: { type: String, default: "" },         // video thumbnail
    duration: { type: Number, default: null },    // video duration in seconds
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    // text story fields
    text: { type: String, default: "" },
    textColor: { type: String, default: "#FFFFFF" },
    bgColor: { type: String, default: "#2DD4BF" },
    fontSize: { type: Number, default: 24 },
  },
  { _id: true }
);

// A story is one upload (can have multiple media items like FB)
const storySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: [storyMediaSchema],
    // who viewed this story
    views: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        viewedAt: { type: Date, default: () => new Date() },
      },
    ],
    // replies to this story (go as direct messages)
    replies: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, default: "" },
        repliedAt: { type: Date, default: () => new Date() },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      index: { expireAfterSeconds: 0 }, // MongoDB TTL auto-delete
    },
  },
  { timestamps: true }
);

storySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Story", storySchema);