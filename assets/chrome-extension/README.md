# Understudy Chrome Extension (Browser Relay)

Purpose: attach Understudy to an existing Chrome tab so the Gateway can automate it (via the local CDP relay server).

## Dev / load unpacked

1. Build/run Understudy Gateway with browser control enabled.
2. Ensure the relay server is reachable at `http://127.0.0.1:23336/` (default).
3. Install the extension to a local path. The default target is `~/Downloads/Understudy Chrome Extension`, and you can also choose `managed` (`~/.understudy/browser/chrome-extension`) or pass a custom path:

   ```bash
   understudy browser extension install
   understudy browser extension install managed
   understudy browser extension install /tmp/understudy-extension
   understudy browser extension path
   ```

4. Chrome → `chrome://extensions` → enable “Developer mode”.
5. “Load unpacked” → select the path printed above.
6. Pin the extension. Click the icon on a tab to attach/detach.

## Options

- `Relay port`: defaults to `23336`.
- `Gateway token`: required. Set this to `gateway.auth.token` (or `UNDERSTUDY_GATEWAY_TOKEN`).
