
const mongoose = require('mongoose');
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://support_db_user:MvYhEOChW4J342t3@cluster0.1p10k95.mongodb.net/';
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    // Wait 5s before retrying instead of exiting immediately
    setTimeout(connectDB, 5000);
  }
};
module.exports = connectDB;