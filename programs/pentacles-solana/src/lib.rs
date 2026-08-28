// ============================================================
// pentacles_solana — game custody on Solana
// ============================================================
// ESMS issuance lives in AlchmAgentsSolana (`asol_program`,
// 5QheuqaicKvPPRFEoEXwaE5xaFp7gauvJCfsjpQv8WzD), which is the sole issuer of
// all four elemental Token-2022 mints on every Solana cluster. This program no
// longer mints, burns or slashes ESMS.
//
// Why the issuance instructions were removed rather than kept alongside ASOL's:
//
//   • Decimals. These mints were created at 18 decimals against a u64 amount
//     field, capping one token account at (2^64-1)/10^18 ≈ 18.45 ESMS and making
//     any larger bridge transfer unrepresentable. ASOL issues at 4 decimals.
//     Two live "ESMS" tokens at different scales is an accounting incident
//     waiting for its first reconciliation.
//
//   • Extensions. ASOL's mints carry NonTransferable, PermissionedBurn,
//     PermanentDelegate and MetadataPointer. These carried none — so
//     `slash_cheater` named the game authority a Permanent Delegate on mints
//     that had no such extension, and would have failed on any real attempt.
//
// The devnet mints created by the retired instructions are abandoned in place,
// matching the ASOL Phase 4 devnet divergence policy. See
// docs/SOLANA_MAINNET_CONFORMANCE.md for the cutover order.
//
// What remains is game custody that is genuinely Pentacles': the StarVault USDC
// pool and the starUSDC transfer hook.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R");

/// USDC is 6-decimal; the yield rate is quoted per whole USDC per day.
const USDC_UNITS_PER_TOKEN: u128 = 1_000_000;
const SECONDS_PER_DAY: u128 = 86_400;

#[program]
pub mod pentacles_solana {
    use super::*;

    /// Initialize the global game authority. Holds the admin key and the star
    /// activation Merkle root; it is the StarVault's transfer authority.
    pub fn initialize_game_authority(ctx: Context<InitializeGameAuthority>) -> Result<()> {
        let auth = &mut ctx.accounts.game_authority;
        auth.authority = ctx.accounts.payer.key();
        auth.usdc_mint = ctx.accounts.usdc_mint.key();
        auth.star_root = [0u8; 32];
        auth.max_rate_atoms_per_usdc_day = 0;
        auth.total_principal = 0;
        auth.bump = ctx.bumps.game_authority;
        msg!("Pentacles game authority initialized for USDC mint {}.", auth.usdc_mint);
        Ok(())
    }

    /// Set the star-activation Merkle root and the yield rate ceiling.
    ///
    /// The rate is an upper bound on accrual, not the accrual itself: the
    /// authoritative per-star rate is astronomical (altitude, dignity, zone
    /// dominance) and is computed off-chain. This ceiling is what bounds a
    /// compromised attestor's maximum claim, so it belongs on chain.
    pub fn configure_star_vault(
        ctx: Context<ConfigureStarVault>,
        star_root: [u8; 32],
        max_rate_atoms_per_usdc_day: u64,
    ) -> Result<()> {
        let auth = &mut ctx.accounts.game_authority;
        auth.star_root = star_root;
        auth.max_rate_atoms_per_usdc_day = max_rate_atoms_per_usdc_day;
        msg!(
            "StarVault configured: rate ceiling {} ESMS atoms per USDC per day.",
            max_rate_atoms_per_usdc_day
        );
        Ok(())
    }

