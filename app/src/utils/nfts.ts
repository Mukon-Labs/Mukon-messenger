import { SOLANA_RPC_URL } from '../config';

export interface NFTAsset {
  mint: string;
  name: string;
  imageUrl: string;
}

// In-memory cache for NFT image URLs
const imageCache = new Map<string, string>();

export async function fetchWalletNFTs(
  rpcUrl: string,
  walletPubkey: string,
): Promise<NFTAsset[]> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-nfts',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletPubkey,
          page: 1,
          limit: 100,
          displayOptions: { showFungible: false },
        },
      }),
    });

    const data = await response.json();
    if (!data.result?.items) return [];

    const nfts: NFTAsset[] = [];
    for (const item of data.result.items) {
      // Filter to NFTs only (not fungible, not compressed fungible)
      if (item.interface !== 'V1_NFT' && item.interface !== 'ProgrammableNFT') continue;

      const imageUrl =
        item.content?.links?.image ||
        item.content?.files?.[0]?.uri ||
        '';

      if (!imageUrl) continue;

      const mint = item.id;
      const name = item.content?.metadata?.name || 'Unknown NFT';

      imageCache.set(mint, imageUrl);
      nfts.push({ mint, name, imageUrl });
    }

    return nfts;
  } catch (err) {
    console.error('Failed to fetch wallet NFTs:', err);
    return [];
  }
}

export async function fetchNFTImage(
  rpcUrl: string,
  mint: string,
): Promise<string | null> {
  // Check cache first
  const cached = imageCache.get(mint);
  if (cached) return cached;

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-asset',
        method: 'getAsset',
        params: { id: mint },
      }),
    });

    const data = await response.json();
    const imageUrl =
      data.result?.content?.links?.image ||
      data.result?.content?.files?.[0]?.uri ||
      null;

    if (imageUrl) {
      imageCache.set(mint, imageUrl);
    }
    return imageUrl;
  } catch (err) {
    console.error('Failed to fetch NFT image:', err);
    return null;
  }
}
