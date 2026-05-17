
const Call = require('../models/callSchema')
const User = require('../models/userSchema')
const { generateRtcToken, AGORA_APP_ID } = require('../services/agoraService')

// POST /api/agora/token  body: { channelName, uid, role? }



const getAgoraToken = async (req, res) => {
    try {
        const { channelName, uid, role } = req.body
        if (!channelName || uid === undefined) {
            return res.status(400).json({ error: 'channelName and uid required' })
        }
        const data = generateRtcToken(channelName, uid, role)
        return res.json(data)
    } catch (err) {
        console.log('getAgoraToken error:', err.message)
        return res.status(500).json({ error: err.message })
    }
}

// GET /api/calls/history?page=1&limit=30
const getCallHistory = async (req, res) => {
    try {
        const myId = req.user.id
        const page = parseInt(req.query.page || '1', 10)
        const limit = Math.min(parseInt(req.query.limit || '30', 10), 100)
        const skip = (page - 1) * limit

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
            const other = isOutgoing ? c.calleeId : c.callerId
            return {
                _id: c._id,
                type: c.type,
                status: c.status,
                isOutgoing,
                durationSeconds: c.durationSeconds || 0,
                startedAt: c.startedAt,
                endedAt: c.endedAt,
                createdAt: c.createdAt,
                other: {
                    _id: other?._id,
                    name: other?.name,
                    username: other?.username,
                    photo: other?.photo?.url || '',
                },
            }
        })

        return res.json({ data: formatted, page, limit })
    } catch (err) {
        console.log('getCallHistory error:', err.message)
        return res.status(500).json({ error: err.message })
    }
}

// DELETE /api/calls/history/:id
const deleteCallEntry = async (req, res) => {
    try {
        const myId = req.user.id
        const { id } = req.params
        const call = await Call.findById(id)
        if (!call) return res.status(404).json({ error: 'Not found' })
        if (call.callerId.toString() !== myId.toString() && call.calleeId.toString() !== myId.toString()) {
            return res.status(403).json({ error: 'Forbidden' })
        }
        await Call.findByIdAndDelete(id)
        return res.json({ ok: true })
    } catch (err) {
        return res.status(500).json({ error: err.message })
    }
}

module.exports = { getAgoraToken, getCallHistory, deleteCallEntry, AGORA_APP_ID }
