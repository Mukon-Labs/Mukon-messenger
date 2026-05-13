// Backend configuration
export const BACKEND_URL = 'https://backend-rough-bird-7310.fly.dev';

// Cluster: switch to 'mainnet-beta' for production launch
// When switching: update HELIUS_MAINNET_KEY and redeploy program, then update PROGRAM_ID in transactions.ts
export const CLUSTER: 'devnet' | 'mainnet-beta' = 'devnet';

// Helius API keys — ROTATE BEFORE PUBLIC RELEASE (currently committed to git)
// Get keys at: https://dev.helius.xyz/
const HELIUS_DEVNET_KEY = '0815e357-862c-4209-bdbe-2329e2e032d5';
const HELIUS_MAINNET_KEY = ''; // TODO: add mainnet key

export const SOLANA_RPC_URL = CLUSTER === 'mainnet-beta'
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_MAINNET_KEY}`
  : `https://devnet.helius-rpc.com/?api-key=${HELIUS_DEVNET_KEY}`;

// Metered.ca TURN server — ROTATE BEFORE PUBLIC RELEASE
export const METERED_API_KEY = '807cc8a2e11bdea7a30afada05538b62f797';
export const METERED_APP = 'mukonmessenger';

// Light Protocol RPC (wraps Helius for ZK Compression support)
// V2 Architecture: 6-account CPI structure with CPI signer PDA
import { createRpc, featureFlags } from '@lightprotocol/stateless.js';

featureFlags.enableBeta();

// Note: Compressed operations disabled on devnet due to infrastructure limitations.
// Set USE_ZK_COMPRESSION = true in MessengerContext when deploying to mainnet.
export const lightRpc = createRpc(SOLANA_RPC_URL, SOLANA_RPC_URL);
