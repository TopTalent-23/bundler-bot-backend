// src/config/solana.ts
import { Connection, clusterApiUrl } from '@solana/web3.js';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');

// ✅ Single connection shared project-wide
export const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
