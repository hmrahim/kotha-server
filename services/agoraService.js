

const { RtcTokenBuilder, RtcRole } = require('agora-access-token')

const AGORA_APP_ID = process.env.AGORA_APP_ID || '6fbae39998f64fa3b34ab418d915c45f'
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '9817cf22cf6943f9a6c59a39717d50b9'
const TOKEN_EXPIRATION_SECONDS = 60 * 60 // 1 hour

const generateRtcToken = (channelName, uid, role = 'publisher') => {
    if (!channelName) throw new Error('channelName required')
    if (uid === undefined || uid === null) throw new Error('uid required')

    const agoraRole = role === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER
    const now = Math.floor(Date.now() / 1000)
    const privilegeExpiredTs = now + TOKEN_EXPIRATION_SECONDS

    const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        channelName,
        Number(uid),
        agoraRole,
        privilegeExpiredTs
    )

    return { token, appId: AGORA_APP_ID, uid: Number(uid), expiresAt: privilegeExpiredTs }
}

module.exports = { generateRtcToken, AGORA_APP_ID }