    /// Open a star's pool after proving the star is in the activation set.
    ///
    /// The proof is over a single `u32` star id, hashed with the OpenZeppelin
    /// StandardMerkleTree leaf convention (double keccak of the abi-encoded
    /// value) so the same tree serves the EVM side without a second build.
    pub fn activate_star(
        ctx: Context<ActivateStar>,
        star_id: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let root = ctx.accounts.game_authority.star_root;
        require!(root != [0u8; 32], ErrorCode::StarRootUnset);
        require!(
            verify_star_proof(star_id, &proof, root),
            ErrorCode::InvalidStarProof
        );

        let pool = &mut ctx.accounts.star_pool;
        pool.star_id = star_id;
        pool.activated = true;
        pool.total_principal = 0;
        pool.total_shares = 0;
        pool.bump = ctx.bumps.star_pool;

        emit!(StarActivated { star_id, timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    /// Stake USDC into a star's vault.
    ///
    /// The position is checkpointed *before* principal changes. Without that
    /// step a staker could hold a small position for a month, top it up
    /// immediately before claiming, and be credited a month of yield on capital
    /// that was deposited seconds ago. Checkpointing first freezes the elapsed
    /// interval against the old principal, which is the only amount that
    /// actually earned it.
    pub fn stake_star_usdc(ctx: Context<StakeStarUsdc>, star_id: u32, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.star_pool.activated, ErrorCode::StarNotActivated);

        let now = Clock::get()?.unix_timestamp;
        let rate = ctx.accounts.game_authority.max_rate_atoms_per_usdc_day;

        let position = &mut ctx.accounts.stake_position;
        if position.staker == Pubkey::default() {
            position.staker = ctx.accounts.staker.key();
            position.star_id = star_id;
            position.last_checkpoint = now;
            position.bump = ctx.bumps.stake_position;
        }
        checkpoint_position(position, rate, now)?;

        // Measure the net balance delta rather than trusting `amount`: a mint
        // carrying the TransferFee extension delivers less than was sent, and
        // crediting the requested amount would book principal the vault never
        // received.
        let pre = ctx.accounts.vault_token_account.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.staker_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )?;
        ctx.accounts.vault_token_account.reload()?;
        let net = ctx
            .accounts
            .vault_token_account
            .amount
            .checked_sub(pre)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(net > 0, ErrorCode::InvalidAmount);

        // Shares track principal one-for-one. The pool distributes no principal
        // yield, so there is no exchange rate to drift and no rounding to
        // exploit; yield is minted from a separate ESMS supply against the cap.
        position.principal = position
            .principal
            .checked_add(net)
            .ok_or(ErrorCode::MathOverflow)?;
        position.shares = position
            .shares
            .checked_add(net)
            .ok_or(ErrorCode::MathOverflow)?;

        let pool = &mut ctx.accounts.star_pool;
        pool.total_principal = pool
            .total_principal
            .checked_add(net)
            .ok_or(ErrorCode::MathOverflow)?;
        pool.total_shares = pool
            .total_shares
            .checked_add(net)
            .ok_or(ErrorCode::MathOverflow)?;

        let auth = &mut ctx.accounts.game_authority;
        auth.total_principal = auth
            .total_principal
            .checked_add(net)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(StarStaked {
            staker: ctx.accounts.staker.key(),
            star_id,
            principal_usdc: net,
            position_principal: position.principal,
            pool_principal: pool.total_principal,
            timestamp: now,
        });
        Ok(())
    }

    /// Withdraw staked USDC.
    ///
    /// Deliberately unconditional — no pause flag, no admin gate, no activation
    /// requirement. The previous revision of this program had no withdrawal
    /// path at all, which made every USDC transferred into a star vault
    /// permanently unrecoverable on chain. A custody program that can take
    /// deposits must always be able to return them.
    pub fn unstake_star_usdc(ctx: Context<UnstakeStarUsdc>, star_id: u32, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        let rate = ctx.accounts.game_authority.max_rate_atoms_per_usdc_day;
        let authority_bump = ctx.accounts.game_authority.bump;

        let position = &mut ctx.accounts.stake_position;
        require!(position.principal >= amount, ErrorCode::InsufficientPrincipal);
        checkpoint_position(position, rate, now)?;

        position.principal -= amount;
        position.shares = position.shares.saturating_sub(amount);

        let pool = &mut ctx.accounts.star_pool;
        pool.total_principal = pool.total_principal.saturating_sub(amount);
        pool.total_shares = pool.total_shares.saturating_sub(amount);

        let bump_seed = [authority_bump];
        let seeds = &[b"game_authority".as_ref(), &bump_seed];
        let signer = [&seeds[..]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.staker_token_account.to_account_info(),
                    authority: ctx.accounts.game_authority.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                },
                &signer,
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let auth = &mut ctx.accounts.game_authority;
        auth.total_principal = auth.total_principal.saturating_sub(amount);

        emit!(StarUnstaked {
            staker: ctx.accounts.staker.key(),
            star_id,
            principal_usdc: amount,
            position_principal: position.principal,
            accrued_cap: position.accrued_cap,
            timestamp: now,
        });
        Ok(())
    }

    /// Initialize the ExtraAccountMetaList PDA required by the SPL Transfer Hook standard.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let account_infos = ctx.accounts.to_account_infos();
        let mut account_info_iter = account_infos.iter();
        let extra_account_meta_list_info = next_account_info(&mut account_info_iter)?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut extra_account_meta_list_info.try_borrow_mut_data()?,
            &[],
        )?;

