import { handleWalletVerification } from '../../settlement/wallet-verifier.js'

export const config = {
  maxDuration: 60,
}

export async function POST(request) {
  return handleWalletVerification(request)
}

export default async function handler(req, res) {
  // If invoked with a Web Standard Request
  if (typeof req.text === 'function' || typeof req.arrayBuffer === 'function') {
    return handleWalletVerification(req)
  }

  // Node.js (req, res) handler
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    const url = new URL(req.url || '/api/web3/verify-wallet', `${protocol}://${host}`)

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }

    let body = undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
    }

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body,
    })

    const webResponse = await handleWalletVerification(webRequest)
    res.status(webResponse.status)
    webResponse.headers.forEach((val, key) => res.setHeader(key, val))
    const data = await webResponse.text()
    res.send(data)
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
