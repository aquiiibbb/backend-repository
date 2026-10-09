
const mongoose = require('mongoose');
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://nitinshaukia_db_user:kqf7MKBV1c8mPH1y@cluster0.s8thgte.mongodb.net/ahaalo?retryWrites=true&w=majority&appName=Cluster0';
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    // Wait 5s before retrying instead of exiting immediately
    setTimeout(connectDB, 5000);
  }
};
module.exports = connectDB;