        msg!("ExtraAccountMetaList PDA initialized for starUSDC Transfer Hook.");
        Ok(())
    }

    /// Token-2022 Transfer Hook: observe starUSDC LST transfers so the ledger can
    /// re-attribute the underlying stake to its new holder.
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        emit!(StarStakeTransferred {
            from_wallet: ctx.accounts.source_token.owner,
            to_wallet: ctx.accounts.destination_token.owner,
            token_amount: amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// ── Yield checkpointing ─────────────────────────────────────────────────────

/// Credit the interval since the last checkpoint against the principal that was
/// staked for it, then move the checkpoint forward.
///
/// All arithmetic goes through `u128` and every step is checked. The inputs are
/// a u64 principal, a u64 rate and an i64 duration; their product overflows u64
/// for entirely ordinary values, so widening is required for correctness, not
/// caution.
fn checkpoint_position(
    position: &mut StakePosition,
    max_rate_atoms_per_usdc_day: u64,
    now: i64,
) -> Result<()> {
    let elapsed = now.saturating_sub(position.last_checkpoint);
    if elapsed <= 0 {
        // A backwards clock must not rewind the checkpoint; move it forward only.
        position.last_checkpoint = now.max(position.last_checkpoint);
        return Ok(());
    }
    if position.principal > 0 && max_rate_atoms_per_usdc_day > 0 {
        let gained = (position.principal as u128)
            .checked_mul(max_rate_atoms_per_usdc_day as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(elapsed as u128)
            .ok_or(ErrorCode::MathOverflow)?
            / (USDC_UNITS_PER_TOKEN * SECONDS_PER_DAY);
        position.accrued_cap = position
            .accrued_cap
            .checked_add(u64::try_from(gained).map_err(|_| ErrorCode::MathOverflow)?)
            .ok_or(ErrorCode::MathOverflow)?;
    }
    position.last_checkpoint = now;
    Ok(())
}

/// OpenZeppelin `StandardMerkleTree` verification for a single `uint32` leaf.
///
/// The leaf is `keccak256(keccak256(abi.encode(uint32)))` — the double hash is
/// what makes an internal node impossible to present as a leaf — and sibling
/// pairs are sorted before hashing, matching the library's default.
fn verify_star_proof(star_id: u32, proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    let mut encoded = [0u8; 32];
    encoded[28..32].copy_from_slice(&star_id.to_be_bytes());
    let mut computed = keccak_hash(&keccak_hash(&encoded));

    for sibling in proof {
        computed = if computed <= *sibling {
            keccak_hash(&[computed.as_ref(), sibling.as_ref()].concat())
        } else {
            keccak_hash(&[sibling.as_ref(), computed.as_ref()].concat())
        };
    }
    computed == root
}

fn keccak_hash(data: &[u8]) -> [u8; 32] {
    anchor_lang::solana_program::keccak::hash(data).to_bytes()
}

// ── State ───────────────────────────────────────────────────────────────────

#[account]
pub struct GameAuthority {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub star_root: [u8; 32],
    pub max_rate_atoms_per_usdc_day: u64,
    pub total_principal: u64,
    pub bump: u8,
}

impl GameAuthority {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct StarPool {
    pub star_id: u32,
    pub activated: bool,
    pub total_principal: u64,
    pub total_shares: u64,
    pub bump: u8,
}

impl StarPool {
    pub const LEN: usize = 8 + 4 + 1 + 8 + 8 + 1;
}

#[account]
pub struct StakePosition {
    pub staker: Pubkey,
    pub star_id: u32,
    pub shares: u64,
    pub principal: u64,
    /// ESMS atoms (4-dp, ASOL scale) this position is entitled to claim.
    pub accrued_cap: u64,
    pub last_checkpoint: i64,
    pub claim_nonce: u64,
    pub bump: u8,
}

impl StakePosition {
    pub const LEN: usize = 8 + 32 + 4 + 8 + 8 + 8 + 8 + 8 + 1;
}

// ── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeGameAuthority<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = GameAuthority::LEN,
        seeds = [b"game_authority"],
        bump
    )]
    pub game_authority: Account<'info, GameAuthority>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureStarVault<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game_authority"],
        bump = game_authority.bump,
        has_one = authority
    )]
    pub game_authority: Account<'info, GameAuthority>,
}

