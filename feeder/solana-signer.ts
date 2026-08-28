// ============================================================
// Pentacles — Solana service signer (Cloud KMS or local keypair)
// ============================================================
// The bridge feeder used to read SOLANA_MINTER_SECRET_KEY, a raw 64-byte JSON
// array, and construct a Keypair from it. That is acceptable on devnet and
// disqualifying on mainnet: the secret sits in the process environment, in the
// Railway variable store, in `railway variables` output, and in the heap of
// every worker the supervisor forks.
//
// This module keeps the local path for devnet velocity and adds AWS KMS and GCP
// Cloud KMS asymmetric Ed25519 signing, where the private key never leaves the
// HSM. The guard is deliberately not `NODE_ENV === 'production'` alone: what
// makes a hot key dangerous is the cluster it settles on, so resolving a
// mainnet cluster with a local key is refused outright.
//
// The KMS SDKs are imported dynamically and are optional dependencies — the
// devnet path must not require them to be installed. The client interfaces are
// injectable so the tests exercise both providers without cloud credentials.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export type SignerProvider = "aws" | "gcp" | "local";

export interface SolanaServiceSigner {
  readonly provider: SignerProvider;
  readonly publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
}

/** Minimal shape of `@aws-sdk/client-kms`'s client, so tests can inject a fake. */
export interface AwsKmsClientLike {
  send(command: unknown): Promise<{ Signature?: Uint8Array }>;
}

/** Minimal shape of `@google-cloud/kms`'s client, so tests can inject a fake. */
export interface GcpKmsClientLike {
  asymmetricSign(request: { name: string; data: Uint8Array }): Promise<
    [{ signature?: Uint8Array | string }, ...unknown[]]
  >;
}

export interface KmsSignerConfig {
  provider: SignerProvider;
  keyId: string;
  publicKey: PublicKey;
  awsClient?: AwsKmsClientLike;
  gcpClient?: GcpKmsClientLike;
}

const ED25519_SIGNATURE_BYTES = 64;

/**
 * Serialize the message a signature must cover.
 *
 * The two transaction shapes disagree on which bytes are signed, and getting it
 * wrong produces a well-formed signature that simply fails verification on
 * chain. Legacy transactions sign `serializeMessage()`; v0 transactions sign
 * the compiled `message.serialize()`.
 */
function messageBytes(transaction: Transaction | VersionedTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.message.serialize()
    : transaction.serializeMessage();
}

/**
 * Attach a detached signature to a transaction at the signer's own slot.
 *
 * For v0 transactions the slot matters: `signatures` is positional and parallel
 * to the message's static account keys, so writing index 0 unconditionally
 * corrupts any transaction where the service signer is not the fee payer.
 */
function attachSignature(
  transaction: Transaction | VersionedTransaction,
  publicKey: PublicKey,
  signature: Uint8Array,
): void {
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(`KMS returned a ${signature.length}-byte signature, expected 64`);
  }
  if (transaction instanceof VersionedTransaction) {
    const index = transaction.message.staticAccountKeys.findIndex((key) => key.equals(publicKey));
    if (index < 0) {
      throw new Error(`signer ${publicKey.toBase58()} is not an account of this transaction`);
    }
    transaction.signatures[index] = signature;
    return;
  }
  transaction.addSignature(publicKey, Buffer.from(signature));
}

/** Ed25519 signer backed by AWS KMS or GCP Cloud KMS. */
export class KmsSolanaSigner implements SolanaServiceSigner {
  readonly provider: SignerProvider;
  readonly publicKey: PublicKey;
  private readonly keyId: string;
  private awsClient?: AwsKmsClientLike;
  private gcpClient?: GcpKmsClientLike;

  constructor(config: KmsSignerConfig) {
    this.provider = config.provider;
    this.publicKey = config.publicKey;
    this.keyId = config.keyId;
    this.awsClient = config.awsClient;
    this.gcpClient = config.gcpClient;
  }

  private async aws(): Promise<AwsKmsClientLike> {
    if (!this.awsClient) {
      const { KMSClient } = await import("@aws-sdk/client-kms");
      this.awsClient = new KMSClient({}) as unknown as AwsKmsClientLike;
    }
    return this.awsClient;
  }

