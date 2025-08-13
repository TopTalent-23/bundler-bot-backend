import { Keypair, TransactionInstruction } from "@solana/web3.js";
import * as crypto from 'crypto';
import { DOUBLE_CHECK_PROGRAM_ID, DOUBLE_CHECK_STATE_PDA } from "../config";

export const getDoubleCheckInstruction = (signer: Keypair): TransactionInstruction => {
    const keys = [
        { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: DOUBLE_CHECK_STATE_PDA, isSigner: false, isWritable: true }
    ];
    const discriminator = getAnchorDiscriminator('submit_once');
    const randomNumber: number = Math.floor(Math.random() * 65536);
    const data = Buffer.concat([discriminator, bufferFromUInt64(randomNumber), bufferFromUInt64(0)]);
    const instruction: TransactionInstruction = new TransactionInstruction({
        keys: keys,
        programId: DOUBLE_CHECK_PROGRAM_ID,
        data: data
    });

    return instruction;
}

const bufferFromUInt64 = (value: number | string) => {
    let buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
}

const getAnchorDiscriminator = (instructionName: string) => {
    const hash = crypto.createHash('sha256');
    hash.update(`global:${instructionName}`);
    return hash.digest().slice(0, 8);
}