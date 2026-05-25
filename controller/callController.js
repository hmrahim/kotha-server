const Call = require('../models/callSchema')
const User = require('../models/userSchema')

// GET /api/calls/history?page=1&limit=30
const getCallHistory = async (req, res) => {
  try {
    const myId  = req.user.id
    const page  = parseInt(req.query.page  || '1',  10)
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100)
    const skip  = (page - 1) * limit

    const calls = await Call.find({
      $or: [{ callerId: myId }, { calleeId: myId }],
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('callerId', 'name photo username')
      .populate('calleeId', 'name photo username')
      .lean()

    const formatted = calls.map((c) => {
      const isOutgoing = c.callerId._id.toString() === myId.toString()
      const other      = isOutgoing ? c.calleeId : c.callerId
      return {
        _id:             c._id,
        type:            c.type,
        status:          c.status,
        isOutgoing,
        durationSeconds: c.durationSeconds || 0,
        startedAt:       c.startedAt,
        endedAt:         c.endedAt,
        createdAt:       c.createdAt,
        other: {
          _id:      other?._id,
          name:     other?.name,
          username: other?.username,
          photo:    other?.photo?.url || '',
        },
      }
    })

    return res.json({ data: formatted, page, limit })
  } catch (err) {
    console.log('getCallHistory error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// GET /api/calls/between/:otherId
const getCallsBetween = async (req, res) => {
  try {
    const myId    = req.user.id
    const { otherId } = req.params
    if (!otherId) return res.status(400).json({ error: 'otherId required' })

    const calls = await Call.find({
      $or: [
        { callerId: myId,    calleeId: otherId },
        { callerId: otherId, calleeId: myId    },
      ],
      status: { $in: ['ended', 'missed', 'rejected', 'canceled', 'timeout'] },
    })
      .sort({ createdAt: 1 })
      .lean()

    const formatted = calls.map((c) => {
      const isOutgoing = c.callerId.toString() === myId.toString()
      return {
        _id:             c._id.toString(),
        itemType:        'call',
        type:            c.type,
        status:          c.status,
        isOutgoing,
        durationSeconds: c.durationSeconds || 0,
        startedAt:       c.startedAt,
        createdAt:       c.createdAt,
        senderId:        c.callerId.toString(),
      }
    })

    return res.json({ data: formatted })
  } catch (err) {
    console.log('getCallsBetween error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// DELETE /api/calls/history/:id
const deleteCallEntry = async (req, res) => {
  try {
    const myId    = req.user.id
    const { id }  = req.params
    const call    = await Call.findById(id)
    if (!call) return res.status(404).json({ error: 'Not found' })
    if (
      call.callerId.toString() !== myId.toString() &&
      call.calleeId.toString() !== myId.toString()
    ) return res.status(403).json({ error: 'Forbidden' })

    await Call.findByIdAndDelete(id)
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

// POST /api/calls/:callId/reject  (background decline — no auth)
const rejectCallById = async (req, res) => {
  try {
    const { callId } = req.params
    if (!callId) return res.status(400).json({ error: 'callId required' })

    const call = await Call.findById(callId)
    if (!call) return res.status(404).json({ error: 'Call not found' })

    if (call.status !== 'ringing') {
      return res.json({ ok: true, already: call.status })
    }

    call.status  = 'rejected'
    call.endedAt = new Date()
    await call.save()

    try {
      const { getIO } = require('../socket')
      const io        = getIO()

      io.to(call.callerId.toString()).emit('call:rejected', { callId: call._id.toString() })
      io.to(call.calleeId.toString()).emit('call:rejected', { callId: call._id.toString() })

      const historyItem = {
        _id:             call._id.toString(),
        itemType:        'call',
        type:            call.type,
        status:          'rejected',
        durationSeconds: 0,
        startedAt:       call.startedAt,
        createdAt:       call.createdAt || call.startedAt,
        callerId:        call.callerId.toString(),
        calleeId:        call.calleeId.toString(),
        senderId:        call.callerId.toString(),
      }
      io.to(call.callerId.toString()).emit('call:new_history', historyItem)
      io.to(call.calleeId.toString()).emit('call:new_history', historyItem)

      console.log(`📵 Call ${callId} rejected via HTTP`)
    } catch (socketErr) {
      console.warn('rejectCallById socket error:', socketErr?.message)
    }

    return res.json({ ok: true })
  } catch (err) {
    console.log('rejectCallById error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

module.exports = { getCallHistory, getCallsBetween, deleteCallEntry, rejectCallById }