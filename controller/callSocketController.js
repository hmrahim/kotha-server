// Socket.IO signaling for Agora voice/video calls
const Call = require('../models/callSchema')
const User = require('../models/userSchema')
const { generateRtcToken } = require('../services/agoraService')
const { sendPushToUser } = require('../services/fcm')

const RING_TIMEOUT_MS = 35_000
const activeTimeouts = new Map()

const clearCallTimeout = (callId) => {
  const t = activeTimeouts.get(callId.toString())
  if (t) { clearTimeout(t); activeTimeouts.delete(callId.toString()) }
}

// ─── Helper: call শেষ হলে দুইজনকেই call:new_history emit করো ────────────────
const emitCallHistory = (io, call) => {
  const item = {
    _id:             call._id.toString(),
    itemType:        'call',
    type:            call.type,
    status:          call.status,
    durationSeconds: call.durationSeconds || 0,
    startedAt:       call.startedAt,
    createdAt:       call.createdAt || call.startedAt,
    callerId:        call.callerId.toString(),
    calleeId:        call.calleeId.toString(),
    senderId:        call.callerId.toString(),
  }

  io.to(call.callerId.toString()).emit('call:new_history', item)
  io.to(call.calleeId.toString()).emit('call:new_history', item)
}

// ─── Stale call cleanup ───────────────────────────────────────────────────────
const cleanupStaleCallsForUser = async (userId, io) => {
  try {
    const staleCalls = await Call.find({
      $or: [{ callerId: userId }, { calleeId: userId }],
      status: { $in: ['ringing', 'accepted'] },
    })

    for (const call of staleCalls) {
      const endedAt = new Date()
      const isCallerDisconnect = call.callerId.toString() === userId.toString()

      if (call.status === 'ringing') {
        if (!isCallerDisconnect) {
          // ✅ KEY FIX: Callee disconnect হলে missed করা যাবে না।
          // FCM notification এখনো পৌঁছাতে পারে এবং user accept করতে পারে।
          if (!activeTimeouts.has(call._id.toString())) {
            const elapsed    = Date.now() - new Date(call.startedAt).getTime()
            const remaining  = Math.max(0, RING_TIMEOUT_MS - elapsed)

            if (remaining > 0) {
              const t = setTimeout(async () => {
                activeTimeouts.delete(call._id.toString())
                const fresh = await Call.findById(call._id)
                if (fresh && fresh.status === 'ringing') {
                  fresh.status  = 'missed'
                  fresh.endedAt = new Date()
                  await fresh.save()
                  io.to(fresh.callerId.toString()).emit('call:timeout', { callId: fresh._id.toString() })
                  io.to(fresh.calleeId.toString()).emit('call:timeout', { callId: fresh._id.toString() })
                  emitCallHistory(io, fresh)
                }
              }, remaining)
              activeTimeouts.set(call._id.toString(), t)
            } else {
              call.status  = 'missed'
              call.endedAt = endedAt
              await call.save()
              io.to(call.callerId.toString()).emit('call:timeout', { callId: call._id.toString() })
              io.to(call.calleeId.toString()).emit('call:timeout', { callId: call._id.toString() })
              emitCallHistory(io, call)
            }
          }
          continue
        }

        // Caller disconnect → canceled
        clearCallTimeout(call._id)
        call.status  = 'canceled'
        call.endedAt = endedAt
        await call.save()

        io.to(call.callerId.toString()).emit('call:canceled', { callId: call._id.toString() })
        io.to(call.calleeId.toString()).emit('call:canceled', { callId: call._id.toString() })
        emitCallHistory(io, call)

      } else {
        // Accepted call disconnect → ended
        clearCallTimeout(call._id)
        call.status  = 'ended'
        call.endedAt = endedAt
        if (call.acceptedAt) {
          call.durationSeconds = Math.max(0, Math.floor((endedAt - call.acceptedAt) / 1000))
        }
        await call.save()

        io.to(call.callerId.toString()).emit('call:ended', {
          callId:          call._id.toString(),
          durationSeconds: call.durationSeconds,
        })
        io.to(call.calleeId.toString()).emit('call:ended', {
          callId:          call._id.toString(),
          durationSeconds: call.durationSeconds,
        })
        emitCallHistory(io, call)
      }
    }

    if (staleCalls.length > 0) {
      console.log(`🧹 Cleaned ${staleCalls.length} stale call(s) for user ${userId}`)
    }
  } catch (err) {
    console.error('cleanupStaleCallsForUser error:', err.message)
  }
}

