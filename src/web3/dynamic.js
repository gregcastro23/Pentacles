// ============================================================
// Pentacles — Dynamic wallet React island (code-split, env-gated)
// ============================================================
// Mounted ONLY when VITE_DYNAMIC_ENV_ID is set (see main.js); otherwise the
// injected-wallet path in wallet.js handles everything. Written with
// React.createElement (no JSX) so the single island needs no JSX build plugin,
// and dynamically imported so React + the Dynamic SDK stay out of the default
// bundle entirely.
//
// NOTE: the event/provider bridge below targets the Dynamic SDK v4 API but is
// UNVERIFIED without a real environmentId — it is written defensively (tries
// several provider shapes, degrades to address-only) and should be validated
// against a live Dynamic environment before the signing path is trusted.

import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { DynamicContextProvider, DynamicWidget } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum'
import wallet from './wallet.js'
import { CHAIN, RPC_URL, EXPLORER } from './chain.js'

let mounted = false

export function mountDynamic() {
  if (mounted) return
  const envId = import.meta.env.VITE_DYNAMIC_ENV_ID
  if (!envId) return
  mounted = true

  const mount = document.createElement('div')
  mount.id = 'pentacles-dynamic'
  mount.className = 'pt-dynamic'
  document.body.appendChild(mount)

  const root = createRoot(mount)
  root.render(
    h(
      DynamicContextProvider,
      {
        settings: {
          environmentId: envId,
          walletConnectors: [EthereumWalletConnectors],
          overrides: { evmNetworks: [baseSepoliaNetwork()] },
          events: {
            onAuthSuccess: (args) => bridge(args?.primaryWallet),
            onPrimaryWalletChanged: (pw) => bridge(pw),
            onLogout: () => wallet.setDynamicWallet({ address: null }),
          },
        },
      },
      h(DynamicWidget)
    )
  )
}

// Bridge a Dynamic wallet into our façade so the HUD + DEX use one wallet source.
async function bridge(primaryWallet) {
  if (!primaryWallet || !primaryWallet.address) {
    return wallet.setDynamicWallet({ address: null, solanaAddress: null })
  }
  const isSol = primaryWallet.chain === 'solana' || (primaryWallet.address && !primaryWallet.address.startsWith('0x'))
  let evmAddress = isSol ? null : primaryWallet.address
  let solanaAddress = isSol ? primaryWallet.address : null
  let provider = null
  try {
    if (isSol && typeof primaryWallet.connector?.getSigner === 'function') {
      provider = await primaryWallet.connector.getSigner()
    } else if (!isSol) {
      if (typeof primaryWallet.getWalletClient === 'function') {
        const wc = await primaryWallet.getWalletClient()
        provider = wc?.transport?.value ?? wc?.transport ?? null
      }
    }
    if (!provider && primaryWallet.connector?.getProvider) {
      provider = await primaryWallet.connector.getProvider()
    }
  } catch {
    // Address-only bridge: reads still work, but signing remains unavailable.
  }
  let chainId
  try {
    chainId = Number(await primaryWallet.connector?.getNetwork?.()) || undefined
  } catch {
    chainId = undefined
  }
  wallet.setDynamicWallet({
    address: evmAddress,
    solanaAddress,
    provider: isSol ? null : provider,
    solanaProvider: isSol ? provider : null,
    chainId,
  })
}

function baseSepoliaNetwork() {
  return {
    blockExplorerUrls: [EXPLORER],
    chainId: CHAIN.id,
    chainName: CHAIN.name,
    name: CHAIN.name,
    nativeCurrency: CHAIN.nativeCurrency,
    networkId: CHAIN.id,
    rpcUrls: [RPC_URL],
    vanityName: 'Base Sepolia',
  }
}
