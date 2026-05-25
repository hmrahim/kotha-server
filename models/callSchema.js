const { Schema, model, Types } = require('mongoose')

const callSchema = new Schema(
  {
    callerId:        { type: Types.ObjectId, ref: 'User', required: true, index: true },
    calleeId:        { type: Types.ObjectId, ref: 'User', required: true, index: true },
    channelName:     { type: String, required: true, unique: true },
    type:            { type: String, enum: ['voice', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'rejected', 'canceled', 'busy', 'ended', 'timeout', 'failed', 'missed'],
      default: 'ringing',
    },
    startedAt:       { type: Date, default: Date.now },
    acceptedAt:      { type: Date, default: null },
    endedAt:         { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
)

callSchema.index({ callerId: 1, createdAt: -1 })
callSchema.index({ calleeId: 1, createdAt: -1 })

module.exports = model('Call', callSchema)