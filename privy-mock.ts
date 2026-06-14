import { privateKeyToAccount } from "viem/accounts";

/**
 * Mock implementation of @privy-io/server-auth for testing and hackathon setup.
 * Uses viem's privateKeyToAccount underneath to generate real, verifiable cryptographic signatures.
 */
export class PrivyClient {
  appId: string;
  appSecret: string;
  
  walletApi: {
    ethereum: {
      create: (params?: { id?: string }) => Promise<{ id: string; address: string; chainType: string }>;
      signTypedData: (params: { address: string; typedData: any }) => Promise<`0x${string}`>;
    }
  };

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;

    // Retrieve private key from dotenv setup (created via .env script)
    const envKey = process.env.DEPLOYER_PRIVATE_KEY;
    const privateKey = envKey && envKey.startsWith("0x") ? (envKey as `0x${string}`) : undefined;
    
    // Fallback to standard local development key if environment variable is not defined
    const account = privateKey 
      ? privateKeyToAccount(privateKey)
      : privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

    this.walletApi = {
      ethereum: {
        create: async (params?: { id?: string }) => {
          return {
            id: params?.id || "mock-privy-wallet-id",
            address: account.address,
            chainType: "ethereum"
          };
        },
        signTypedData: async (params: { address: string; typedData: any }) => {
          if (params.address.toLowerCase() !== account.address.toLowerCase()) {
            throw new Error(`Address ${params.address} is not managed by this Privy client instance.`);
          }
          
          // Construct EIP-712 structured hash and sign it using viem
          const { domain, types, message, primaryType } = params.typedData;
          const signature = await account.signTypedData({
            domain,
            types,
            primaryType,
            message
          });
          return signature;
        }
      }
    };
  }
}
