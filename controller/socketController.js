const chatSchema = require('../models/chatSchema')
const messageSchema = require('../models/messageSchema')
const User = require('../models/userSchema')
const { sendPushToUser } = require('../services/fcm')
const { ensureConnection } = require('./chatController')

const previewFromMedia = (text, media) => {
  if (text && text.trim()) return text.trim()
  if (!media || media.length === 0) return ''
  const first = media[0]
  switch (first.type) {
    case 'image':    return '📷 Photo'
    case 'video':    return '🎥 Video'
    case 'audio':    return '🎵 Audio'
    case 'voice':    return '🎙️ Voice message'
    case 'document': return `📄 ${first.fileName || 'Document'}`
    case 'location': return '📍 Location'
    case 'contact':  return `👤 ${first.contactName || 'Contact'}`
    default:         return '📎 Attachment'
  }
}

const typeFromMedia = (text, media) => {
  if (text && text.trim()) return 'text'
  if (!media || media.length === 0) return 'text'
  return media[0].type || 'text'
}

module.exports = (io, socket, { isUserOnline }) => {
  const myUserId = socket.handshake.auth.userId

  // ─── Typing ──────────────────────────────────────────────────────────────
  socket.on('typing', ({ chatId, userId, receiverId }) => {
    const fromUser = (userId || myUserId)?.toString()
    if (!fromUser) return
    if (receiverId) {
      io.to(receiverId.toString()).emit('typing', { chatId, userId: fromUser })
    }
    if (chatId) {
      socket.to(chatId.toString()).emit('typing', { chatId, userId: fromUser })
    }
  })

  socket.on('stop_typing', ({ chatId, userId, receiverId }) => {
    const fromUser = (userId || myUserId)?.toString()
    if (!fromUser) return
    if (receiverId) {
      io.to(receiverId.toString()).emit('stop_typing', { chatId, userId: fromUser })
    }
    if (chatId) {
      socket.to(chatId.toString()).emit('stop_typing', { chatId, userId: fromUser })
    }
  })

  // ─── Send Message ─────────────────────────────────────────────────────────
  socket.on('send_message', async (payload, cb) => {
    try {
      const senderId = myUserId
      const { receiverId, text = '', media = [], replyTo = null, tempId } = payload || {}

      if (!senderId || !receiverId) return cb?.({ ok: false, error: 'Missing sender/receiver' })
      if (!text?.trim() && (!media || media.length === 0)) {
        return cb?.({ ok: false, error: 'Empty message' })
      }

      // ✅ Block check
      const [senderUser, receiverUser] = await Promise.all([
        User.findById(senderId).select('blockedUsers'),
        User.findById(receiverId).select('blockedUsers'),
      ])
      if (receiverUser?.blockedUsers?.some((id) => id.toString() === senderId.toString())) {
        return cb?.({ ok: false, error: 'blocked', message: 'You have been blocked by this user' })
      }
      if (senderUser?.blockedUsers?.some((id) => id.toString() === receiverId.toString())) {
        return cb?.({ ok: false, error: 'blocked', message: 'You have blocked this user. Unblock to send messages' })
      }

      const { connection, justAccepted } = await ensureConnection(senderId, receiverId, io)
      if (connection.status === 'rejected') {
        return cb?.({ ok: false, error: 'Connection rejected' })
      }

      const preview = previewFromMedia(text, media)
      const mtype = typeFromMedia(text, media)

      let chat = await chatSchema.findOne({
        participants: { $all: [senderId, receiverId] },
      })
      if (!chat) {
        chat = await chatSchema.create({
          participants: [senderId, receiverId],
          lastMessage: preview,
          lastMessageType: mtype,
          lastSenderId: senderId,
          lastMessageAt: new Date(),
        })
      } else {
        chat.lastMessage = preview
        chat.lastMessageType = mtype
        chat.lastSenderId = senderId
        chat.lastMessageAt = new Date()
        // নতুন message এলে sender ও receiver উভয়ের hide সরাও
        if (chat.hiddenFor && chat.hiddenFor.length > 0) {
          chat.hiddenFor = chat.hiddenFor.filter(
            (id) => id.toString() !== receiverId.toString() && id.toString() !== senderId.toString()
          )
        }
        await chat.save()
      }

      const receiverOnline = isUserOnline(receiverId)
      const initialStatus = receiverOnline ? 'delivered' : 'sent'

      const newMsg = await messageSchema.create({
        chatId: chat._id,
        senderId,
        text: text || '',
        media: media || [],
        status: initialStatus,
        replyTo: replyTo || null,
      })

      const populated = await messageSchema
        .findById(newMsg._id)
        .populate('replyTo', 'text media senderId')

      const msgPayload = {
        _id: populated._id,
        chatId: chat._id,
        senderId,
        text: populated.text,
        media: populated.media,
        status: populated.status,
        replyTo: populated.replyTo || null,
        isForwarded: false,
        createdAt: populated.createdAt,
        tempId,
      }

      io.to(receiverId.toString()).emit('receive_message', msgPayload)
      io.to(receiverId.toString()).emit('new_message', { chatId: chat._id })
      io.to(senderId.toString()).emit('chat_updated', { chatId: chat._id })

      if (justAccepted) {
        io.to(senderId.toString()).emit('request_accepted')
        io.to(receiverId.toString()).emit('request_accepted')
      }

      // ─── Push Notification — receiver offline থাকলে ──────────────────────
      if (!receiverOnline) {
        // Sender এর name এবং profile image আনো
        const sender = await User.findById(senderId).select('name photo')
        const senderName = sender?.name || 'New message'
        const senderAvatar = sender?.photo?.url || ''

        sendPushToUser(receiverId, {
          title: senderName,                        // Sender এর নাম
          body: preview || 'Sent you a message',    // Message preview
          image: senderAvatar,                      // Sender এর profile image
          data: {
            chatId: chat._id.toString(),
            senderId: senderId.toString(),
            senderName: senderName,                 // Navigate এর জন্য
            senderAvatar: senderAvatar,             // Avatar দেখানোর জন্য
            type: 'message',
          },
        })
      }

      cb?.({
        ok: true,
        message: msgPayload,
        chat: { _id: chat._id },
        connectionStatus: connection.status,
        justAccepted,
      })
    } catch (err) {
      console.error('send_message error:', err)
      cb?.({ ok: false, error: err.message })
    }
  })

  // ─── Mark Delivered ───────────────────────────────────────────────────────
  socket.on('mark_delivered', async ({ chatId, userId }) => {
    try {
      if (!chatId || !userId) return
      const messages = await messageSchema
        .find({ chatId, senderId: { $ne: userId }, status: 'sent' })
        .select('senderId')
      if (messages.length === 0) return

      await messageSchema.updateMany(
        { chatId, senderId: { $ne: userId }, status: 'sent' },
        { $set: { status: 'delivered' } }
      )

      const senderIds = [...new Set(messages.map((m) => m.senderId.toString()))]
      senderIds.forEach((sid) => {
        io.to(sid).emit('messages_delivered', { chatId: chatId.toString() })
      })
    } catch (err) { console.error('mark_delivered error:', err) }
  })

  // ─── Mark Seen ────────────────────────────────────────────────────────────
  socket.on('mark_seen', async ({ chatId, userId }) => {
    try {
      if (!chatId || !userId) return
      const messages = await messageSchema
        .find({
          chatId,
          senderId: { $ne: userId },
          status: { $in: ['sent', 'delivered'] },
        })
        .select('senderId')
      if (messages.length === 0) return

      await messageSchema.updateMany(
        { chatId, senderId: { $ne: userId }, status: { $in: ['sent', 'delivered'] } },
        { $set: { status: 'seen', seen: true } }
      )

      const senderIds = [...new Set(messages.map((m) => m.senderId.toString()))]
      senderIds.forEach((sid) => {
        io.to(sid).emit('messages_seen', { chatId: chatId.toString() })
      })
    } catch (err) { console.error('mark_seen error:', err) }
  })

  // ─── Edit Message ─────────────────────────────────────────────────────────
  socket.on('edit_message', async ({ messageId, chatId, text }) => {
    try {
      const msg = await messageSchema.findById(messageId)
      if (!msg || msg.senderId.toString() !== myUserId?.toString()) return
      msg.text = text
      msg.isEdited = true
      await msg.save()
      const chat = await chatSchema.findById(msg.chatId)
      if (chat) {
        chat.participants.forEach((pid) => {
          io.to(pid.toString()).emit('message_edited', {
            messageId: msg._id.toString(),
            chatId: msg.chatId.toString(),
            text,
          })
        })
      }
    } catch (err) { console.error('edit_message error:', err) }
  })

  // ─── Delete Message ───────────────────────────────────────────────────────
  socket.on('delete_message', async ({ messageId, chatId, deleteFor }) => {
    try {
      const msg = await messageSchema.findById(messageId)
      if (!msg) return
      if (deleteFor === 'everyone') {
        if (msg.senderId.toString() !== myUserId?.toString()) return
        msg.isDeleted = true
        msg.text = ''
        msg.media = []
        await msg.save()
        const chat = await chatSchema.findById(msg.chatId)
        if (chat) {
          chat.participants.forEach((pid) => {
            io.to(pid.toString()).emit('message_deleted', {
              messageId: msg._id.toString(),
              chatId: msg.chatId.toString(),
              deleteFor: 'everyone',
            })
          })
        }
      } else if (deleteFor === 'me') {
        if (!msg.deletedFor?.some((id) => id.toString() === myUserId?.toString())) {
          msg.deletedFor.push(myUserId)
          await msg.save()
        }
        io.to(myUserId.toString()).emit('message_deleted', {
          messageId: msg._id.toString(),
          chatId: msg.chatId.toString(),
          deleteFor: 'me',
        })
      }
    } catch (err) { console.error('delete_message error:', err) }
  })

  // ─── Forward Message ──────────────────────────────────────────────────────
  socket.on('forward_message', async ({ messageId, toUserId, senderId }) => {
    try {
      const original = await messageSchema.findById(messageId)
      if (!original) return

      const { connection, justAccepted } = await ensureConnection(senderId, toUserId, io)
      if (connection.status === 'rejected') return

      const preview = previewFromMedia(original.text, original.media)
      const mtype = typeFromMedia(original.text, original.media)

      let chat = await chatSchema.findOne({
        participants: { $all: [senderId, toUserId] },
      })
      if (!chat) {
        chat = await chatSchema.create({
          participants: [senderId, toUserId],
          lastMessage: preview,
          lastMessageType: mtype,
          lastSenderId: senderId,
          lastMessageAt: new Date(),
        })
      } else {
        chat.lastMessage = preview
        chat.lastMessageType = mtype
        chat.lastSenderId = senderId
        chat.lastMessageAt = new Date()
        // forward message এলেও hide সরাও
        if (chat.hiddenFor && chat.hiddenFor.length > 0) {
          chat.hiddenFor = chat.hiddenFor.filter(
            (id) => id.toString() !== toUserId.toString() && id.toString() !== senderId.toString()
          )
        }
        await chat.save()
      }

      const receiverOnline = isUserOnline(toUserId)
      const forwarded = await messageSchema.create({
        chatId: chat._id,
        senderId,
        text: original.text || '',
        media: original.media || [],
        status: receiverOnline ? 'delivered' : 'sent',
        isForwarded: true,
      })

      const msgPayload = {
        _id: forwarded._id,
        chatId: chat._id,
        senderId,
        text: forwarded.text,
        media: forwarded.media,
        status: forwarded.status,
        isForwarded: true,
        replyTo: null,
        createdAt: forwarded.createdAt,
      }

      io.to(toUserId.toString()).emit('receive_message', msgPayload)
      io.to(toUserId.toString()).emit('new_message', { chatId: chat._id })

      if (justAccepted) {
        io.to(senderId.toString()).emit('request_accepted')
        io.to(toUserId.toString()).emit('request_accepted')
      }

      // ─── Push Notification for forward ───────────────────────────────────
      if (!receiverOnline) {
        const sender = await User.findById(senderId).select('name photo')
        const senderName = sender?.name || 'New message'
        const senderAvatar = sender?.photo?.url || ''

        sendPushToUser(toUserId, {
          title: senderName,
          body: preview,
          image: senderAvatar,
          data: {
            chatId: chat._id.toString(),
            senderId: senderId.toString(),
            senderName: senderName,
            senderAvatar: senderAvatar,
            type: 'message',
          },
        })
      }
    } catch (err) { console.error('forward_message error:', err) }
  })
}