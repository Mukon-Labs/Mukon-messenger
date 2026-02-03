// Backend configuration
// Change this based on your environment:
// - Local WiFi: Use your host machine's IP (check with `ifconfig` or `ipconfig`)
// - Production: Use Fly.io or other hosted URL
// - Emulator: Use 10.0.2.2:3001

export const BACKEND_URL = __DEV__
  ? 'https://backend-rough-bird-7310.fly.dev'  // Use Fly.io for testing
  : 'https://backend-rough-bird-7310.fly.dev';  // Production URL

// Solana RPC configuration
// Using Helius for reliable devnet access (free tier: 1M credits/day)
export const SOLANA_RPC_URL = 'https://devnet.helius-rpc.com/?api-key=0815e357-862c-4209-bdbe-2329e2e032d5';

// Light Protocol RPC (wraps Helius for ZK Compression support)
import { createRpc, featureFlags } from '@lightprotocol/stateless.js';

// Enable V2 beta features for Light Protocol
featureFlags.enableBeta();

// Note: Let SDK auto-detect version instead of forcing V2
// The Rust program uses V2 but the client-side SDK will negotiate

export const lightRpc = createRpc(SOLANA_RPC_URL, SOLANA_RPC_URL);

// Quick reference:
// Home WiFi example: 'http://192.168.1.33:3001'
// Office WiFi example: 'http://10.0.0.100:3001'
// Android Emulator: 'http://10.0.2.2:3001'
// ngrok tunnel: 'https://abc123.ngrok.io'
