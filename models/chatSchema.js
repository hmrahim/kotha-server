const mongoose = require("mongoose");
require("./userSchema");

const chatSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: { type: String, default: "" },
    lastMessageType: { type: String, default: "text" }, // text | image | video | audio | voice | document | location | contact
    lastSenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastMessageAt: { type: Date, default: () => new Date() },
    // nicknames: { [userId]: "nickname string" }
    // key = যার nickname, value = সেই nickname
    nicknames: {
      type: Map,
      of: String,
      default: {},
    },
    // hiddenFor: যে userId গুলো এই chat hide করেছে
    // নতুন message আসলে sender কে এখান থেকে remove করা হয় (chat reappear করে)
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    chatBackground: {
      // NOTE: 'bgType' instead of 'type' — mongoose treats 'type' as schema type declaration
      // which causes the field to NOT save correctly to MongoDB
      bgType: { type: String, enum: ['default', 'solid', 'gradient', 'image', 'animated_hearts', 'animated_stars', 'animated_aurora', 'animated_petals', 'animated_confetti', 'animated_fireflies', 'animated_snow', 'animated_sparkles', 'animated_bubbles', 'animated_waves'], default: 'default' },
      value:  { type: String, default: null }, // color / gradient JSON string / image URL
      presetId: { type: String, default: 'default' }, // preset id for client-side lookup
    },
  },
  { timestamps: true }
);

chatSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Chat", chatSchema);