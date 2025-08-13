import {
    BlockhashWithExpiryBlockHeight,
    Keypair,
    PublicKey,
    SystemProgram,
    Connection,
    TransactionMessage,
    VersionedTransaction,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import axios, { AxiosError } from 'axios';
import https from 'https';
import bs58 from 'bs58';
import { logger, sleep } from '../utils';
import { JITO_UUID, PROXY_LOGIN_USERNAME, PROXY_LOGIN_PASSWORD } from '../config/jito';

export class JitoTransactionExecutor {
    // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/bundles/gettipaccounts
    private jitpTipAccounts = [
        'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
        'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
        '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
        'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
        'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
        'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
        'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    ];
    private JitoFeeWallet: PublicKey;

    constructor(
        private readonly jitoFee: number,
        private readonly connection: Connection,
    ) {
        this.JitoFeeWallet = this.getRandomValidatorKey();

    }

    private getRandomValidatorKey(): PublicKey {
        const randomValidator = this.jitpTipAccounts[Math.floor(Math.random() * this.jitpTipAccounts.length)];
        return new PublicKey(randomValidator);
    }

    public async executeAndConfirm(
        transactionList: VersionedTransaction[],
        payer: Keypair,
        latestBlockhash: BlockhashWithExpiryBlockHeight,
    ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
        this.JitoFeeWallet = this.getRandomValidatorKey(); // Update wallet key each execution

        try {
            const fee = Math.floor(this.jitoFee * LAMPORTS_PER_SOL)

            const jitTipTxFeeMessage = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: this.JitoFeeWallet,
                        lamports: fee,
                    }),
                ],
            }).compileToV0Message();

            const jitoFeeTx = new VersionedTransaction(jitTipTxFeeMessage);
            jitoFeeTx.sign([payer]);
            const jitoTxsignature = bs58.encode(jitoFeeTx.signatures[0]);

            // Serialize the transactions once here
            const serializedjitoFeeTx = bs58.encode(jitoFeeTx.serialize());
            let serializedTransactions = [serializedjitoFeeTx];
            for (let i = 0; i < transactionList.length; i++) {
                serializedTransactions.push(bs58.encode(transactionList[i].serialize()));
            }

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
                            params: [serializedTransactions],
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
                const successfulResults = results.filter((result) => !(result instanceof Error));
                if (successfulResults.length > 0) {
                    logger.debug(`confirming...`);
                    return await this.confirm(jitoTxsignature, latestBlockhash);
                }
                await sleep(250);
            }

            logger.error(`No successful responses received for jito`);
            return { confirmed: false };

        } catch (error) {
            if (error instanceof AxiosError) {
                logger.trace({ error: error.response?.data }, 'Failed to execute jito transaction');
            }
            logger.error('Error during transaction execution', error);
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