#[derive(Accounts)]
#[instruction(star_id: u32)]
pub struct ActivateStar<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"game_authority"],
        bump = game_authority.bump
    )]
    pub game_authority: Account<'info, GameAuthority>,

    #[account(
        init,
        payer = payer,
        space = StarPool::LEN,
        seeds = [b"star_pool", star_id.to_le_bytes().as_ref()],
        bump
    )]
    pub star_pool: Account<'info, StarPool>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(star_id: u32)]
pub struct StakeStarUsdc<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game_authority"],
        bump = game_authority.bump,
        has_one = usdc_mint
    )]
    pub game_authority: Account<'info, GameAuthority>,

    #[account(
        mut,
        seeds = [b"star_pool", star_id.to_le_bytes().as_ref()],
        bump = star_pool.bump
    )]
    pub star_pool: Account<'info, StarPool>,

    #[account(
        init_if_needed,
        payer = staker,
        space = StakePosition::LEN,
        seeds = [b"stake", star_id.to_le_bytes().as_ref(), staker.key().as_ref()],
        bump
    )]
    pub stake_position: Account<'info, StakePosition>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = staker,
        token::token_program = token_program,
    )]
    pub staker_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"star_vault", star_id.to_le_bytes().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = game_authority,
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(star_id: u32)]
pub struct UnstakeStarUsdc<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game_authority"],
        bump = game_authority.bump,
        has_one = usdc_mint
    )]
    pub game_authority: Account<'info, GameAuthority>,

    #[account(
        mut,
        seeds = [b"star_pool", star_id.to_le_bytes().as_ref()],
        bump = star_pool.bump
    )]
    pub star_pool: Account<'info, StarPool>,

    #[account(
        mut,
        seeds = [b"stake", star_id.to_le_bytes().as_ref(), staker.key().as_ref()],
        bump = stake_position.bump,
        has_one = staker
    )]
    pub stake_position: Account<'info, StakePosition>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = staker,
        token::token_program = token_program,
    )]
    pub staker_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"star_vault", star_id.to_le_bytes().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = game_authority,
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(0).unwrap(),
        payer = payer,
    )]
    /// CHECK: Validated by SPL standard via seeds
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(
        token::mint = mint,
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Source owner
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Validated by SPL seeds
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
}

// ── Events ──────────────────────────────────────────────────────────────────
//
// Every state change emits a typed Anchor event. The feeder previously
// reconstructed state by regex over `msg!` strings, so rewording a log line
// silently broke ingestion and no test could catch it. `emit!` writes a
// discriminated Borsh payload the feeder decodes structurally.

#[event]
pub struct StarActivated {
    pub star_id: u32,
    pub timestamp: i64,
}

#[event]
pub struct StarStaked {
    pub staker: Pubkey,
    pub star_id: u32,
    pub principal_usdc: u64,
    pub position_principal: u64,
    pub pool_principal: u64,
    pub timestamp: i64,
}

#[event]
pub struct StarUnstaked {
    pub staker: Pubkey,
    pub star_id: u32,
    pub principal_usdc: u64,
    pub position_principal: u64,
    pub accrued_cap: u64,
    pub timestamp: i64,
}