  private async gcp(): Promise<GcpKmsClientLike> {
    if (!this.gcpClient) {
      const { KeyManagementServiceClient } = await import("@google-cloud/kms");
      this.gcpClient = new KeyManagementServiceClient() as unknown as GcpKmsClientLike;
    }
    return this.gcpClient;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (this.provider === "aws") {
      const client = await this.aws();
      const { SignCommand } = await import("@aws-sdk/client-kms");
      const response = await client.send(
        new SignCommand({
          KeyId: this.keyId,
          Message: message,
          MessageType: "RAW",
          SigningAlgorithm: "ED25519",
        }),
      );
      if (!response.Signature) throw new Error("AWS KMS returned no signature");
      return Uint8Array.from(response.Signature);
    }
    if (this.provider === "gcp") {
      const client = await this.gcp();
      const [response] = await client.asymmetricSign({ name: this.keyId, data: message });
      const signature = response?.signature;
      if (!signature) throw new Error("GCP KMS returned no signature");
      return typeof signature === "string"
        ? Uint8Array.from(Buffer.from(signature, "base64"))
        : Uint8Array.from(signature);
    }
    throw new Error(`KmsSolanaSigner cannot sign with provider ${this.provider}`);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    const signature = await this.signMessage(messageBytes(transaction));
    attachSignature(transaction, this.publicKey, signature);
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    const signed: T[] = [];
    for (const transaction of transactions) signed.push(await this.signTransaction(transaction));
    return signed;
  }
}

/** Ed25519 signer holding a keypair in process memory. Never valid on mainnet. */
export class LocalSolanaSigner implements SolanaServiceSigner {
  readonly provider: SignerProvider = "local";
  readonly keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { sign } = await import("tweetnacl");
    return sign.detached(message, this.keypair.secretKey);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (transaction instanceof VersionedTransaction) transaction.sign([this.keypair]);
    else transaction.partialSign(this.keypair);
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    for (const transaction of transactions) await this.signTransaction(transaction);
    return transactions;
  }
}

function parseSecretKey(raw: string): Keypair {
  const bytes = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("SOLANA_MINTER_SECRET_KEY must be a JSON array of 64 bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/** Resolve a local keypair from the environment or the CLI's default wallet. */
export async function localSignerFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalSolanaSigner> {
  const raw = env.SOLANA_MINTER_SECRET_KEY;
  if (raw) return new LocalSolanaSigner(parseSecretKey(raw));
  const walletPath = env.SOLANA_WALLET_PATH || join(homedir(), ".config", "solana", "id.json");
  try {
    return new LocalSolanaSigner(parseSecretKey(await readFile(walletPath, "utf8")));
  } catch {
    throw new Error(
      `No Solana signer configured: set AWS_KMS_KEY_ID, GCP_KMS_KEY_NAME or SOLANA_MINTER_SECRET_KEY (no readable keypair at ${walletPath})`,
    );
  }
}

export interface ResolveSignerOptions {
  env?: NodeJS.ProcessEnv;
  /** CAIP-2 id of the cluster this signer will settle on. */
  caip2?: string;
  awsClient?: AwsKmsClientLike;
  gcpClient?: GcpKmsClientLike;
}

/**
 * Resolve the signer this service should use.
 *
 * Refuses a local keypair whenever the target cluster is mainnet or NODE_ENV is
 * production — the two conditions that make an in-memory secret a real loss.
 * Everywhere else it falls back to the local key with a warning so devnet work
 * needs no cloud credentials.
 */
export async function getSolanaServiceSigner(
  options: ResolveSignerOptions = {},
): Promise<SolanaServiceSigner> {
  const env = options.env ?? process.env;
  const awsKeyId = env.AWS_KMS_KEY_ID?.trim();
  const gcpKeyName = env.GCP_KMS_KEY_NAME?.trim();
  const publicKeyText = env.SOLANA_SERVICE_PUBLIC_KEY?.trim();

  if (awsKeyId || gcpKeyName) {
    if (!publicKeyText) {
      throw new Error(
        "SOLANA_SERVICE_PUBLIC_KEY must be set alongside a KMS key id — KMS signs but does not reveal the Solana address",
      );
    }
    return new KmsSolanaSigner({
      provider: awsKeyId ? "aws" : "gcp",
      keyId: (awsKeyId || gcpKeyName)!,
      publicKey: new PublicKey(publicKeyText),
      awsClient: options.awsClient,
      gcpClient: options.gcpClient,
    });
  }

  const mainnet = options.caip2 === "solana:mainnet-beta";
  if (mainnet || env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to sign with an in-memory keypair: set AWS_KMS_KEY_ID or GCP_KMS_KEY_NAME " +
        `(cluster=${options.caip2 ?? "unset"}, NODE_ENV=${env.NODE_ENV ?? "unset"}). ` +
        "SOLANA_MINTER_SECRET_KEY is a devnet-only convenience.",
    );
  }

  const signer = await localSignerFromEnvironment(env);
  console.warn(
    `[signer] using an in-memory keypair (${signer.publicKey.toBase58()}) — devnet only, never mainnet.`,
  );
  return signer;
}

export default { KmsSolanaSigner, LocalSolanaSigner, getSolanaServiceSigner };
