const { default: mongoose } = require("mongoose");


const connectDB = async () => {
  // Support both MONGO_URL (Emergent/standard) and MONGO_URI (legacy)
  const uri =
    process.env.MONGO_URL ||
    process.env.MONGO_URI ||
    'mongodb://localhost:27017/kotha';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✅ MongoDB Connected:', uri.split('@').pop().split('?')[0]);
  } catch (err) {
    console.error('❌ DB Connection Error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
