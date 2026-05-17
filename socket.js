// socket.js
const User = require('./models/userSchema')

let io

// ✅ Online users map — userId => Set of socketIds (multi-device support)
const onlineUsers = new Map()

const addOnlineUser = (userId, socketId) => {
  if (!userId) return
  const key = userId.toString()
  if (!onlineUsers.has(key)) onlineUsers.set(key, new Set())
  onlineUsers.get(key).add(socketId)
}

const removeOnlineUser = (userId, socketId) => {
  if (!userId) return false
  const key = userId.toString()
  const set = onlineUsers.get(key)
  if (!set) return false
  set.delete(socketId)
  if (set.size === 0) {
    onlineUsers.delete(key)
    return true // fully offline
  }
  return false
}

const isUserOnline = (userId) => {
  if (!userId) return false
  return onlineUsers.has(userId.toString())
}

const initSocket = (server) => {
  const { Server } = require('socket.io')
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  io.on('connection', async (socket) => {
    const userId = socket.handshake.auth.userId
    console.log('🔌 Socket connected:', socket.id, '| userId:', userId)

    if (userId) {
      socket.join(userId.toString())
      addOnlineUser(userId, socket.id)

      try {
        await User.findByIdAndUpdate(userId, { isOnline: true })
      } catch (e) { console.log('online update err:', e.message) }

      socket.broadcast.emit('user_online', { userId: userId.toString() })
      console.log(`🟢 User ${userId} ONLINE`)
    }

    socket.on('join_room', (roomId) => {
      if (!roomId) return
      socket.join(roomId.toString())
    })

    socket.on('leave_room', (roomId) => {
      if (!roomId) return
      socket.leave(roomId.toString())
    })

    socket.on('check_online', (targetUserId, cb) => {
      if (typeof cb === 'function') cb({ online: isUserOnline(targetUserId) })
    })

    require('./controller/socketController')(io, socket, { isUserOnline })

    socket.on('disconnect', async () => {
      console.log('❌ Socket disconnected:', socket.id)
      if (userId) {
        const fullyOffline = removeOnlineUser(userId, socket.id)
        if (fullyOffline) {
          const lastSeen = Date.now()
          try {
            await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen })
          } catch (e) { console.log('offline update err:', e.message) }

          socket.broadcast.emit('user_offline', {
            userId: userId.toString(),
            lastSeen,
          })
          console.log(`🔴 User ${userId} OFFLINE`)
        }
      }
    })
  })

  return io
}

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized')
  return io
}

module.exports = { initSocket, getIO, isUserOnline }