import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { expect, test, describe, beforeAll } from "bun:test";

describe("pentacles-solana", () => {
  // Configure the client to use the local cluster provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load program definition from workspace
  const program = anchor.workspace.PentaclesSolana as Program<any>;

  // Keypairs for the 4 Non-Transferable Token-2022 Mints
  const spiritMint = Keypair.generate();
  const essenceMint = Keypair.generate();
  const matterMint = Keypair.generate();
  const substanceMint = Keypair.generate();

  let gameAuthorityPda: PublicKey;
  let gameAuthorityBump: number;

  beforeAll(() => {
    // Derive the GameAuthority PDA: seeds = [b"game_authority"]
    [gameAuthorityPda, gameAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_authority")],
      program.programId
    );
  });

  test("Initializes 4 Soulbound Token-2022 Element Mints", async () => {
    const tx = await program.methods
      .initializeElementMints()
      .accounts({
        payer: provider.wallet.publicKey,
        gameAuthority: gameAuthorityPda,
        spiritMint: spiritMint.publicKey,
        essenceMint: essenceMint.publicKey,
        matterMint: matterMint.publicKey,
        substanceMint: substanceMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([spiritMint, essenceMint, matterMint, substanceMint])
      .rpc();

    console.log("Initialize Element Mints TX Signature:", tx);

    expect(tx).toBeDefined();
    expect(typeof tx).toBe("string");
  });

  test("Verifies GameAuthority PDA Derivation", () => {
    expect(gameAuthorityPda).toBeInstanceOf(PublicKey);
    expect(gameAuthorityBump).toBeGreaterThanOrEqual(0);
  });
});
