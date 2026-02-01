// Backend configuration
// Change this based on your environment:
// - Local WiFi: Use your host machine's IP (check with `ifconfig` or `ipconfig`)
// - Production: Use Fly.io or other hosted URL
// - Emulator: Use 10.0.2.2:3001

export const BACKEND_URL = __DEV__
  ? 'http://192.168.68.61:3001'  // Cowork WiFi IP
  : 'https://backend-rough-bird-7310.fly.dev';  // Production URL

// Solana RPC configuration
// Using Helius for reliable devnet access (free tier: 1M credits/day)
export const SOLANA_RPC_URL = 'https://devnet.helius-rpc.com/?api-key=0815e357-862c-4209-bdbe-2329e2e032d5';

// Quick reference:
// Home WiFi example: 'http://192.168.1.33:3001'
// Office WiFi example: 'http://10.0.0.100:3001'
// Android Emulator: 'http://10.0.2.2:3001'
// ngrok tunnel: 'https://abc123.ngrok.io'
