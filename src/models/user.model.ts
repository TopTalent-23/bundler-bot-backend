// models/user.model.ts
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
    {
        telegramId: String,
        username: String,
        fundWallet: {
            publicKey: String,
            privateKey: String, // 🔐 Encrypt this in production
        },
        devWallet: {
            publicKey: String,
            privateKey: String, // 🔐 Encrypt this in production
        },
        subWalletList: {
            publicKeyList: String,
            privateKeyList: String, // 🔐 Encrypt this in production
        },
        role: { type: String, enum: ['user', 'admin'], default: 'user' },
        isVerified: { type: Boolean, default: false },
        telegramUserId: { type: String, required: true, unique: true },
        evmAddress: { type: String },
        signature: { type: String },
        solanaWallet: { type: String },
        language: { type: String, default: 'en' },
        createdAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export const UserModel = mongoose.model('User', userSchema);
