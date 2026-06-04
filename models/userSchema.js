const { Schema, model } = require("mongoose");
const bcrypt = require("bcryptjs");

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

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    bio: { type: String, default: "" },

    photo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    coverPhoto: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    fcmTokens: { type: [String], default: [] },

    // Email verification
    isEmailVerified: { type: Boolean, default: false },
    emailOtp: { type: String, default: null },
    emailOtpExpires: { type: Date, default: null },

    // ✅ Password reset via OTP (নতুন — আগের token system replace হয়েছে)
    passwordResetOtp: { type: String, default: null },           // 6-digit OTP
    passwordResetOtpExpires: { type: Date, default: null },      // 10 মিনিট
    passwordResetSessionToken: { type: String, default: null },  // OTP verify এর পরে দেওয়া token
    passwordResetSessionExpires: { type: Date, default: null },  // 15 মিনিট

    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Number, default: null },

    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],

    refreshTokens: [String],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual("profileImage").get(function () {
  return this.photo?.url || "";
});
userSchema.virtual("coverImage").get(function () {
  return this.coverPhoto?.url || "";
});

const User = model("User", userSchema);

module.exports = User;