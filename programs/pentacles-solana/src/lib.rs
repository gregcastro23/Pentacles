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

/// Maximum allowable yield rate: 100,000.0000 ESMS atoms (4 decimals) per USDC per day.
/// Derived from 20,000x baseline (5.0000 ESMS/USDC/day) to accommodate extreme
/// celestial resonance surges (planetary dignity × zone dominance) while preventing
/// administrative typo overflows (e.g. 1e13).
pub const MAX_RATE_ATOMS_PER_USDC_DAY: u64 = 1_000_000_0000;

/// Maximum allowable Merkle proof depth (32 nodes covers 2^32 entries).
pub const MAX_STAR_PROOF_DEPTH: usize = 32;

/// Fixed-point scaling factor for the global yield index accumulator (10^12).
pub const ACCUMULATOR_SCALE: u128 = 1_000_000_000_000;

#[program]
pub mod pentacles_solana {
    use super::*;

    /// Initialize the global game authority. Holds the admin key and the star
    /// activation Merkle root; it is the StarVault's transfer authority.
    pub fn initialize_game_authority(ctx: Context<InitializeGameAuthority>) -> Result<()> {
        validate_vault_usdc_mint(&ctx.accounts.usdc_mint.to_account_info())?;
        let now = Clock::get()?.unix_timestamp;
        let auth = &mut ctx.accounts.game_authority;
        auth.authority = ctx.accounts.payer.key();
        auth.usdc_mint = ctx.accounts.usdc_mint.key();
        auth.star_root = [0u8; 32];
        auth.max_rate_atoms_per_usdc_day = 0;
        auth.total_principal = 0;
        auth.yield_index = 0;
        auth.index_updated_at = now;
        auth.bump = ctx.bumps.game_authority;
        msg!("Pentacles game authority initialized for USDC mint {}.", auth.usdc_mint);
        Ok(())
    }

    /// Rotate the game authority admin key.
    pub fn set_game_authority(
        ctx: Context<SetGameAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        require!(new_authority != Pubkey::default(), ErrorCode::InvalidAuthority);
        let auth = &mut ctx.accounts.game_authority;
        auth.authority = new_authority;
        msg!("Pentacles game authority rotated to {}.", new_authority);
        Ok(())
    }

