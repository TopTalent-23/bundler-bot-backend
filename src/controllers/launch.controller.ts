// src/controllers/launch.controller.ts

import { Request, Response } from 'express';
import { createTokenAndBuyBundles } from '../services';

export const launchToken = async (req: Request, res: Response) => {
    try {
        console.log(req.body)
        const { telegramId, platform, name, symbol, description, socials, devWalletBuySolAmount, subWalletBuySolAmountList } = req.body;

        if (!telegramId || !platform || !name || !symbol || !description || !devWalletBuySolAmount || !subWalletBuySolAmountList) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Call your service to handle business logic
        const result = await createTokenAndBuyBundles({
            telegramId,
            platform,
            name,
            symbol,
            description,
            socials,
            devWalletBuySolAmount,
            subWalletBuySolAmountList
        });

        res.status(201).json({ message: 'Token launched successfully', data: result });
    } catch (error) {
        console.error('Launch token error:', error);

        // Type guard to safely access error.message
        if (error instanceof Error) {
            return res.status(400).json({ error: error.message });
        }

        // Fallback in case it's not a standard Error object
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
