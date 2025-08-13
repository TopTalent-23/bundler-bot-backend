// src/services/launch.service.ts

import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import bs58 from 'bs58';
import BN from "bn.js";
import axios from "axios";
import { connection, DOUBLE_CHECK_PROGRAM_ID, DOUBLE_CHECK_STATE_PDA, JITO_FEE } from "../config";
import { UserModel } from "../models/user.model";
import { getSolBalance, getWallet, logger, sleep } from "../utils";
import { BundlerProjectModel, PumpVanityKeypairModel } from "../models";
import { Pump, pumpIdl, PumpSdk } from "@pump-fun/pump-sdk";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { JitoMultiTryBundleExecutor } from "../transaction";

interface LaunchTokenParams {
    telegramId: string;
    platform: 'pumpfun' | 'letsbonk';
    // iamge: File,
    name: string;
    symbol: string;
    description: string;
    socials?: Record<string, string>;
    devWalletBuySolAmount: number,
    subWalletBuySolAmountList: number[]
}

// Simulate async blockchain and DB ops
export async function createTokenAndBuyBundles(params: LaunchTokenParams) {
    // find user
    const user = await UserModel.findOne({ telegramId: params.telegramId });
    if (!user || !user.fundWallet?.publicKey || !user.fundWallet?.privateKey) throw new Error('User not found');

    // check sol balance
    const userFundWallet: Keypair = getWallet(user.fundWallet.privateKey);
    const solBalance: number = await getSolBalance(connection, userFundWallet.publicKey);
    const totalSubBuySolAmount: number = params.subWalletBuySolAmountList.reduce((sum, amt) => sum + amt, 0);
    const totalPrice: number = (params.devWalletBuySolAmount + totalSubBuySolAmount) * 1e9;

    if (solBalance < totalPrice) throw new Error('Insufficient SOL balance');

    if (params.platform == 'pumpfun') createPumpfunTokenAndBuyBundles(params);
    else createLetsbonkTokenAndBuyBundles(params);

    // Here, just return a mock result for demonstration:
    return {
        tokenAddress: 'fake-token-address-123',
        bundlesBought: 24,
        status: 'success',
    };
}