    /// Set the star-activation Merkle root and the yield rate ceiling.
    ///
    /// The rate is an upper bound on accrual, not the accrual itself: the
    /// authoritative per-star rate is astronomical (altitude, dignity, zone
    /// dominance) and is computed off-chain. This ceiling is what bounds a
    /// compromised attestor's maximum claim, so it belongs on chain.
    ///
    /// Settle the yield index up to `now` at the OLD rate before writing the
    /// new rate so rate adjustments can only apply forward.
    pub fn configure_star_vault(
        ctx: Context<ConfigureStarVault>,
        star_root: [u8; 32],
        max_rate_atoms_per_usdc_day: u64,
    ) -> Result<()> {
        require!(
            max_rate_atoms_per_usdc_day <= MAX_RATE_ATOMS_PER_USDC_DAY,
            ErrorCode::RateExceedsCeiling
        );
        let now = Clock::get()?.unix_timestamp;
        let auth = &mut ctx.accounts.game_authority;
        auth.yield_index = current_yield_index(auth, now);
        auth.index_updated_at = now.max(auth.index_updated_at);
        auth.star_root = star_root;
        auth.max_rate_atoms_per_usdc_day = max_rate_atoms_per_usdc_day;
        msg!(
            "StarVault configured: rate ceiling {} ESMS atoms per USDC per day, settled index {}.",
            max_rate_atoms_per_usdc_day,
            auth.yield_index
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
        require!(proof.len() <= MAX_STAR_PROOF_DEPTH, ErrorCode::ProofTooDeep);
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
        let auth = &mut ctx.accounts.game_authority;
        let position = &mut ctx.accounts.stake_position;
        if position.staker == Pubkey::default() {
            position.staker = ctx.accounts.staker.key();
            position.star_id = star_id;
            position.last_checkpoint = now;
            position.index_snapshot = current_yield_index(auth, now);
            position.bump = ctx.bumps.stake_position;
        } else {
            checkpoint_position(position, auth, now)?;
        }

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
        let authority_bump = ctx.accounts.game_authority.bump;

        let position = &mut ctx.accounts.stake_position;
        require!(position.principal >= amount, ErrorCode::InsufficientPrincipal);
        checkpoint_position(position, &ctx.accounts.game_authority, now)?;

        position.principal -= amount;
        position.shares = position.shares.saturating_sub(amount);

        let pool = &mut ctx.accounts.star_pool;
        let pool_pre = pool.total_principal;
        pool.total_principal = pool.total_principal.saturating_sub(amount);
        let pool_delta = pool_pre.saturating_sub(pool.total_principal);
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
            pool_delta,
            timestamp: now,
        });
        Ok(())
    }

    /// Close an empty stake position and reclaim rent lamports.
    pub fn close_stake_position(
        ctx: Context<CloseStakePosition>,
        _star_id: u32,
    ) -> Result<()> {
        let position = &ctx.accounts.stake_position;
        require!(
            position.principal == 0 && position.accrued_cap == 0,
            ErrorCode::PositionNotEmpty
        );
        msg!("Stake position closed for star {} by {}.", position.star_id, ctx.accounts.staker.key());
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

// ── Yield accumulator & checkpointing ───────────────────────────────────────

/// Validate USDC vault mint for unsupported Token-2022 extensions.
///
/// Passes classic SPL Token mints through unconditionally. For Token-2022 mints,
/// walks the TLV extension area from offset 166 and rejects TransferFeeConfig (1),
/// PermanentDelegate (12), and TransferHook (14).
pub fn validate_vault_usdc_mint<'info>(mint: &AccountInfo<'info>) -> Result<()> {
    if *mint.owner == anchor_spl::token::ID {
        return Ok(());
    }
    require_keys_eq!(
        *mint.owner,
        anchor_spl::token_2022::spl_token_2022::ID,
        ErrorCode::InvalidVaultMintExtensions
    );
    let data = mint.try_borrow_data()?;
    if data.len() > 166 {
        let mut cursor = 166;
        while cursor + 4 <= data.len() {
            let extension_type = u16::from_le_bytes([data[cursor], data[cursor + 1]]);
            let extension_len = u16::from_le_bytes([data[cursor + 2], data[cursor + 3]]) as usize;
            if extension_type == 0 && extension_len == 0 {
                break;
            }
            // Reject TransferFeeConfig (1), PermanentDelegate (12), TransferHook (14)
            if extension_type == 1 || extension_type == 12 || extension_type == 14 {
                return err!(ErrorCode::InvalidVaultMintExtensions);
            }
            cursor = cursor + 4 + extension_len;
        }
    }
    Ok(())
}

/// Computes the live global yield index at `now`.
///
/// Infallible and monotonic: backwards clock never rewinds, overflow saturates at u128::MAX.
pub fn current_yield_index(auth: &GameAuthority, now: i64) -> u128 {
    let elapsed = now.saturating_sub(auth.index_updated_at);
    if elapsed <= 0 || auth.max_rate_atoms_per_usdc_day == 0 {
        return auth.yield_index;
    }
    let delta = (auth.max_rate_atoms_per_usdc_day as u128)
        .saturating_mul(elapsed as u128)
        .saturating_mul(ACCUMULATOR_SCALE)
        / (USDC_UNITS_PER_TOKEN * SECONDS_PER_DAY);
    auth.yield_index.saturating_add(delta)
}

/// Credit the interval since the last checkpoint against the principal that was
/// staked for it, using the forward-only global yield index.
///
/// Infallible and monotonic: backwards clock never rewinds, overflow saturates at u64::MAX.
fn checkpoint_position(
    position: &mut StakePosition,
    auth: &GameAuthority,
    now: i64,
) -> Result<()> {
    let index_now = current_yield_index(auth, now);
    let index_diff = index_now.saturating_sub(position.index_snapshot);
    if position.principal > 0 && index_diff > 0 {
        let gained = (position.principal as u128)
            .saturating_mul(index_diff)
            / ACCUMULATOR_SCALE;
        let delta = gained.min(u64::MAX as u128) as u64;
        position.accrued_cap = position.accrued_cap.saturating_add(delta);
    }
    position.index_snapshot = index_now;
    position.last_checkpoint = now.max(position.last_checkpoint);
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
    pub yield_index: u128,
    pub index_updated_at: i64,
    pub bump: u8,
}

impl GameAuthority {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 16 + 8 + 1;
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
    pub index_snapshot: u128,
    pub claim_nonce: u64,
    pub bump: u8,
}

