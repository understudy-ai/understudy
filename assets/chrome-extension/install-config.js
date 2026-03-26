const DEFAULT_PORT = 23336
const LOCAL_CONFIG_FILENAME = 'understudy-local-config.json'

/** @type {Promise<{relayPort?: number, gatewayToken?: string}>|null} */
let cachedInstallConfigPromise = null

export function clampPort(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_PORT
  }
  return parsed
}

function sanitizeInstallConfig(data) {
  if (!data || typeof data !== 'object') {
    return {}
  }
  const relayPort = clampPort(/** @type {{relayPort?: unknown}} */ (data).relayPort)
  const gatewayToken = String(/** @type {{gatewayToken?: unknown}} */ (data).gatewayToken || '').trim()
  return {
    relayPort,
    gatewayToken,
  }
}

export async function loadBundledInstallConfig() {
  if (!cachedInstallConfigPromise) {
    cachedInstallConfigPromise = (async () => {
      try {
        const url = chrome.runtime.getURL(LOCAL_CONFIG_FILENAME)
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          return {}
        }
        return sanitizeInstallConfig(await res.json())
      } catch {
        return {}
      }
    })()
  }
  return await cachedInstallConfigPromise
}

export async function persistBundledInstallDefaults() {
  const bundled = await loadBundledInstallConfig()
  const stored = await chrome.storage.local.get(['relayPort', 'gatewayToken'])
  const next = {}
  const storedRelayPort = Number.parseInt(String(stored.relayPort || ''), 10)
  const storedGatewayToken = String(stored.gatewayToken || '').trim()
  if (bundled.relayPort && bundled.relayPort !== storedRelayPort) {
    next.relayPort = bundled.relayPort
  }
  if (bundled.gatewayToken && bundled.gatewayToken !== storedGatewayToken) {
    next.gatewayToken = bundled.gatewayToken
  }
  if (Object.keys(next).length > 0) {
    await chrome.storage.local.set(next)
  }
  const resolvedRelayPort =
    Object.prototype.hasOwnProperty.call(next, 'relayPort')
      ? next.relayPort
      : (Number.isFinite(storedRelayPort) && storedRelayPort > 0 && storedRelayPort <= 65535
          ? storedRelayPort
          : bundled.relayPort)
  const resolvedGatewayToken =
    Object.prototype.hasOwnProperty.call(next, 'gatewayToken')
      ? next.gatewayToken
      : (storedGatewayToken || bundled.gatewayToken || '')
  return {
    relayPort: resolvedRelayPort,
    gatewayToken: resolvedGatewayToken,
  }
}

export async function resolveRelayPortWithFallback(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }
  const bundled = await loadBundledInstallConfig()
  return bundled.relayPort || DEFAULT_PORT
}

export async function resolveGatewayTokenWithFallback(value) {
  const token = String(value || '').trim()
  if (token) {
    return token
  }
  const bundled = await loadBundledInstallConfig()
  return String(bundled.gatewayToken || '').trim()
}
