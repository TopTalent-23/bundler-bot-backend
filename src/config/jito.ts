import { PublicKey } from "@solana/web3.js";

export const JITO_UUID = process.env.JITO_UUID || '';
export const JITO_FEE = Number(process.env.JITO_FEE) || 0.001;
export const PROXY_LOGIN_USERNAME = process.env.PROXY_LOGIN_USERNAME || '';
export const PROXY_LOGIN_PASSWORD = process.env.PROXY_LOGIN_PASSWORD || '';
export const DOUBLE_CHECK_PROGRAM_ID = new PublicKey('7dNDKN621rXdL1Zec3UZB6VbaKsJ98Gi7g6cpPyTRCVY');
export const [DOUBLE_CHECK_STATE_PDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("dedup_buffer")],
    DOUBLE_CHECK_PROGRAM_ID
);