#[event]
pub struct StarStakeTransferred {
    pub from_wallet: Pubkey,
    pub to_wallet: Pubkey,
    pub token_amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Star activation Merkle root has not been configured.")]
    StarRootUnset,
    #[msg("Star is not in the activation set.")]
    InvalidStarProof,
    #[msg("Star pool has not been activated.")]
    StarNotActivated,
    #[msg("Stake position has less principal than requested.")]
    InsufficientPrincipal,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn position(principal: u64, checkpoint: i64) -> StakePosition {
        StakePosition {
            staker: Pubkey::default(),
            star_id: 677,
            shares: principal,
            principal,
            accrued_cap: 0,
            last_checkpoint: checkpoint,
            claim_nonce: 0,
            bump: 255,
        }
    }

    /// The flaw this design exists to prevent: a large top-up must not earn
    /// yield over an interval it was not staked for.
    #[test]
    fn top_up_earns_nothing_retroactively() {
        let rate = 6_000u64; // 0.6 ESMS per USDC per day, in 4-dp atoms
        let day = 86_400i64;

        // 10 USDC staked for 10 days, then topped up to 1010 USDC.
        let mut small = position(10_000_000, 0);
        checkpoint_position(&mut small, rate, 10 * day).unwrap();
        let earned_by_small = small.accrued_cap;

        // Checkpointing at the top-up freezes the interval against 10 USDC.
        small.principal += 1_000_000_000;
        // One further second on the larger principal.
        checkpoint_position(&mut small, rate, 10 * day + 1).unwrap();

        // Had the interval been credited at the new principal it would be ~101x.
        let naive_retroactive = (1_010u128 * rate as u128 * 10 * SECONDS_PER_DAY)
            / SECONDS_PER_DAY;
        assert_eq!(earned_by_small, 10 * rate * 10);
        assert!((small.accrued_cap as u128) < naive_retroactive / 100);
    }

    #[test]
    fn checkpoint_is_monotonic_under_a_backwards_clock() {
        let mut p = position(10_000_000, 1_000);
        checkpoint_position(&mut p, 6_000, 500).unwrap();
        assert_eq!(p.last_checkpoint, 1_000, "checkpoint must never rewind");
        assert_eq!(p.accrued_cap, 0);
    }

    #[test]
    fn accrual_uses_u128_intermediates_without_overflow() {
        // A principal and duration whose u64 product would wrap.
        let mut p = position(u64::MAX / 2, 0);
        checkpoint_position(&mut p, 1, 86_400).unwrap();
        assert!(p.accrued_cap > 0);
    }

    #[test]
    fn zero_rate_accrues_nothing_but_still_checkpoints() {
        let mut p = position(10_000_000, 0);
        checkpoint_position(&mut p, 0, 86_400).unwrap();
        assert_eq!(p.accrued_cap, 0);
        assert_eq!(p.last_checkpoint, 86_400);
    }

    /// Cross-language pin. The same star id must hash to the same leaf here and
    /// in `@openzeppelin/merkle-tree`, or a proof built off-chain will never
    /// verify on-chain. Value produced by
    /// `keccak256(keccak256(encodeAbiParameters([{type:'uint32'}], [677])))`.
    #[test]
    fn star_leaf_matches_openzeppelin_standard_merkle_tree() {
        let expected: [u8; 32] = [
            0x3f, 0xaa, 0x6d, 0x40, 0x15, 0xe2, 0xc7, 0x25, 0xac, 0x8e, 0x80, 0x44, 0x70, 0xbe,
            0xe9, 0x04, 0xec, 0x18, 0x55, 0xa3, 0x33, 0xda, 0xfa, 0xf3, 0xfb, 0xf6, 0xe0, 0x6f,
            0xdf, 0x3e, 0x94, 0xa2,
        ];
        let mut encoded = [0u8; 32];
        encoded[28..32].copy_from_slice(&677u32.to_be_bytes());
        assert_eq!(keccak_hash(&keccak_hash(&encoded)), expected);
    }

    #[test]
    fn star_proof_rejects_an_unset_root_and_a_wrong_leaf() {
        let mut encoded = [0u8; 32];
        encoded[28..32].copy_from_slice(&677u32.to_be_bytes());
        let leaf = keccak_hash(&keccak_hash(&encoded));

        // A single-leaf tree: the root is the leaf itself.
        assert!(verify_star_proof(677, &[], leaf));
        assert!(!verify_star_proof(678, &[], leaf));
    }
}