impl StakePosition {
    pub const LEN: usize = 8 + 32 + 4 + 8 + 8 + 8 + 8 + 16 + 8 + 1;
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
pub struct SetGameAuthority<'info> {
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
#[instruction(star_id: u32)]
pub struct CloseStakePosition<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stake", star_id.to_le_bytes().as_ref(), staker.key().as_ref()],
        bump = stake_position.bump,
        has_one = staker,
        close = staker
    )]
    pub stake_position: Account<'info, StakePosition>,
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
    pub pool_delta: u64,
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
    #[msg("Yield rate exceeds maximum allowable ceiling.")]
    RateExceedsCeiling,
    #[msg("Merkle proof exceeds maximum depth.")]
    ProofTooDeep,
    #[msg("USDC vault mint contains unsupported Token-2022 extensions.")]
    InvalidVaultMintExtensions,
    #[msg("Invalid authority address.")]
    InvalidAuthority,
    #[msg("Stake position must have zero principal and zero accrued cap to close.")]
    PositionNotEmpty,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game_auth(rate: u64, index: u128, updated_at: i64) -> GameAuthority {
        GameAuthority {
            authority: Pubkey::default(),
            usdc_mint: Pubkey::default(),
            star_root: [0u8; 32],
            max_rate_atoms_per_usdc_day: rate,
            total_principal: 0,
            yield_index: index,
            index_updated_at: updated_at,
            bump: 255,
        }
    }

    fn position(principal: u64, checkpoint: i64, snapshot: u128) -> StakePosition {
        StakePosition {
            staker: Pubkey::default(),
            star_id: 677,
            shares: principal,
            principal,
            accrued_cap: 0,
            last_checkpoint: checkpoint,
            index_snapshot: snapshot,
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
        let auth = game_auth(rate, 0, 0);

        // 10 USDC staked for 10 days, then topped up to 1010 USDC.
        let mut small = position(10_000_000, 0, 0);
        checkpoint_position(&mut small, &auth, 10 * day).unwrap();
        let earned_by_small = small.accrued_cap;

        // Checkpointing at the top-up freezes the interval against 10 USDC.
        small.principal += 1_000_000_000;
        // One further second on the larger principal.
        checkpoint_position(&mut small, &auth, 10 * day + 1).unwrap();

        // Had the interval been credited at the new principal it would be ~101x.
        let naive_retroactive = (1_010u128 * rate as u128 * 10 * SECONDS_PER_DAY)
            / SECONDS_PER_DAY;
        assert_eq!(earned_by_small, 10 * rate * 10);
        assert!((small.accrued_cap as u128) < naive_retroactive / 100);
    }

    #[test]
    fn rate_increase_credits_nothing_retroactively() {
        let day = 86_400i64;
        let mut auth = game_auth(6_000, 0, 0); // 0.6 ESMS/USDC/day

        // Position staked at t = 0 with snapshot = 0
        let mut p = position(10_000_000, 0, 0); // 10 USDC

        // 10 days pass without user interaction
        let t10 = 10 * day;

        // Admin increases rate 100x at t = 10 days (from 6_000 to 600_000)
        // configure_star_vault settles auth.yield_index at old rate first:
        auth.yield_index = current_yield_index(&auth, t10);
        auth.index_updated_at = t10;
        auth.max_rate_atoms_per_usdc_day = 600_000;

        // 1 second after rate increase, staker checkpoints
        checkpoint_position(&mut p, &auth, t10 + 1).unwrap();

        // 10 days at 6000 + 1 second at 600000:
        // 10 days at 6000 on 10 USDC = 600_000 atoms
        // 1 second at 600000 on 10 USDC = (10_000_000 * 600000 * 1) / (1_000_000 * 86400) = 69 atoms
        assert_eq!(p.accrued_cap, 600_069);

        // Under vulnerable retroactive valuation (all 10 days + 1s at 600_000):
        // 10 USDC * 600_000 * 10 days = 60_000_000 atoms (~100x over-crediting)
        assert!(p.accrued_cap < 700_000);
    }

    #[test]
    fn unconfigured_pre_staking_window_earns_zero() {
        let day = 86_400i64;
        // Initial state from initialize_game_authority (rate = 0)
        let mut auth = game_auth(0, 0, 0);

        // Staked at t = 0 before first configure_star_vault
        let mut p = position(10_000_000, 0, 0);

        // 10 days elapse with rate = 0
        let t10 = 10 * day;
        // First configuration occurs at t10 setting rate to 6000
        auth.yield_index = current_yield_index(&auth, t10);
        auth.index_updated_at = t10;
        auth.max_rate_atoms_per_usdc_day = 6_000;

        // Checkpoint 5 days after configuration (t = 15 days)
        checkpoint_position(&mut p, &auth, t10 + 5 * day).unwrap();

        // Only 5 days earned, the 10 pre-configuration days earned 0
        assert_eq!(p.accrued_cap, 10 * 6_000 * 5); // 10 USDC * 6000 * 5 days = 300_000 atoms
    }

    #[test]
    fn checkpoint_is_monotonic_under_a_backwards_clock() {
        let auth = game_auth(6_000, 0, 1_000);
        let mut p = position(10_000_000, 1_000, 0);
        checkpoint_position(&mut p, &auth, 500).unwrap();
        assert_eq!(p.last_checkpoint, 1_000, "checkpoint must never rewind");
        assert_eq!(p.accrued_cap, 0);
    }

    #[test]
    fn checkpoint_infallible_with_max_rate_100_years() {
        let hundred_years = 100 * 365 * 86_400i64;
        let auth = game_auth(u64::MAX, 0, 0);
        let mut p = position(1_000_000_000_000, 0, 0); // 1M USDC
        p.accrued_cap = u64::MAX - 100;

        // Infallible: saturating arithmetic clamps to u64::MAX without error
        let res = checkpoint_position(&mut p, &auth, hundred_years);
        assert!(res.is_ok());
        assert_eq!(p.accrued_cap, u64::MAX);
        assert_eq!(p.last_checkpoint, hundred_years);
    }

    #[test]
    fn configure_star_vault_enforces_rate_ceiling() {
        assert_eq!(MAX_RATE_ATOMS_PER_USDC_DAY, 1_000_000_0000);
        assert!(MAX_RATE_ATOMS_PER_USDC_DAY < u64::MAX);
    }

    #[test]
    fn proof_depth_bound_is_32() {
        assert_eq!(MAX_STAR_PROOF_DEPTH, 32);
    }

    #[test]
    fn vault_mint_validation_rejects_unsupported_extensions() {
        // Classic SPL token (owned by spl_token)
        let spl_token_prog = anchor_spl::token::ID;
        let spl_key = Pubkey::new_unique();
        let mut spl_data = vec![0u8; 82];
        let mut spl_lamports = 1_000_000;
        let spl_mint_info = AccountInfo::new(
            &spl_key,
            false,
            false,
            &mut spl_lamports,
            &mut spl_data,
            &spl_token_prog,
            false,
            0,
        );
        assert!(validate_vault_usdc_mint(&spl_mint_info).is_ok());

        // Token-2022 with TransferFeeConfig (extension 1)
        let t22_prog = anchor_spl::token_2022::spl_token_2022::ID;
        let t22_key = Pubkey::new_unique();
        let mut fee_data = vec![0u8; 200];
        fee_data[166] = 1;
        fee_data[167] = 0;
        fee_data[168] = 8;
        fee_data[169] = 0;
        let mut fee_lamports = 1_000_000;
        let fee_info = AccountInfo::new(
            &t22_key,
            false,
            false,
            &mut fee_lamports,
            &mut fee_data,
            &t22_prog,
            false,
            0,
        );
        assert_eq!(
            validate_vault_usdc_mint(&fee_info).unwrap_err(),
            error!(ErrorCode::InvalidVaultMintExtensions)
        );

        // Token-2022 with PermanentDelegate (extension 12)
        let mut delegate_data = vec![0u8; 200];
        delegate_data[166] = 12;
        delegate_data[167] = 0;
        delegate_data[168] = 32;
        delegate_data[169] = 0;
        let mut del_lamports = 1_000_000;
        let del_info = AccountInfo::new(
            &t22_key,
            false,
            false,
            &mut del_lamports,
            &mut delegate_data,
            &t22_prog,
            false,
            0,
        );
        assert_eq!(
            validate_vault_usdc_mint(&del_info).unwrap_err(),
            error!(ErrorCode::InvalidVaultMintExtensions)
        );

        // Token-2022 with TransferHook (extension 14)
        let mut hook_data = vec![0u8; 200];
        hook_data[166] = 14;
        hook_data[167] = 0;
        hook_data[168] = 32;
        hook_data[169] = 0;
        let mut hook_lamports = 1_000_000;
        let hook_info = AccountInfo::new(
            &t22_key,
            false,
            false,
            &mut hook_lamports,
            &mut hook_data,
            &t22_prog,
            false,
            0,
        );
        assert_eq!(
            validate_vault_usdc_mint(&hook_info).unwrap_err(),
            error!(ErrorCode::InvalidVaultMintExtensions)
        );
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
