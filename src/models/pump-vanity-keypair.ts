import mongoose from 'mongoose';
const Schema = mongoose.Schema;

let model = new Schema({
    public_key: { type: String, default: '' },
    private_key: { type: String, default: '' },
    is_valid: { type: Boolean, default: true },
    createdAt: { type: Number, default: Date.now }
});

export const PumpVanityKeypairModel = mongoose.model('pump-vanity-keypair', model);