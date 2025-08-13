// src/config/db.ts
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config(); // ✅ Load env variables before anything else

export const connectDB = async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/my-app';

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB connected');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
};
