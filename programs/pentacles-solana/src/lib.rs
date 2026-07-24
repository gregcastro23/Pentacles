use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R");

#[program]
pub mod pentacles_solana {
    use super::*;

    /// Initialize the global Game Authority PDA with epoch mint caps
    pub fn initialize_game_authority(
        ctx: Context<InitializeGameAuthority>,
        max_epoch_mint: u64,
    ) -> Result<()> {
        let auth = &mut ctx.accounts.game_authority;
        auth.max_epoch_mint = if max_epoch_mint > 0 {
            max_epoch_mint
        } else {
            10_000_000_000_000_000_000
        }; // 10M ESMS cap
        auth.current_epoch = Clock::get()?.epoch;
        auth.epoch_minted = 0;
        auth.bump = ctx.bumps.game_authority;
        msg!(
            "Game Authority PDA initialized with max epoch mint cap {}.",
            auth.max_epoch_mint
        );
        Ok(())
    }

    /// Initialize an individual ESMS Token-2022 element mint (0=Spirit, 1=Essence, 2=Matter, 3=Substance)
    pub fn initialize_element_mint(
        _ctx: Context<InitializeElementMint>,
        element_id: u8,
    ) -> Result<()> {
        require!(element_id <= 3, ErrorCode::InvalidElementId);
        msg!("ESMS Token-2022 element mint {} initialized.", element_id);
        Ok(())
    }

    /// Mint ESMS Token-2022 rewards (horizon yield claims or Scrabble duel victories)
    /// Enforces on-chain Epoch Mint Cap to defend against Hot Wallet exploits.
    pub fn mint_esms_rewards(
        ctx: Context<MintEsmsRewards>,
        element_id: u8,
        amount: u64,
    ) -> Result<()> {
        require!(element_id <= 3, ErrorCode::InvalidElementId);

        let clock = Clock::get()?;
        let (authority_bump, epoch_minted, max_epoch_mint) = {
            let auth = &mut ctx.accounts.game_authority;

            // Reset mint tally on new epoch.
            if auth.current_epoch != clock.epoch {
                auth.current_epoch = clock.epoch;
                auth.epoch_minted = 0;
            }

            // On-chain Hot Wallet Safeguard: Cap total ESMS minted per epoch.
            require!(
                auth.epoch_minted.saturating_add(amount) <= auth.max_epoch_mint,
                ErrorCode::EpochMintCapExceeded
            );
            auth.epoch_minted = auth.epoch_minted.saturating_add(amount);
            (auth.bump, auth.epoch_minted, auth.max_epoch_mint)
        };

        let bump_seed = [authority_bump];
        let seeds = &[b"game_authority".as_ref(), &bump_seed];
        let signer = [&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.target_mint.to_account_info(),
            to: ctx.accounts.player_token_account.to_account_info(),
            authority: ctx.accounts.game_authority.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer,
        );

        token_interface::mint_to(cpi_ctx, amount)?;
        msg!(
            "Minted {} units of ESMS element {} for {}. (Epoch {} minted: {}/{})",
            amount,
            element_id,
            ctx.accounts.player_token_account.owner,
            clock.epoch,
            epoch_minted,
            max_epoch_mint
        );
        Ok(())
    }

    /// Stake USDC into a Star Vault PDA using TransferChecked with net balance delta accounting.
    pub fn stake_star_usdc(ctx: Context<StakeStarUsdc>, star_id: u32, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let vault_pre_balance = ctx.accounts.vault_token_account.amount;

        // Execute TransferChecked (handles TransferFee extension and decimals safely)
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.staker_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.staker.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.usdc_mint.decimals)?;

        // Reload account to measure exact net balance increase (net principal received)
        ctx.accounts.vault_token_account.reload()?;
        let vault_post_balance = ctx.accounts.vault_token_account.amount;
        let net_principal = vault_post_balance.saturating_sub(vault_pre_balance);