module.exports = (io, socket, { isUserOnline }) => {
  const myUserId = socket.handshake.auth.userId

  socket.on('disconnect', async () => {
    await cleanupStaleCallsForUser(myUserId, io)
  })

  // ─── Caller initiates ─────────────────────────────────────────────────────
  socket.on('call:initiate', async (payload, cb) => {
    try {
      const callerId = myUserId
      const { receiverId, type = 'voice' } = payload || {}
      if (!callerId || !receiverId) return cb?.({ ok: false, error: 'Missing ids' })
      if (!['voice', 'video'].includes(type)) return cb?.({ ok: false, error: 'Invalid type' })

      const [caller, callee] = await Promise.all([
        User.findById(callerId).select('name photo blockedUsers'),
        User.findById(receiverId).select('name photo blockedUsers fcmTokens isOnline'),
      ])
      if (!caller || !callee) return cb?.({ ok: false, error: 'User not found' })
      if (callee.blockedUsers?.some((id) => id.toString() === callerId.toString()))
        return cb?.({ ok: false, error: 'blocked' })
      if (caller.blockedUsers?.some((id) => id.toString() === receiverId.toString()))
        return cb?.({ ok: false, error: 'blocked_by_you' })

      // Stale cleanup
      const staleThreshold = new Date(Date.now() - 2 * 60 * 1000)
      await Call.updateMany(
        { $or: [{ calleeId: receiverId }, { callerId: receiverId }, { calleeId: callerId }, { callerId: callerId }], status: 'ringing', startedAt: { $lt: staleThreshold } },
        { $set: { status: 'missed', endedAt: new Date() } }
      )
      const acceptedStale = new Date(Date.now() - 10 * 60 * 1000)
      await Call.updateMany(
        { $or: [{ calleeId: receiverId }, { callerId: receiverId }, { calleeId: callerId }, { callerId: callerId }], status: 'accepted', acceptedAt: { $lt: acceptedStale } },
        { $set: { status: 'ended', endedAt: new Date() } }
      )

      const existing = await Call.findOne({ $or: [{ calleeId: receiverId }, { callerId: receiverId }], status: { $in: ['ringing', 'accepted'] } })
      if (existing) return cb?.({ ok: false, error: 'busy' })
      const callerBusy = await Call.findOne({ $or: [{ calleeId: callerId }, { callerId: callerId }], status: { $in: ['ringing', 'accepted'] } })
      if (callerBusy) return cb?.({ ok: false, error: 'caller_busy' })

      const agoraCallerUid = Math.floor(Math.random() * 1_000_000) + 1
      const agoraCalleeUid = Math.floor(Math.random() * 1_000_000) + 1_000_001
      const channelName = `call_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

      const call = await Call.create({
        callerId, calleeId: receiverId, type, status: 'ringing',
        channelName, agoraCallerUid, agoraCalleeUid, startedAt: new Date(),
      })

      const callerTok = generateRtcToken(channelName, agoraCallerUid)
      const calleeTok = generateRtcToken(channelName, agoraCalleeUid)

      io.to(receiverId.toString()).emit('call:incoming', {
        callId: call._id.toString(),
        callerId: callerId.toString(),
        callerName: caller.name,
        callerAvatar: caller.photo?.url || '',
        type,
        channelName,
        calleeToken: calleeTok.token,
        calleeUid: agoraCalleeUid,
        appId: calleeTok.appId,
      })

      sendPushToUser(receiverId, {
        title: caller.name || 'Incoming call',
        body: type === 'video' ? '📹 Incoming video call' : '📞 Incoming voice call',
        image: caller.photo?.url || '',
        data: {
          type: 'incoming_call',
          callId: call._id.toString(),
          callerId: callerId.toString(),
          callerName: caller.name || '',
          callerAvatar: caller.photo?.url || '',
          callType: type,
          channelName,
          calleeToken: calleeTok.token,
          calleeUid: String(agoraCalleeUid),
          appId: calleeTok.appId,
        },
      })

      // No-answer timeout → missed
      const t = setTimeout(async () => {
        activeTimeouts.delete(call._id.toString())
        const fresh = await Call.findById(call._id)
        if (fresh && fresh.status === 'ringing') {
          fresh.status = 'missed'
          fresh.endedAt = new Date()
          await fresh.save()
          io.to(callerId.toString()).emit('call:timeout', { callId: call._id.toString() })
          io.to(receiverId.toString()).emit('call:timeout', { callId: call._id.toString() })
          emitCallHistory(io, fresh)
        }
      }, RING_TIMEOUT_MS)
      activeTimeouts.set(call._id.toString(), t)

      return cb?.({
        ok: true,
        callId: call._id.toString(),
        channelName,
        token: callerTok.token,
        uid: agoraCallerUid,
        appId: callerTok.appId,
        type,
        callee: { _id: receiverId, name: callee.name, avatar: callee.photo?.url || '' },
      })
    } catch (err) {
      console.error('call:initiate error', err)
      return cb?.({ ok: false, error: err.message })
    }
  })

  // ─── Callee accepts ───────────────────────────────────────────────────────
  socket.on('call:accept', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Call not found' })
      if (!['ringing', 'accepted'].includes(call.status)) return cb?.({ ok: false, error: 'Call not ringing' })
      if (call.calleeId.toString() !== myUserId.toString()) return cb?.({ ok: false, error: 'Not your call' })

      clearCallTimeout(callId)

      // ✅ BUG FIX: acceptedAt null থাকলে duration সবসময় 0 হতো।
      // আগে: status === 'ringing' হলেই save হতো, 'accepted' হলে save হতো না।
      // এখন: যেকোনো ক্ষেত্রে acceptedAt null হলে set করো।
      if (call.status === 'ringing') {
        call.status     = 'accepted'
        call.acceptedAt = new Date()
        await call.save()
      } else if (call.status === 'accepted' && !call.acceptedAt) {
        call.acceptedAt = new Date()
        await call.save()
      }

      const calleeTok = generateRtcToken(call.channelName, call.agoraCalleeUid)
      const callerTok = generateRtcToken(call.channelName, call.agoraCallerUid)

      io.to(call.callerId.toString()).emit('call:accepted', {
        callId: call._id.toString(),
        channelName: call.channelName,
        type: call.type,
        token: callerTok.token,
        uid: call.agoraCallerUid,
        appId: callerTok.appId,
      })

      return cb?.({
        ok: true,
        callId: call._id.toString(),
        channelName: call.channelName,
        token: calleeTok.token,
        uid: call.agoraCalleeUid,
        appId: calleeTok.appId,
        type: call.type,
      })
    } catch (err) {
      console.error('call:accept error', err)
      return cb?.({ ok: false, error: err.message })
    }
  })

  // ─── Callee rejects ───────────────────────────────────────────────────────
  socket.on('call:reject', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Not found' })
      if (call.status !== 'ringing') return cb?.({ ok: false, error: 'Already ended' })

      clearCallTimeout(callId)
      call.status = 'rejected'
      call.endedAt = new Date()
      await call.save()

      io.to(call.callerId.toString()).emit('call:rejected', { callId: call._id.toString() })
      io.to(call.calleeId.toString()).emit('call:rejected', { callId: call._id.toString() })
      cb?.({ ok: true })

      emitCallHistory(io, call)
    } catch (err) { cb?.({ ok: false, error: err.message }) }
  })

  // ─── Caller cancels ───────────────────────────────────────────────────────
  socket.on('call:cancel', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Not found' })
      if (!['ringing'].includes(call.status)) return cb?.({ ok: false, error: 'Cannot cancel' })

      clearCallTimeout(callId)
      call.status = 'canceled'
      call.endedAt = new Date()
      await call.save()

      io.to(call.callerId.toString()).emit('call:canceled', { callId: call._id.toString() })
      io.to(call.calleeId.toString()).emit('call:canceled', { callId: call._id.toString() })
      cb?.({ ok: true })

      emitCallHistory(io, call)
    } catch (err) { cb?.({ ok: false, error: err.message }) }
  })

  // ─── Either party ends ────────────────────────────────────────────────────
  socket.on('call:end', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Not found' })
      if (!['accepted', 'ringing'].includes(call.status)) return cb?.({ ok: true })

      clearCallTimeout(callId)
      const endedAt = new Date()
      const durationSeconds = call.acceptedAt
        ? Math.max(0, Math.floor((endedAt - call.acceptedAt) / 1000))
        : 0
      call.status = 'ended'
      call.endedAt = endedAt
      call.durationSeconds = durationSeconds
      await call.save()

      io.to(call.callerId.toString()).emit('call:ended', { callId: call._id.toString(), durationSeconds })
      io.to(call.calleeId.toString()).emit('call:ended', { callId: call._id.toString(), durationSeconds })
      cb?.({ ok: true, durationSeconds })

      emitCallHistory(io, call)
    } catch (err) { cb?.({ ok: false, error: err.message }) }
  })
}