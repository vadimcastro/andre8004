import { KmsWallet } from "./kms-signer";

/**
 * Mock implementation of @privy-io/server-auth for testing and hackathon setup.
 * Integrates with KmsWallet underneath to support key management simulation.
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

    // Retrieve custom KMS wallet instance
    const kmsWallet = new KmsWallet({});
    const account = kmsWallet.toViemAccount();

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
          
          // Sign EIP-712 structured hash via the KMS Wallet Account interface
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