        msg!(
            "Staked USDC into StarVault {}. Net principal received: {} units (requested: {}).",
            star_id,
            net_principal,
            amount
        );
        Ok(())
    }

    /// Burn ESMS Token-2022 tokens to cast Arena Jings / Spells
    pub fn burn_esms_for_jing(
        ctx: Context<BurnEsmsForJing>,
        element_id: u8,
        amount: u64,
    ) -> Result<()> {
        require!(element_id <= 3, ErrorCode::InvalidElementId);

        let cpi_accounts = Burn {
            mint: ctx.accounts.target_mint.to_account_info(),
            from: ctx.accounts.player_token_account.to_account_info(),
            authority: ctx.accounts.player.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token_interface::burn(cpi_ctx, amount)?;

        msg!(
            "Burned {} units of ESMS element {} for Jing cast by {}.",
            amount,
            element_id,
            ctx.accounts.player.key()
        );
        Ok(())
    }

    /// Permanent Delegate anti-cheat slash instruction.
    /// Uses game_authority PDA as Permanent Delegate to burn illicit tokens directly from offender.
    pub fn slash_cheater(ctx: Context<SlashCheater>, amount: u64) -> Result<()> {
        let auth_bump = ctx.accounts.game_authority.bump;
        let seeds = &[b"game_authority".as_ref(), &[auth_bump]];
        let signer = [&seeds[..]];

        let cpi_accounts = Burn {
            mint: ctx.accounts.target_mint.to_account_info(),
            from: ctx.accounts.offender_token_account.to_account_info(),
            authority: ctx.accounts.game_authority.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &signer,
        );

        token_interface::burn(cpi_ctx, amount)?;
        msg!(
            "Permanent Delegate Slashed {} tokens from offender account.",
            amount
        );
        Ok(())
    }

    /// Initialize ExtraAccountMetaList PDA required by SPL Transfer Hook standard.
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

    /// Native Token-2022 Transfer Hook execution instruction.
    /// Intercepts starUSDC LST transfers on-chain, emitting StarStakeTransferred telemetry.
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let source_owner = ctx.accounts.source_token.owner;
        let destination_owner = ctx.accounts.destination_token.owner;

        msg!(
            "Intercepted starUSDC Transfer! Amount: {}. Yield shifting {} -> {}",
            amount,
            source_owner,
            destination_owner
        );

        emit!(StarStakeTransferred {
            from_wallet: source_owner,
            to_wallet: destination_owner,
            token_amount: amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ── State Structs & Accounts ──────────────────────────────────────────────────

#[account]
pub struct GameAuthority {
    pub max_epoch_mint: u64,
    pub current_epoch: u64,
    pub epoch_minted: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeGameAuthority<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 8 + 8 + 1,
        seeds = [b"game_authority"],
        bump
    )]
    pub game_authority: Account<'info, GameAuthority>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeElementMint<'info> {
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
        mint::decimals = 18,
        mint::authority = game_authority,
        mint::token_program = token_program,
    )]
    pub element_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEsmsRewards<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game_authority"],
        bump = game_authority.bump
    )]
    pub game_authority: Account<'info, GameAuthority>,

    #[account(mut)]
    pub target_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = target_mint,
        token::authority = player,
        token::token_program = token_program,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Player receiving the minted rewards
    pub player: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(star_id: u32)]
pub struct StakeStarUsdc<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(mut)]
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
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BurnEsmsForJing<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(mut)]
    pub target_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = target_mint,
        token::authority = player,
        token::token_program = token_program,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SlashCheater<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"game_authority"],
        bump = game_authority.bump
    )]
    pub game_authority: Account<'info, GameAuthority>,

    #[account(mut)]
    pub target_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = target_mint,
        token::token_program = token_program,
    )]
    pub offender_token_account: InterfaceAccount<'info, TokenAccount>,

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

// ── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct StarStakeTransferred {
    pub from_wallet: Pubkey,
    pub to_wallet: Pubkey,
    pub token_amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Element ID must be between 0 (Spirit) and 3 (Substance).")]
    InvalidElementId,
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Epoch ESMS mint cap exceeded. Feeder request rejected by Game Authority.")]
    EpochMintCapExceeded,
}
