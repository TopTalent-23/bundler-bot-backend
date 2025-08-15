import express from 'express';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import cookieParser from 'cookie-parser';
import { UserModel } from '../models';

const router = express.Router();
router.use(cookieParser());

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

// Create a JWT token for the user
const createToken = async (user: any): Promise<string> => {
    const { SignJWT }: typeof import('jose') = await import('jose');
    
    return await new SignJWT({
        telegramUserId: user.telegramUserId,
        username: user.username,
        evmAddress: user.evmAddress,
        userId: user._id,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(JWT_SECRET);
};

router.get('/login', async (req, res) => {
    const {
        telegramUserId,
    } = req.query;

    if (!telegramUserId) {
        return res.status(400).json({ error: 'Missing required parameter: telegramUserId' });
    }

    try {
        const user = await UserModel.findOne({ telegramUserId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const token = await createToken(user);
        const redirectUrl = "/dashboard"
        if (redirectUrl) {
            const decoded = JSON.parse(Buffer.from(redirectUrl as string, 'base64').toString());
            const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
            const path = (decoded.redirectUrl || '/dashboard').replace(/^\/+/, '/');
            const finalRedirectUrl = `${base}${path}?token=${token}`;

            console.log('Redirecting to:', finalRedirectUrl);
            return res.redirect(finalRedirectUrl);
        }
        res.json({ message: 'Authenticated', token });
    } catch (err) {
        console.error('[LOGIN_ERROR]', err);
        res.status(500).json({ error: 'Internal server error occured' });
    }
});

router.get('/logout', (_req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Logged out' });
});

router.get('/me', async (req, res) => {
    const token = req.cookies?.auth_token;

    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const { jwtVerify }: typeof import('jose') = await import('jose');
        const { payload } = await jwtVerify(token, JWT_SECRET);
        res.json({ user: payload });
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});

export default router;
