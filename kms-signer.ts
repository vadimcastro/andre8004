import { getAddress, keccak256, hashTypedData, hashMessage, serializeSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Interface for signing results
interface SignatureResponse {
  r: `0x${string}`;
  s: `0x${string}`;
  v: bigint;
}

/**
 * Parses DER-encoded signature returned from KMS into EVM-compatible r and s parameters.
 * DER format: 0x30 <len> 0x02 <len_r> <r> 0x02 <len_s> <s>
 */
function parseDERSignature(derBuffer: Buffer): { r: `0x${string}`; s: `0x${string}` } {
  let offset = 0;

  if (derBuffer[offset++] !== 0x30) throw new Error("Invalid DER signature format");
  const length = derBuffer[offset++];

  if (derBuffer[offset++] !== 0x02) throw new Error("Invalid DER signature R element");
  const rLength = derBuffer[offset++];
  let rStart = offset;
  offset += rLength;

  if (derBuffer[offset++] !== 0x02) throw new Error("Invalid DER signature S element");
  const sLength = derBuffer[offset++];
  let sStart = offset;

  // Trim leading zero bytes if R or S are padded
  let rBuffer = derBuffer.subarray(rStart, rStart + rLength);
  if (rBuffer[0] === 0x00) rBuffer = rBuffer.subarray(1);

  let sBuffer = derBuffer.subarray(sStart, sStart + sLength);
  if (sBuffer[0] === 0x00) sBuffer = sBuffer.subarray(1);

  // Pad to 32 bytes
  const rHex = Buffer.concat([Buffer.alloc(32 - rBuffer.length), rBuffer]).toString("hex");
  const sHex = Buffer.concat([Buffer.alloc(32 - sBuffer.length), sBuffer]).toString("hex");

  return {
    r: `0x${rHex}`,
    s: `0x${sHex}`
  };
}

/**
 * KMS Wallet Signer Class
 * Supports Local Decrypted Key simulation and Production AWS KMS hardware signing.
 */
export class KmsWallet {
  private keyId?: string;
  private localAccount?: any;
  private awsKmsClient?: any;
  public address: `0x${string}`;

  constructor(config: { keyId?: string; localPrivateKey?: `0x${string}` }) {
    this.keyId = config.keyId || process.env.KMS_KEY_ID;

    if (this.keyId) {
      console.log(`[KMS Wallet] Initializing in production hardware signing mode (Key ID: ${this.keyId})`);
      // Lazy load AWS SDK to avoid forcing installation in local dev environments
      try {
        const { KMSClient } = require("@aws-sdk/client-kms");
        this.awsKmsClient = new KMSClient({ region: process.env.AWS_REGION || "us-east-1" });
      } catch (err) {
        throw new Error("AWS KMS SDK (@aws-sdk/client-kms) not installed. Run 'bun add @aws-sdk/client-kms' to use live KMS mode.");
      }
      
      // Load public key and derive address (placeholder for live AWS pubkey derivation)
      const kmsAddress = process.env.KMS_WALLET_ADDRESS;
      if (!kmsAddress) {
        throw new Error("Production KMS Mode requires KMS_WALLET_ADDRESS to be defined in .env to map the public key.");
      }
      this.address = getAddress(kmsAddress);
    } else {
      console.log(`[KMS Wallet] ⚠️ WARNING: Running in Local Dev Mode. Private keys should be encrypted in production.`);
      const privateKey = config.localPrivateKey || (process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
      if (!privateKey || !privateKey.startsWith("0x")) {
        throw new Error("Local Dev Mode requires a valid DEPLOYER_PRIVATE_KEY in .env");
      }
      this.localAccount = privateKeyToAccount(privateKey);
      this.address = getAddress(this.localAccount.address);
    }
  }

  /**
   * Helper to sign a 32-byte hash digest.
   * If KMS is active, sends to AWS HSM. If Local, signs via privateKeyToAccount.
   */
  private async signDigest(digest: `0x${string}`): Promise<`0x${string}`> {
    if (this.keyId && this.awsKmsClient) {
      const { SignCommand } = require("@aws-sdk/client-kms");
      const messageBuffer = Buffer.from(digest.slice(2), "hex");

      const command = new SignCommand({
        KeyId: this.keyId,
        Message: messageBuffer,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256"
      });

      const response = await this.awsKmsClient.send(command);
      const derSignature = Buffer.from(response.Signature);
      const { r, s } = parseDERSignature(derSignature);

      // Solve the EIP-155 recovery parameter 'v' (check 27 or 28)
      // Since KMS does not return the recovery parameter 'v', we must recover the signer address
      // and check which 'v' value correctly yields our derived KMS address.
      const { recoverAddress } = require("viem");
      let v = 27n;
      const sig27 = serializeSignature({ r, s, v });
      const recovered27 = await recoverAddress({ hash: digest, signature: sig27 });

      if (recovered27.toLowerCase() !== this.address.toLowerCase()) {
        v = 28n;
      }

      return serializeSignature({ r, s, v });
    } else {
      // Dev mode: sign locally
      return this.localAccount.sign({ hash: digest });
    }
  }

  /**
   * Exports a custom Viem LocalAccount interface matching toAccount() spec
   */
  public toViemAccount() {
    return {
      address: this.address,
      publicKey: "0x" as `0x${string}`, // Not strictly needed for transaction signing
      source: "custom-kms",
      type: "local" as const,
      signMessage: async ({ message }: { message: string }) => {
        const digest = hashMessage(message);
        return this.signDigest(digest);
      },
      signTransaction: async (transaction: any, { serializer }: { serializer?: any } = {}) => {
        // Local signing is required for transaction payloads before broadcast
        if (this.localAccount) {
          return this.localAccount.signTransaction(transaction, { serializer });
        }
        throw new Error("On-chain transaction signing with live KMS requires full RLP serialization helper integration.");
      },
      signTypedData: async ({ domain, types, primaryType, message }: any) => {
        const digest = hashTypedData({ domain, types, primaryType, message });
        return this.signDigest(digest);
      }
    };
  }
}
