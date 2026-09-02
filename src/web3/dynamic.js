// ============================================================
// Pentacles — Dynamic wallet React island (code-split, env-gated)
// ============================================================
// Mounted ONLY when VITE_DYNAMIC_ENV_ID is set (see main.js); otherwise the
// injected-wallet path in wallet.js handles everything. Written with
// React.createElement (no JSX) so the single island needs no JSX build plugin,
// and dynamically imported so React + the Dynamic SDK stay out of the default
// bundle entirely.

import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { DynamicContextProvider, DynamicWidget } from '@dynamic-labs/sdk-react-core'
import wallet from './wallet.js'

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
          events: {
            onAuthSuccess: (args) => bridge(args?.primaryWallet),
            onPrimaryWalletChanged: (pw) => bridge(pw),
            onLogout: () => wallet.setDynamicWallet({ solanaAddress: null }),
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
    return wallet.setDynamicWallet({ solanaAddress: null })
  }
  const isSol = primaryWallet.chain === 'solana' || (primaryWallet.address && !primaryWallet.address.startsWith('0x'))
  let solanaAddress = isSol ? primaryWallet.address : null
  let provider = null
  try {
    if (isSol && typeof primaryWallet.connector?.getSigner === 'function') {
      provider = await primaryWallet.connector.getSigner()
    }
    if (!provider && primaryWallet.connector?.getProvider) {
      provider = await primaryWallet.connector.getProvider()
    }
  } catch {
    // Address-only bridge: reads still work, but signing remains unavailable.
  }
  wallet.setDynamicWallet({
    solanaAddress,
    solanaProvider: provider,
  })
}
