// models/user.model.ts
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
    {
        telegramUserId: { type: Number, required: true, unique: true },
        username: String,
        solanaWallet: {
            publicKey: { type: String, required: true, unique: true },
            privateKey: { type: String, required: true, unique: true }, // 🔐 Encrypt this in production
        },
        fundWallet: {
            publicKey: { type: String, required: true, unique: true },
            privateKey: { type: String, required: true, unique: true }, // 🔐 Encrypt this in production
        },
        devWallet: {
            publicKey: { type: String, required: true, unique: true },
            privateKey: { type: String, required: true, unique: true }, // 🔐 Encrypt this in production
        },
        subWalletList: {
            publicKeyList: { type: String, required: true, unique: true },
            privateKeyList: { type: String, required: true, unique: true }, // 🔐 Encrypt this in production
        },
        role: { type: String, enum: ['user', 'admin'], default: 'user' },
        isVerified: { type: Boolean, default: false },
        language: { type: String, default: 'en' },
        createdAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export const UserModel = mongoose.model('User', userSchema);
