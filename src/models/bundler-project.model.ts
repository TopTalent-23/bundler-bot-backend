import mongoose from 'mongoose';
const Schema = mongoose.Schema;

let model = new Schema({
    name: { type: String },
    symbol: { type: String },
    description: { type: String },
    twitter: { type: String },
    telegram: { type: String },
    website: { type: String },
    dev_wallet_buy_sol_amount: { type: Number },
    dev_wallet_buy_token_amount: { type: Number },
    sub_wallet_buy_sol_amount_list: { type: String },
    sub_wallet_buy_token_amount_list: { type: String },
    dev_wallet: { type: String },
    sub_wallet_list: { type: String },
    mint: { type: String },
    lut_address: { type: String },
    is_valid: { type: Boolean, default: false },
    createdAt: { type: Number, default: Date.now }
});

export const BundlerProjectModel = mongoose.model('bundler-project', model);