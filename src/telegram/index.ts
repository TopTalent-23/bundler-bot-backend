import TelegramBot from 'node-telegram-bot-api';
import { customSendPhotoMessage, logger } from '../utils';
import { UserModel } from '../models';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { TELEGRAM_BOT_TOKEN } from '../config';

export class TelegramLoginBot {

    bot: TelegramBot;
    constructor() {
        this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    }

    start = () => {
        this.botInitialize();
        this.bot.startPolling();
    }

    botInitialize = () => {
        this.bot.on('polling_error', (error) => {
            logger.error(error.name);
        })

        //command
        this.bot.onText(/.*/, async (msg: TelegramBot.Message) => {
            const command = msg.text; if (!command) return;
            if (command == '/start') {
                let user = await UserModel.findOne({ telegramUserId: msg.chat.id });
                if (!user) {
                    const solanaWallet: Keypair = Keypair.generate();
                    const fundWallet: Keypair = Keypair.generate();
                    const devWallet: Keypair = Keypair.generate();

                    const newUser = new UserModel({
                        telegramUserId: msg.chat.id,
                        username: msg.chat.username,
                        solanaWallet: {
                            publicKey: solanaWallet.publicKey.toString(),
                            privateKey: bs58.encode(solanaWallet.secretKey),
                        },
                        fundWallet: {
                            publicKey: fundWallet.publicKey.toString(),
                            privateKey: bs58.encode(fundWallet.secretKey),
                        },
                        devWallet: {
                            publicKey: devWallet.publicKey.toString(),
                            privateKey: bs58.encode(devWallet.secretKey),
                        },
                        subWalletList: {
                            publicKeyList: '["SUB_PUB_1", "SUB_PUB_2"]',
                            privateKeyList: '["SUB_PRIV_1", "SUB_PRIV_2"]',
                        },
                        language: 'en',
                    });

                    user = await newUser.save();
                }
                
                const loginUrl = `https://solana-bundler-gamma.vercel.app/auth/complete?telegramUserId=${msg.chat.id}`;
                const text = '👋 Welcome to the <b>SOLARBA BUNDLER BOT</b>.\n\nClick below to log in:';
                const inlineButtons = [
                        [{ text: '📲 Login', url: loginUrl }]
                    ];
                await customSendPhotoMessage('land.jpg', this.bot, msg, text, inlineButtons);
                return;
            }
            return;
        })

    }
}