const dns = require('dns')
dns.setServers(['8.8.8.8', '8.8.4.4'])

const mongoose = require('mongoose')
require('dotenv').config()

const connectDB = async () => {
  const uri = process.env.MONGO_URI

  if (!uri) {
    console.error('❌ MONGO_URI is not set in .env — server cannot start.')
    process.exit(1)
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    })
    const safeUri = uri.split('@').pop().split('?')[0]
    console.log('✅ MongoDB Connected:', safeUri)
  } catch (err) {
    console.error('❌ DB Connection Error:', err.message)
    process.exit(1)
  }
}

module.exports = connectDB