const createPumpfunTokenAndBuyBundles = async (params: LaunchTokenParams) => {
    const user = await UserModel.findOne({ telegramId: params.telegramId });
    if (!user || !user.devWallet?.privateKey || !user.fundWallet?.privateKey) return;

    const fundWallet: Keypair = getWallet(user.fundWallet.privateKey);
    const devWallet: Keypair = getWallet(user.devWallet.privateKey);
    const subWalletList: Keypair[] = Array.from({ length: params.subWalletBuySolAmountList.length })
        .map(() => {
            return Keypair.generate();
        })
    let mintKp: Keypair;
    // create a new pumpfun bundler token
    const newPumpfunBundlerToken = new BundlerProjectModel();
    newPumpfunBundlerToken.name = params.name;
    newPumpfunBundlerToken.symbol = params.symbol;
    newPumpfunBundlerToken.description = params.description;
    newPumpfunBundlerToken.twitter = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.telegram = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.website = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.dev_wallet_buy_sol_amount = params.devWalletBuySolAmount;
    newPumpfunBundlerToken.sub_wallet_buy_sol_amount_list = params.subWalletBuySolAmountList.join(',');
    newPumpfunBundlerToken.dev_wallet = bs58.encode(Keypair.generate().secretKey);
    newPumpfunBundlerToken.sub_wallet_list = subWalletList.map((wallet: Keypair) => bs58.encode(wallet.secretKey)).join(',');
    const pumpVanityKeypairRecord = await PumpVanityKeypairModel.findOne({ is_valid: true });
    if (pumpVanityKeypairRecord) {
        pumpVanityKeypairRecord.is_valid = false;
        await pumpVanityKeypairRecord.save();
        newPumpfunBundlerToken.mint = pumpVanityKeypairRecord.private_key;
        mintKp = getWallet(pumpVanityKeypairRecord.private_key);
    } else {
        mintKp = Keypair.generate();
        newPumpfunBundlerToken.mint = bs58.encode(mintKp.secretKey);
    }
    const newPumpfunBundlerProjectId = (await newPumpfunBundlerToken.save()).id;

    // simulate
    const tokenDecimals = 1_000_000;
    const tokenTotalSupply = 1_000_000_000 * tokenDecimals;
    let initialRealSolReserves = 0;
    let initialVirtualTokenReserves = 1_073_000_000 * tokenDecimals;
    let initialRealTokenReserves = 793_100_000 * tokenDecimals;
    let totalTokensBought = 0;

    const buyWalletList: Keypair[] = [devWallet, ...subWalletList];
    const buySolAmountList: number[] = [newPumpfunBundlerToken.dev_wallet_buy_sol_amount * 1e9, ...params.subWalletBuySolAmountList.map((solAmount: number) => solAmount * 1e9)];
    let devWalletBuyTokenAmount: number = 0;
    const subWalletBuyTokenAmountList: number[] = [];
    for (let it = 0; it <= buyWalletList.length; it++) {
        const solAmount = buySolAmountList[it];
        if (!solAmount || solAmount <= 0) {
            if (it === 0) devWalletBuyTokenAmount = 0;
            continue;
        }

        const e = new BN(solAmount);
        const initialVirtualSolReserves = 30 * 1e9 + initialRealSolReserves;
        const a = new BN(initialVirtualSolReserves).mul(new BN(initialVirtualTokenReserves));
        const i = new BN(initialVirtualSolReserves).add(e);
        const l = a.div(i).add(new BN(1));
        let tokensToBuy: BN = new BN(initialVirtualTokenReserves).sub(l);
        tokensToBuy = BN.min(tokensToBuy, new BN(initialRealTokenReserves));

        const tokensBought = tokensToBuy.toNumber();
        totalTokensBought += tokensBought;
        initialRealSolReserves += solAmount;
        initialRealTokenReserves -= tokensBought;
        initialVirtualTokenReserves -= tokensBought;

        if (it === 0) {
            devWalletBuyTokenAmount = tokensBought;
        } else {
            subWalletBuyTokenAmountList.push(tokensBought);
        }
    }

    newPumpfunBundlerToken.dev_wallet_buy_token_amount = devWalletBuyTokenAmount;
    newPumpfunBundlerToken.sub_wallet_buy_token_amount_list = subWalletBuyTokenAmountList.join(',');
    await newPumpfunBundlerToken.save();

    // create metadata
    let formData = new FormData();
    // formData.append('file', params.iamge);
    formData.append('name', params.name);
    formData.append('symbol', params.symbol);
    formData.append('description', params.description);
    const { socials } = params;
    if (socials?.token_twitter) formData.append('twitter', socials.token_twitter);
    if (socials?.token_telegram) formData.append('telegram', socials.token_telegram);
    if (socials?.token_website) formData.append('website', socials.token_website);
    formData.append('showName', 'true');

    let metadata_uri: string;
    while (true) {
        try {
            const response = await axios.post("https://pump.fun/api/ipfs", formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            });
            metadata_uri = response.data.metadataUri;
            logger.info(`Pumpfun Bundler: Uploading Metadata Succeed`);
            break;
        } catch (error) {
            logger.error(error);
            logger.error(`Pumpfun Bundler: Uploading Metadata Failed`);
        }
    }

    // prepare bundle buy instructions
    const bundleBuyInstructionsList: TransactionInstruction[][] = [];
    const bundleBuySignersList: Keypair[][] = [];

    const pumpfunSdk = new PumpSdk(connection);
    const global = await pumpfunSdk.fetchGlobal();
    const feeRecipients: PublicKey[] = [global.feeRecipient, ...global.feeRecipients];
    const pumpIdlAddressOverride = { ...pumpIdl };
    const program: Program<Pump> = new Program(
        pumpIdlAddressOverride as Pump,
        new AnchorProvider(connection, null as any, {}),
    );

    //dev wallet
    const devWalletInstructionList: TransactionInstruction[] = [];
    const devWalletSignersList: Keypair[] = [];
    const [creatorVault] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("creator-vault"),
            devWallet.publicKey.toBuffer(), // assuming bonding_curve.creator is the bonding_curve address
        ],
        program.programId
    );
    const createIx = await program.methods
        .create(newPumpfunBundlerToken.name, newPumpfunBundlerToken.symbol, metadata_uri, devWallet.publicKey)
        .accountsPartial({
            mint: mintKp.publicKey,
            user: devWallet.publicKey,
        })
        .instruction();
    devWalletInstructionList.push(createIx);
    devWalletSignersList.push(devWallet, mintKp);

    if (newPumpfunBundlerToken.dev_wallet_buy_sol_amount > 0) {
        const devWalletAssociatedTokenAccount: PublicKey = getAssociatedTokenAddressSync(mintKp.publicKey, devWallet.publicKey);
        const createDevWalletAssociatedTokenAccountInstruction: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(
            devWallet.publicKey,
            devWalletAssociatedTokenAccount,
            devWallet.publicKey,
            mintKp.publicKey
        );

        const devWalletBuyInstruction: TransactionInstruction = await program.methods
            .buy(new BN(newPumpfunBundlerToken.dev_wallet_buy_token_amount), new BN((newPumpfunBundlerToken.dev_wallet_buy_sol_amount) * 1e9))
            .accountsPartial({
                feeRecipient: feeRecipients[Math.floor(Math.random() * feeRecipients.length)],
                mint: mintKp.publicKey,
                associatedUser: devWalletAssociatedTokenAccount,
                user: devWallet.publicKey,
                creatorVault
            })
            .instruction();
        devWalletInstructionList.push(createDevWalletAssociatedTokenAccountInstruction, devWalletBuyInstruction);
        devWalletSignersList.push(devWallet);
    }

    bundleBuyInstructionsList.push(devWalletInstructionList);
    bundleBuySignersList.push(devWalletSignersList);

    // sub wallets
    const batchSize: number = Math.ceil(subWalletList.length / 4);
    for (let batchIndex = 0; batchIndex < 4; batchIndex++) {
        const instructionList: TransactionInstruction[] = [];
        const singerList: Keypair[] = [];
        for (let j = 0; j < batchSize; j++) {
            const walletIndex: number = batchIndex * batchSize + j;
            // Break if out of bounds
            if (walletIndex >= subWalletList.length) break;
            const wallet: Keypair = subWalletList[walletIndex];
            // Safety check if wallet exists
            if (!wallet) continue;

            const associatedTokenAccount: PublicKey = getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);
            const createAssociatedTokenAccountInstruction: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                associatedTokenAccount,
                wallet.publicKey,
                mintKp.publicKey
            );
            const buyInstruction: TransactionInstruction = await program.methods
                .buy(new BN(subWalletBuyTokenAmountList[walletIndex]), new BN(subWalletBuyTokenAmountList[walletIndex]))
                .accountsPartial({
                    feeRecipient: feeRecipients[Math.floor(Math.random() * feeRecipients.length)],
                    mint: mintKp.publicKey,
                    associatedUser: associatedTokenAccount,
                    user: wallet.publicKey,
                    creatorVault,
                })
                .instruction();
            instructionList.push(createAssociatedTokenAccountInstruction, buyInstruction);
            singerList.push(wallet);

        }

        bundleBuyInstructionsList.push(instructionList);
        bundleBuySignersList.push(singerList);
    }

    // create and extend LUT
    const jitoExecutor = new JitoMultiTryBundleExecutor(connection);
    const [createLUTix, lutAddress] = AddressLookupTableProgram.createLookupTable({
        authority: fundWallet.publicKey,
        payer: fundWallet.publicKey,
        recentSlot: await connection.getSlot('finalized')
    });

    newPumpfunBundlerToken.lut_address = lutAddress.toString();
    await newPumpfunBundlerToken.save();

    while (true) {
        const result = await jitoExecutor.multiTryBundles([[createLUTix]], [[fundWallet]], fundWallet, JITO_FEE);
        if (result.confirmed) {
            logger.info('Pumpfun Bundler: LUT Create Succeed.');
            break;
        }
    }

    const addressSet = new Set<string>();

    for (const instructionList of bundleBuyInstructionsList) {
        for (const instruction of instructionList) {
            for (const key of instruction.keys) {
                addressSet.add(key.pubkey.toString());
            }
        }
    }

    // --- ADD DOUBLE CHECK ACCOUNTS IF MISSING ---
    const extraAccounts = [
        DOUBLE_CHECK_PROGRAM_ID,
        DOUBLE_CHECK_STATE_PDA,
        fundWallet.publicKey
    ];

    for (const acc of extraAccounts) {
        addressSet.add(acc.toString());
    }

    // --- CHUNK ADDRESSES FOR EXTEND LUT ---
    const addressList = Array.from(addressSet).map(addr => new PublicKey(addr));
    const chunkedAddressList = splitIntoChunks(addressList, 20); // Max 20 addresses per extend

    const extendInstructionsList: TransactionInstruction[][] = [];
    const extendSignersList: Keypair[][] = [];

    for (const chunk of chunkedAddressList) {
        extendInstructionsList.push([
            AddressLookupTableProgram.extendLookupTable({
                payer: fundWallet.publicKey,
                authority: fundWallet.publicKey,
                lookupTable: lutAddress,
                addresses: chunk,
            }),
        ]);
        extendSignersList.push([fundWallet]);
    }
    while (true) {
        const result = await jitoExecutor.multiTryBundles(extendInstructionsList, extendSignersList, fundWallet, JITO_FEE);
        if (result.confirmed) {
            logger.info('Pumpfun Bundler: LUT Extend Succeed.');
            break;
        }
    }

    await sleep(15000);

    // send bundle transactions
    const lookupTableAccount: AddressLookupTableAccount = (
        await connection.getAddressLookupTable(lutAddress)
    ).value as AddressLookupTableAccount;
    while (true) {
        const result = await jitoExecutor.multiTryBundles(bundleBuyInstructionsList, bundleBuySignersList, fundWallet, JITO_FEE, 5, lookupTableAccount);
        if (result.confirmed) {
            logger.info(`Bullx: https://neo.bullx.io/terminal?chainId=1399811149&address=${mintKp.publicKey.toString()}`);
            logger.info('Pumpfun Bundler: Creation & Buy Bundle Succeed.');
            break;
        }
    }
}

