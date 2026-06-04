// services/fcm.js
const User = require('../models/userSchema')

let _admin = null

const getAdmin = () => {
  if (_admin) return _admin

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null

  try {
    const firebaseAdmin = require('firebase-admin')
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(JSON.parse(raw)),
      })
    }
    _admin = firebaseAdmin
    return _admin
  } catch (err) {
    console.error('[FCM] Firebase Admin init failed:', err.message)
    return null
  }
}

const sendPushToUser = async (userId, { title, body, image, data = {} }) => {
  const admin = getAdmin()
  if (!admin) return

  try {
    if (!userId) return

    const user = await User.findById(userId).select('fcmTokens')
    if (!user?.fcmTokens?.length) return

    const tokens = user.fcmTokens.filter(Boolean)
    if (!tokens.length) return

    const isCall = data?.type === 'incoming_call'

    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    )

    const baseAndroid = {
      priority: 'high',
      ttl: isCall ? 45_000 : 86_400_000,
      directBootOk: true,
    }

    const message = isCall
      ? {
          tokens,
          data: {
            ...stringData,
            title: title || 'Incoming Call',
            body: body || '',
            image: image || '',
          },
          android: baseAndroid,
          apns: {
            headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
            payload: {
              aps: { sound: 'ringtun.mp3', badge: 1, 'mutable-content': 1, 'content-available': 1 },
            },
          },
        }
      : {
          tokens,
          notification: { title: title || 'New message', body: body || '' },
          data: {
            ...stringData,
            title: title || 'New message',
            body: body || '',
            image: image || '',
          },
          android: {
            ...baseAndroid,
            notification: { channelId: 'messages', sound: 'received' },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: {
              aps: { sound: 'received.mp3', badge: 1, 'mutable-content': 1, 'content-available': 1 },
            },
          },
        }

    const res = await admin.messaging().sendEachForMulticast(message)

    const invalid = res.responses
      .map((r, i) => (!r.success && isInvalidTokenError(r.error?.code) ? tokens[i] : null))
      .filter(Boolean)

    if (invalid.length) {
      await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: { $in: invalid } } })
    }

    console.log(
      `📲 FCM → user ${userId} [${isCall ? 'CALL' : 'MSG'}]` +
        ` ok:${res.successCount} fail:${res.failureCount}`
    )
  } catch (err) {
    console.error('[FCM] sendPushToUser error:', err.message)
  }
}

const isInvalidTokenError = (code = '') =>
  code.includes('registration-token-not-registered') ||
  code.includes('invalid-registration-token') ||
  code.includes('invalid-argument')

module.exports = { sendPushToUser }