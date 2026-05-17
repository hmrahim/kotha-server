const mongoose = require("mongoose");
require("./chatSchema");
require("./userSchema");

const mediaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "audio", "voice", "document", "location", "contact"],
      required: true,
    },
    url: String,
    public_id: String,
    thumb: String,
    mime: String,
    size: Number,
    width: Number,
    height: Number,

    duration: Number,
    waveform: [Number],

    fileName: String,
    fileSize: String,

    lat: Number,
    lng: Number,
    address: String,
    name: String,

    contactName: String,
    contactPhone: String,
    contactEmail: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, default: "" },
    media: [mediaSchema],
    seen: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
    deletedFor: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] },
    ],
    isDeleted: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    isForwarded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ chatId: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
