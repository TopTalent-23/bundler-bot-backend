import {
    BlockhashWithExpiryBlockHeight,
    Keypair,
    Connection,
    TransactionMessage,
    VersionedTransaction,
    TransactionInstruction,
    LAMPORTS_PER_SOL,
    SystemProgram,
    AddressLookupTableAccount,
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios, { AxiosError } from 'axios';
import https from 'https';
import { getDoubleCheckInstruction, getRandomValidatorKey, logger, sleep } from '../utils';
import { JITO_UUID, PROXY_LOGIN_USERNAME, PROXY_LOGIN_PASSWORD } from '../config';

export class JitoMultiTryBundleExecutor {

    private readonly connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async multiTryBundles(
        instructionsList: TransactionInstruction[][],
        signersList: Keypair[][],
        payer: Keypair,
        jitoFee: number,
        maxTryNumber: number = 5,
        lookupTableAccount?: AddressLookupTableAccount
    ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {

        const doubleCheckInstruction: TransactionInstruction = getDoubleCheckInstruction(payer);

        const asyncFunctions: (() => Promise<{ confirmed: boolean; signature?: string; error?: string; }>)[] = [];
        for (let i = 0; i < maxTryNumber; i++) {
            asyncFunctions.push(() => this.executeAndConfirm(instructionsList, signersList, doubleCheckInstruction, payer, jitoFee, i + 1, maxTryNumber, lookupTableAccount));
        }

        const results: Promise<boolean>[] = [];
        let resolved = false;

        return new Promise((resolve) => {
            asyncFunctions.forEach((fn, i) => {
                setTimeout(async () => {
                    if (resolved) return;

                    try {
                        const result = await fn();
                        if (result.confirmed && !resolved) {
                            resolved = true;
                            resolve({ confirmed: true, signature: result.signature, error: result.error });
                        }

                        // If last function and no one returned true
                        if (i === asyncFunctions.length - 1) {
                            Promise.all(results).then(() => {
                                if (!resolved) resolve({ confirmed: false });
                            });
                        }
                    } catch (err) {
                        // You can handle errors here if needed
                        resolve({ confirmed: false });
                    }
                }, i * 1000); // stagger calls by 1s
            });
        });
    }

    private async executeAndConfirm(
        instructionsListOriginal: TransactionInstruction[][],
        signersListOriginal: Keypair[][],
        doubleCheckInstruction: TransactionInstruction,
        payer: Keypair,
        jitoFee: number,
        tryNumber: number,
        maxTryNumber: number,
        lookupTableAccount?: AddressLookupTableAccount
    ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
        try {
            // Deep clone the inputs to prevent mutation
            const instructionsList = instructionsListOriginal.map((arr) => [...arr]);
            const signersList = signersListOriginal.map((arr) => [...arr]);

            const jitoFeeWallet = getRandomValidatorKey(); // Update wallet key each execution
            const jitoFeeLamports = Math.floor(jitoFee * LAMPORTS_PER_SOL);

            const latestBlockhash: BlockhashWithExpiryBlockHeight = await this.connection.getLatestBlockhash(this.connection.commitment);

            if (instructionsList.length < 5) {
                instructionsList.unshift([
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: jitoFeeWallet,
                        lamports: jitoFeeLamports,
                    }),
                    doubleCheckInstruction
                ]);
                signersList.unshift([payer]);
            } else {
                instructionsList[0].push(
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: jitoFeeWallet,
                        lamports: jitoFeeLamports,
                    }),
                );
                signersList[0].push(payer);

                // In case of transaction number is 5, Find the shortest transaction and insert double check instruction into there.
                const transactionList: VersionedTransaction[] = [];
                for (let i = 0; i < instructionsList.length; i++) {
                    const message = new TransactionMessage({
                        payerKey: signersList[i][0].publicKey,
                        recentBlockhash: latestBlockhash.blockhash,
                        instructions: instructionsList[i],
                    }).compileToV0Message((typeof lookupTableAccount !== 'undefined') ? [lookupTableAccount] : []);
                    const transaction: VersionedTransaction = new VersionedTransaction(message);
                    transaction.sign(signersList[i]);
                    transactionList.push(transaction);
                }

                // Serialize the transactions once here
                const serializedTransactionList: string[] = [];
                for (let i = 0; i < transactionList.length; i++) {
                    serializedTransactionList.push(bs58.encode(transactionList[i].serialize()));
                    // console.log(bs58.encode(transactionList[i].serialize()).length)
                }

                const shortestTransactionIndex: number = serializedTransactionList.reduce((shortestIdx, currentTransaction, currentIndex, arr) => {
                    return currentTransaction.length < arr[shortestIdx].length ? currentIndex : shortestIdx;
                }, 0);

                instructionsList[shortestTransactionIndex].push(doubleCheckInstruction);
                signersList[shortestTransactionIndex].push(payer);
            }

            const transactionList: VersionedTransaction[] = [];
            for (let i = 0; i < instructionsList.length; i++) {
                const message = new TransactionMessage({
                    payerKey: signersList[i][0].publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: instructionsList[i],
                }).compileToV0Message((typeof lookupTableAccount !== 'undefined') ? [lookupTableAccount] : []);
                const transaction: VersionedTransaction = new VersionedTransaction(message);
                transaction.sign(signersList[i]);
                transactionList.push(transaction);
            }

            // Serialize the transactions once here
            const serializedTransactionList: string[] = [];
            for (let i = 0; i < transactionList.length; i++) {
                // console.log(bs58.encode(transactionList[i].serialize()).length)
                serializedTransactionList.push(bs58.encode(transactionList[i].serialize()));
            }

            const firstTxsignature = bs58.encode(transactionList[0].signatures[0]);

            // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
            const endpoints = [
                'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
                'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
                'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
                'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
                'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
                'https://slc.mainnet.block-engine.jito.wtf/api/v1/bundles',
            ];

            const client = axios.create({
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false,
                }),
            });

            for (let i = 0; i < 5; i++) {
                const requests = endpoints.map((url) =>
                    client.post(
                        `${url}?uuid=${JITO_UUID}`,
                        {
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'sendBundle',
                            params: [serializedTransactionList],
                        },
                        {
                            proxy: {
                                host: 'dc.oxylabs.io',
                                port: 8000,
                                auth: {
                                    username: `user-${PROXY_LOGIN_USERNAME}`,
                                    password: PROXY_LOGIN_PASSWORD,
                                },
                                protocol: 'https'
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    ));
                const results = await Promise.all(requests.map((p) => p.catch((e) => e)));
                // const results = await Promise.all(requests.map((p) => p.catch((e) => { console.log(e.response.data.error); return e; })));
                const successfulResults = results.filter((result) => !(result instanceof Error));
                if (successfulResults.length > 0) {
                    logger.debug(`confirming... ${tryNumber}/${maxTryNumber}`);
                    return await this.confirm(firstTxsignature, latestBlockhash);
                }
                await sleep(250);
            }

            logger.error(`No successful responses received for jito ${tryNumber}/${maxTryNumber}`);
            return { confirmed: false };
        } catch (error) {
            if (error instanceof AxiosError) {
                logger.trace({ error: error.response?.data }, `Failed to execute jito transaction ${tryNumber}/${maxTryNumber}`);
            }
            logger.error(`Error during transaction execution ${tryNumber}/${maxTryNumber}`);
            // logger.error(error);
            return { confirmed: false };
        }
    }

    private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
        const confirmation = await this.connection.confirmTransaction(
            {
                signature,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                blockhash: latestBlockhash.blockhash,
            },
            this.connection.commitment,
        );
        if (confirmation.value.err) logger.error(confirmation.value.err.toString());
        return { confirmed: !confirmation.value.err, signature };
    }
}