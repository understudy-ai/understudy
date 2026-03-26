import { deriveRelayToken } from './background-utils.js'
import { clampPort, persistBundledInstallDefaults } from './install-config.js'
import { classifyRelayCheckException, classifyRelayCheckResponse } from './options-validation.js'

function updateRelayUrl(port) {
  const el = document.getElementById('relay-url')
  if (!el) return
  el.textContent = `http://127.0.0.1:${port}/`
}

function setStatus(kind, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

async function checkRelayReachable(port, token) {
  const url = `http://127.0.0.1:${port}/json/version`
  const trimmedToken = String(token || '').trim()
  if (!trimmedToken) {
    setStatus('error', 'Gateway token required. Save your gateway token to connect.')
    return
  }
  try {
    const relayToken = await deriveRelayToken(trimmedToken, port)
    // Delegate the fetch to the background service worker to bypass
    // CORS preflight on the custom x-understudy-relay-token header.
    const res = await chrome.runtime.sendMessage({
      type: 'relayCheck',
      url,
      token: relayToken,
    })
    const result = classifyRelayCheckResponse(res, port)
    if (result.action === 'throw') throw new Error(result.error)
    setStatus(result.kind, result.message)
  } catch (err) {
    const result = classifyRelayCheckException(err, port)
    setStatus(result.kind, result.message)
  }
}

async function load() {
  const resolved = await persistBundledInstallDefaults()
  const port = clampPort(resolved.relayPort)
  const token = String(resolved.gatewayToken || '').trim()
  document.getElementById('port').value = String(port)
  document.getElementById('token').value = token
  updateRelayUrl(port)
  await checkRelayReachable(port, token)
}

async function save() {
  const portInput = document.getElementById('port')
  const tokenInput = document.getElementById('token')
  const port = clampPort(portInput.value)
  const token = String(tokenInput.value || '').trim()
  await chrome.storage.local.set({ relayPort: port, gatewayToken: token })
  portInput.value = String(port)
  tokenInput.value = token
  updateRelayUrl(port)
  await checkRelayReachable(port, token)
}

document.getElementById('save').addEventListener('click', () => void save())
void load()