const createLetsbonkTokenAndBuyBundles = async (params: LaunchTokenParams) => {
    const user = await UserModel.findOne({ telegramId: params.telegramId });
    if (!user || !user.devWallet?.privateKey || !user.fundWallet?.privateKey) return;

    const fundWallet: Keypair = getWallet(user.fundWallet.privateKey);
    const devWallet: Keypair = getWallet(user.devWallet.privateKey);
    const subWalletList: Keypair[] = Array.from({ length: params.subWalletBuySolAmountList.length })
        .map(() => {
            return Keypair.generate();
        })
    let mintKp: Keypair;
    // create a new pumpfun bundler token
    const newPumpfunBundlerToken = new BundlerProjectModel();
    newPumpfunBundlerToken.name = params.name;
    newPumpfunBundlerToken.symbol = params.symbol;
    newPumpfunBundlerToken.description = params.description;
    newPumpfunBundlerToken.twitter = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.telegram = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.website = params.socials && params.socials.twitter ? params.socials.twitter : '';
    newPumpfunBundlerToken.dev_wallet_buy_sol_amount = params.devWalletBuySolAmount;
    newPumpfunBundlerToken.sub_wallet_buy_sol_amount_list = params.subWalletBuySolAmountList.join(',');
    newPumpfunBundlerToken.dev_wallet = bs58.encode(Keypair.generate().secretKey);
    newPumpfunBundlerToken.sub_wallet_list = subWalletList.map((wallet: Keypair) => bs58.encode(wallet.secretKey)).join(',');
    const pumpVanityKeypairRecord = await PumpVanityKeypairModel.findOne({ is_valid: true });
    if (pumpVanityKeypairRecord) {
        pumpVanityKeypairRecord.is_valid = false;
        await pumpVanityKeypairRecord.save();
        newPumpfunBundlerToken.mint = pumpVanityKeypairRecord.private_key;
        mintKp = getWallet(pumpVanityKeypairRecord.private_key);
    } else {
        mintKp = Keypair.generate();
        newPumpfunBundlerToken.mint = bs58.encode(mintKp.secretKey);
    }
    const newPumpfunBundlerProjectId = (await newPumpfunBundlerToken.save()).id;

    // simulate
    const tokenDecimals = 1_000_000;
    const tokenTotalSupply = 1_000_000_000 * tokenDecimals;
    let initialRealSolReserves = 0;
    let initialVirtualTokenReserves = 1_073_000_000 * tokenDecimals;
    let initialRealTokenReserves = 793_100_000 * tokenDecimals;
    let totalTokensBought = 0;

    const buyWalletList: Keypair[] = [devWallet, ...subWalletList];
    const buySolAmountList: number[] = [newPumpfunBundlerToken.dev_wallet_buy_sol_amount * 1e9, ...params.subWalletBuySolAmountList.map((solAmount: number) => solAmount * 1e9)];
    let devWalletBuyTokenAmount: number = 0;
    const subWalletBuyTokenAmountList: number[] = [];
    for (let it = 0; it <= buyWalletList.length; it++) {
        const solAmount = buySolAmountList[it];
        if (!solAmount || solAmount <= 0) {
            if (it === 0) devWalletBuyTokenAmount = 0;
            continue;
        }

        const e = new BN(solAmount);
        const initialVirtualSolReserves = 30 * 1e9 + initialRealSolReserves;
        const a = new BN(initialVirtualSolReserves).mul(new BN(initialVirtualTokenReserves));
        const i = new BN(initialVirtualSolReserves).add(e);
        const l = a.div(i).add(new BN(1));
        let tokensToBuy: BN = new BN(initialVirtualTokenReserves).sub(l);
        tokensToBuy = BN.min(tokensToBuy, new BN(initialRealTokenReserves));

        const tokensBought = tokensToBuy.toNumber();
        totalTokensBought += tokensBought;
        initialRealSolReserves += solAmount;
        initialRealTokenReserves -= tokensBought;
        initialVirtualTokenReserves -= tokensBought;

        if (it === 0) {
            devWalletBuyTokenAmount = tokensBought;
        } else {
            subWalletBuyTokenAmountList.push(tokensBought);
        }
    }

    newPumpfunBundlerToken.dev_wallet_buy_token_amount = devWalletBuyTokenAmount;
    newPumpfunBundlerToken.sub_wallet_buy_token_amount_list = subWalletBuyTokenAmountList.join(',');
    await newPumpfunBundlerToken.save();

    // create metadata
    let formData = new FormData();
    // formData.append('file', params.iamge);
    formData.append('name', params.name);
    formData.append('symbol', params.symbol);
    formData.append('description', params.description);
    const { socials } = params;
    if (socials?.token_twitter) formData.append('twitter', socials.token_twitter);
    if (socials?.token_telegram) formData.append('telegram', socials.token_telegram);
    if (socials?.token_website) formData.append('website', socials.token_website);
    formData.append('showName', 'true');

    let metadata_uri: string;
    while (true) {
        try {
            const response = await axios.post("https://pump.fun/api/ipfs", formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            });
            metadata_uri = response.data.metadataUri;
            logger.info(`Pumpfun Bundler: Uploading Metadata Succeed`);
            break;
        } catch (error) {
            logger.error(error);
            logger.error(`Pumpfun Bundler: Uploading Metadata Failed`);
        }
    }

    // prepare bundle buy instructions
    const bundleBuyInstructionsList: TransactionInstruction[][] = [];
    const bundleBuySignersList: Keypair[][] = [];

    const pumpfunSdk = new PumpSdk(connection);
    const global = await pumpfunSdk.fetchGlobal();
    const feeRecipients: PublicKey[] = [global.feeRecipient, ...global.feeRecipients];
    const pumpIdlAddressOverride = { ...pumpIdl };
    const program: Program<Pump> = new Program(
        pumpIdlAddressOverride as Pump,
        new AnchorProvider(connection, null as any, {}),
    );

    //dev wallet
    const devWalletInstructionList: TransactionInstruction[] = [];
    const devWalletSignersList: Keypair[] = [];
    const [creatorVault] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("creator-vault"),
            devWallet.publicKey.toBuffer(), // assuming bonding_curve.creator is the bonding_curve address
        ],
        program.programId
    );
    const createIx = await program.methods
        .create(newPumpfunBundlerToken.name, newPumpfunBundlerToken.symbol, metadata_uri, devWallet.publicKey)
        .accountsPartial({
            mint: mintKp.publicKey,
            user: devWallet.publicKey,
        })
        .instruction();
    devWalletInstructionList.push(createIx);
    devWalletSignersList.push(devWallet, mintKp);

    if (newPumpfunBundlerToken.dev_wallet_buy_sol_amount > 0) {
        const devWalletAssociatedTokenAccount: PublicKey = getAssociatedTokenAddressSync(mintKp.publicKey, devWallet.publicKey);
        const createDevWalletAssociatedTokenAccountInstruction: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(
            devWallet.publicKey,
            devWalletAssociatedTokenAccount,
            devWallet.publicKey,
            mintKp.publicKey
        );

        const devWalletBuyInstruction: TransactionInstruction = await program.methods
            .buy(new BN(newPumpfunBundlerToken.dev_wallet_buy_token_amount), new BN((newPumpfunBundlerToken.dev_wallet_buy_sol_amount) * 1e9))
            .accountsPartial({
                feeRecipient: feeRecipients[Math.floor(Math.random() * feeRecipients.length)],
                mint: mintKp.publicKey,
                associatedUser: devWalletAssociatedTokenAccount,
                user: devWallet.publicKey,
                creatorVault
            })
            .instruction();
        devWalletInstructionList.push(createDevWalletAssociatedTokenAccountInstruction, devWalletBuyInstruction);
        devWalletSignersList.push(devWallet);
    }

    bundleBuyInstructionsList.push(devWalletInstructionList);
    bundleBuySignersList.push(devWalletSignersList);

    // sub wallets
    const batchSize: number = Math.ceil(subWalletList.length / 4);
    for (let batchIndex = 0; batchIndex < 4; batchIndex++) {
        const instructionList: TransactionInstruction[] = [];
        const singerList: Keypair[] = [];
        for (let j = 0; j < batchSize; j++) {
            const walletIndex: number = batchIndex * batchSize + j;
            // Break if out of bounds
            if (walletIndex >= subWalletList.length) break;
            const wallet: Keypair = subWalletList[walletIndex];
            // Safety check if wallet exists
            if (!wallet) continue;

            const associatedTokenAccount: PublicKey = getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);
            const createAssociatedTokenAccountInstruction: TransactionInstruction = createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                associatedTokenAccount,
                wallet.publicKey,
                mintKp.publicKey
            );
            const buyInstruction: TransactionInstruction = await program.methods
                .buy(new BN(subWalletBuyTokenAmountList[walletIndex]), new BN(subWalletBuyTokenAmountList[walletIndex]))
                .accountsPartial({
                    feeRecipient: feeRecipients[Math.floor(Math.random() * feeRecipients.length)],
                    mint: mintKp.publicKey,
                    associatedUser: associatedTokenAccount,
                    user: wallet.publicKey,
                    creatorVault,
                })
                .instruction();
            instructionList.push(createAssociatedTokenAccountInstruction, buyInstruction);
            singerList.push(wallet);

        }

        bundleBuyInstructionsList.push(instructionList);
        bundleBuySignersList.push(singerList);
    }

    // create and extend LUT
    const jitoExecutor = new JitoMultiTryBundleExecutor(connection);
    const [createLUTix, lutAddress] = AddressLookupTableProgram.createLookupTable({
        authority: fundWallet.publicKey,
        payer: fundWallet.publicKey,
        recentSlot: await connection.getSlot('finalized')
    });

    newPumpfunBundlerToken.lut_address = lutAddress.toString();
    await newPumpfunBundlerToken.save();

    while (true) {
        const result = await jitoExecutor.multiTryBundles([[createLUTix]], [[fundWallet]], fundWallet, JITO_FEE);
        if (result.confirmed) {
            logger.info('Pumpfun Bundler: LUT Create Succeed.');
            break;
        }
    }

    const addressSet = new Set<string>();

    for (const instructionList of bundleBuyInstructionsList) {
        for (const instruction of instructionList) {
            for (const key of instruction.keys) {
                addressSet.add(key.pubkey.toString());
            }
        }
    }

    // --- ADD DOUBLE CHECK ACCOUNTS IF MISSING ---
    const extraAccounts = [
        DOUBLE_CHECK_PROGRAM_ID,
        DOUBLE_CHECK_STATE_PDA,
        fundWallet.publicKey
    ];

    for (const acc of extraAccounts) {
        addressSet.add(acc.toString());
    }

    // --- CHUNK ADDRESSES FOR EXTEND LUT ---
    const addressList = Array.from(addressSet).map(addr => new PublicKey(addr));
    const chunkedAddressList = splitIntoChunks(addressList, 20); // Max 20 addresses per extend

    const extendInstructionsList: TransactionInstruction[][] = [];
    const extendSignersList: Keypair[][] = [];

    for (const chunk of chunkedAddressList) {
        extendInstructionsList.push([
            AddressLookupTableProgram.extendLookupTable({
                payer: fundWallet.publicKey,
                authority: fundWallet.publicKey,
                lookupTable: lutAddress,
                addresses: chunk,
            }),
        ]);
        extendSignersList.push([fundWallet]);
    }
    while (true) {
        const result = await jitoExecutor.multiTryBundles(extendInstructionsList, extendSignersList, fundWallet, JITO_FEE);
        if (result.confirmed) {
            logger.info('Pumpfun Bundler: LUT Extend Succeed.');
            break;
        }
    }

    await sleep(15000);

    // send bundle transactions
    const lookupTableAccount: AddressLookupTableAccount = (
        await connection.getAddressLookupTable(lutAddress)
    ).value as AddressLookupTableAccount;
    while (true) {
        const result = await jitoExecutor.multiTryBundles(bundleBuyInstructionsList, bundleBuySignersList, fundWallet, JITO_FEE, 5, lookupTableAccount);
        if (result.confirmed) {
            logger.info(`Bullx: https://neo.bullx.io/terminal?chainId=1399811149&address=${mintKp.publicKey.toString()}`);
            logger.info('Pumpfun Bundler: Creation & Buy Bundle Succeed.');
            break;
        }
    }
}

const splitIntoChunks = <T>(array: T[], chunkSize: number): T[][] => {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        result.push(array.slice(i, i + chunkSize));
    }
    return result;
}
