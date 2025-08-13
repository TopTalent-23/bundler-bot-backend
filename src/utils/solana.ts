import { AccountInfo, Connection, Keypair, ParsedAccountData, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import BN from "bn.js";
import bs58 from 'bs58';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export const getSolBalance = async (connection: Connection, walletAddress: PublicKey): Promise<number> => {
    try {
        return await connection.getBalance(walletAddress);
    } catch (error) {
        return 0;
    }
}

export const getTokenBalance = async (connection: Connection, walletAddress: PublicKey, tokenAddress: PublicKey): Promise<{ balance: BN, decimal: number, programId: PublicKey | null }> => {
    const mintAccountInfo = await connection.getParsedAccountInfo(tokenAddress); if (mintAccountInfo.value == null) return { balance: new BN(0), decimal: 0, programId: null };
    const mintAccountInfoValue: AccountInfo<ParsedAccountData> = mintAccountInfo.value as AccountInfo<ParsedAccountData>;
    const tokenDecimal: number = Number(mintAccountInfoValue.data.parsed.info.decimals);
    const programId: string = mintAccountInfoValue.owner.toBase58();
    try {
        if (programId === TOKEN_PROGRAM_ID.toBase58()) {
            const account = await getAssociatedTokenAddress(tokenAddress, walletAddress);
            const tokenBalance = new BN((await connection.getTokenAccountBalance(account)).value.amount) || new BN(0);
            return { balance: tokenBalance, decimal: tokenDecimal, programId: new PublicKey(programId) };
        } else if (programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
            const account = await getAssociatedTokenAddress(tokenAddress, walletAddress, false, TOKEN_2022_PROGRAM_ID);
            const tokenBalance = new BN((await connection.getTokenAccountBalance(account)).value.amount) || new BN(0);
            return { balance: tokenBalance, decimal: tokenDecimal, programId: new PublicKey(programId) };
        } else {
            return { balance: new BN(0), decimal: tokenDecimal, programId: new PublicKey(programId) };
        }

    } catch (error) {
        return { balance: new BN(0), decimal: tokenDecimal, programId: new PublicKey(programId) };
    }
}

export function getWallet(wallet: string): Keypair {
    // most likely someone pasted the private key in binary format
    if (wallet.startsWith('[')) {
        return Keypair.fromSecretKey(JSON.parse(wallet));
    }

    // most likely someone pasted mnemonic
    if (wallet.split(' ').length > 1) {
        const seed = mnemonicToSeedSync(wallet, '');
        const path = `m/44'/501'/0'/0'`; // we assume it's first path
        return Keypair.fromSeed(derivePath(path, seed.toString('hex')).key);
    }

    // most likely someone pasted string of number array
    if (wallet.split(',').length > 1) {
        return Keypair.fromSecretKey(new Uint8Array(wallet.split(",").map((val) => Number(val))));
    }

    // most likely someone pasted base58 encoded private key
    return Keypair.fromSecretKey(bs58.decode(wallet));
}