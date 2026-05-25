
const Call = require('../models/callSchema')
const User = require('../models/userSchema')
const { sendPushToUser } = require('../services/fcm')

const RING_TIMEOUT_MS = 35_000
const activeTimeouts = new Map()

// ─── WebRTC readiness tracking per call ───────────────────────────────────────
// callId => { caller: boolean, callee: boolean, buffer: [{event, payload, from}] }
const webrtcReady = new Map()

const ensureBucket = (callId) => {
  const key = callId.toString()
  if (!webrtcReady.has(key)) {
    webrtcReady.set(key, { caller: false, callee: false, buffer: [] })
  }
  return webrtcReady.get(key)
}

const clearWebrtcBucket = (callId) => {
  webrtcReady.delete(callId.toString())
}

const clearCallTimeout = (callId) => {
  const t = activeTimeouts.get(callId.toString())
  if (t) { clearTimeout(t); activeTimeouts.delete(callId.toString()) }
}

const emitCallHistory = (io, call) => {
  const item = {
    _id: call._id.toString(),
    itemType: 'call',
    type: call.type,
    status: call.status,
    durationSeconds: call.durationSeconds || 0,
    startedAt: call.startedAt,
    createdAt: call.createdAt || call.startedAt,
    callerId: call.callerId.toString(),
    calleeId: call.calleeId.toString(),
    senderId: call.callerId.toString(),
  }
  io.to(call.callerId.toString()).emit('call:new_history', item)
  io.to(call.calleeId.toString()).emit('call:new_history', item)
}

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
        if (!isCallerDisconnect) continue
        clearCallTimeout(call._id)
        clearWebrtcBucket(call._id)
        call.status = 'canceled'
        call.endedAt = endedAt
        await call.save()
        io.to(call.callerId.toString()).emit('call:canceled', { callId: call._id.toString() })
        io.to(call.calleeId.toString()).emit('call:canceled', { callId: call._id.toString() })
        emitCallHistory(io, call)
      } else {
        clearCallTimeout(call._id)
        clearWebrtcBucket(call._id)
        call.status = 'ended'
        call.endedAt = endedAt
        if (call.acceptedAt) {
          call.durationSeconds = Math.max(0, Math.floor((endedAt - call.acceptedAt) / 1000))
        }
        await call.save()
        io.to(call.callerId.toString()).emit('call:ended', {
          callId: call._id.toString(),
          durationSeconds: call.durationSeconds,
        })
        io.to(call.calleeId.toString()).emit('call:ended', {
          callId: call._id.toString(),
          durationSeconds: call.durationSeconds,
        })
        emitCallHistory(io, call)
      }
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

      const roomId = `call_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

      const call = await Call.create({
        callerId,
        calleeId: receiverId,
        type,
        status: 'ringing',
        channelName: roomId,
        startedAt: new Date(),
      })

      // Initialize webrtc bucket for this call
      ensureBucket(call._id)

      io.to(receiverId.toString()).emit('call:incoming', {
        callId: call._id.toString(),
        callerId: callerId.toString(),
        callerName: caller.name,
        callerAvatar: caller.photo?.url || '',
        type,
        roomId,
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
          roomId,
        },
      })

      const t = setTimeout(async () => {
        activeTimeouts.delete(call._id.toString())
        const fresh = await Call.findById(call._id)
        if (fresh && fresh.status === 'ringing') {
          fresh.status = 'missed'
          fresh.endedAt = new Date()
          await fresh.save()
          clearWebrtcBucket(fresh._id)
          io.to(callerId.toString()).emit('call:timeout', { callId: call._id.toString() })
          io.to(receiverId.toString()).emit('call:timeout', { callId: call._id.toString() })
          emitCallHistory(io, fresh)
        }
      }, RING_TIMEOUT_MS)
      activeTimeouts.set(call._id.toString(), t)

      return cb?.({
        ok: true,
        callId: call._id.toString(),
        roomId,
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

      if (call.status === 'ringing') {
        call.status = 'accepted'
        call.acceptedAt = new Date()
        await call.save()
      } else if (call.status === 'accepted' && !call.acceptedAt) {
        call.acceptedAt = new Date()
        await call.save()
      }

      const caller = await User.findById(call.callerId).select('name photo')

      io.to(call.callerId.toString()).emit('call:accepted', {
        callId: call._id.toString(),
        roomId: call.channelName,
        type: call.type,
      })

      return cb?.({
        ok: true,
        callId: call._id.toString(),
        roomId: call.channelName,
        type: call.type,
        caller: {
          _id: call.callerId.toString(),
          name: caller?.name || 'User',
          avatar: caller?.photo?.url || '',
        },
      })
    } catch (err) {
      console.error('call:accept error', err)
      return cb?.({ ok: false, error: err.message })
    }
  })

  // ─── WebRTC: both sides emit when their PC is ready ──────────────────────
  // ✅ FIX: Race-condition free signaling.
  // Both caller and callee notify server when their RTCPeerConnection + media is ready.
  // Server waits for BOTH then tells the caller to make the offer.
  // Any buffered offer/answer/ice from earlier is flushed to the appropriate side.
  socket.on('webrtc:ready', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Call not found' })

      const isCaller = call.callerId.toString() === myUserId.toString()
      const isCallee = call.calleeId.toString() === myUserId.toString()
      if (!isCaller && !isCallee) return cb?.({ ok: false, error: 'Not your call' })

      const bucket = ensureBucket(callId)
      if (isCaller) bucket.caller = true
      if (isCallee) bucket.callee = true

      console.log(`[WebRTC] ready — call ${callId} caller:${bucket.caller} callee:${bucket.callee}`)

      // If BOTH ready → tell caller to send the offer
      if (bucket.caller && bucket.callee) {
        io.to(call.callerId.toString()).emit('webrtc:start_offer', { callId: call._id.toString() })

        // Flush any buffered signals
        if (bucket.buffer.length > 0) {
          for (const { event, payload, toCaller } of bucket.buffer) {
            const targetId = toCaller ? call.callerId.toString() : call.calleeId.toString()
            io.to(targetId).emit(event, payload)
          }
          bucket.buffer = []
        }
      }

      return cb?.({ ok: true })
    } catch (err) {
      console.error('webrtc:ready error', err)
      return cb?.({ ok: false, error: err.message })
    }
  })

  // ─── Offer/Answer/ICE — with buffering if peer not ready ─────────────────
  const relayOrBuffer = async ({ callId, event, payload }) => {
    const call = await Call.findById(callId)
    if (!call) return { ok: false, error: 'Call not found' }

    const isCaller = call.callerId.toString() === myUserId.toString()
    const targetId = isCaller ? call.calleeId.toString() : call.callerId.toString()
    const toCaller = !isCaller

    const bucket = ensureBucket(callId)
    const peerReady = toCaller ? bucket.caller : bucket.callee

    if (peerReady) {
      io.to(targetId).emit(event, payload)
    } else {
      bucket.buffer.push({ event, payload, toCaller })
      console.log(`[WebRTC] buffered ${event} for call ${callId} (peer not ready)`)
    }
    return { ok: true }
  }

  socket.on('webrtc:offer', async ({ callId, offer }, cb) => {
    try {
      const r = await relayOrBuffer({ callId, event: 'webrtc:offer', payload: { callId, offer } })
      return cb?.(r)
    } catch (err) { return cb?.({ ok: false, error: err.message }) }
  })

  socket.on('webrtc:answer', async ({ callId, answer }, cb) => {
    try {
      const r = await relayOrBuffer({ callId, event: 'webrtc:answer', payload: { callId, answer } })
      return cb?.(r)
    } catch (err) { return cb?.({ ok: false, error: err.message }) }
  })

  socket.on('webrtc:ice-candidate', async ({ callId, candidate }, cb) => {
    try {
      const r = await relayOrBuffer({ callId, event: 'webrtc:ice-candidate', payload: { callId, candidate } })
      return cb?.(r)
    } catch (err) { return cb?.({ ok: false }) }
  })

  // ─── Callee rejects ───────────────────────────────────────────────────────
  socket.on('call:reject', async ({ callId }, cb) => {
    try {
      const call = await Call.findById(callId)
      if (!call) return cb?.({ ok: false, error: 'Not found' })
      if (call.status !== 'ringing') return cb?.({ ok: false, error: 'Already ended' })

      clearCallTimeout(callId)
      clearWebrtcBucket(callId)
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
      clearWebrtcBucket(callId)
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
      clearWebrtcBucket(callId)
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
