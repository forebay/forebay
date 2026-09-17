# Forebay

A Node-only Electron desktop control plane for the AI-tooling ecosystem. Manages providers, accounts, routing, usage, the local API, and apps or plugins across Claude Code and OpenCode, reusing the existing core-* and plugin-updater libraries rather than reimplementing them.

## Screens

- **Overview**: summary of configured providers, active accounts, and routing state
- **Providers**: list and configure AI provider integrations (Anthropic, Google, etc.)
- **Accounts**: manage provider authentication and per-account quota limits
- **Routing**: configure model routing chains and fallback rules
- **Usage**: view snapshot data: sessions, models, and usage metrics (replaces metric-dashboard's served page)
- **Local API**: introspect the dashboard's local `:34567` proxy server
- **Apps and Plugins**: discover and manage Claude Code and OpenCode plugins

## Architecture

The dashboard is built as:

1. **Electron main process**: manages the window lifecycle, system tray, and daemon supervision
2. **utilityProcess sidecar**: scoped by `HUB_CONFIG_DIR`, runs modules that are thin adapters over core-auth, core-proxy, core-loader, and plugin-updater
3. **Vite + Svelte renderer**: implements the UI, communicates with the sidecar and main process through a typed contextBridge IPC bridge

The sidecar exposes handlers for config, overview, accounts, providers, routing, apps, plugins, and usage; all operations are fully asynchronous and return a standardized Result type (ok or error). The main process spawns the sidecar as a child utilityProcess, passing the configured `HUB_CONFIG_DIR` to scope the sidecar's file access.

## Development

Scripts from `package.json`:

```bash
npm run dev       # Start Electron app with hot reload (electron-vite dev)
npm run build     # Build main, preload, and renderer (electron-vite build)
npm run check     # Run TypeScript type-check and svelte-check
npm run test      # Run tests (vitest)
```

Build outputs go to `dist/`. The project uses workspaces (see `workspaces` in `package.json`).

### Troubleshooting

If `npm run dev` fails with `Error: Electron uninstall`, the `electron` package's binary was not extracted during install (its extractor can fail partway on some Windows setups, leaving only `node_modules/electron/dist/locales`). Re-extract it from the already-downloaded cache zip:

```bash
node node_modules/electron/install.js
```

If that still leaves `node_modules/electron/dist/electron.exe` missing, extract the cached zip manually (PowerShell), then write the path marker:

```powershell
$zip  = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-*-win32-x64.zip" | Select-Object -First 1
$dist = ".\node_modules\electron\dist"
Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue
Expand-Archive -Path $zip.FullName -DestinationPath $dist -Force
"electron.exe" | Out-File .\node_modules\electron\path.txt -Encoding ascii -NoNewline
```

## Supersedes metric-dashboard

This dashboard's **Usage screen** replaces the metric-dashboard plugin's served `:3456` usage page. The snapshot logic is vendored into `vendor/usage/` and consumed by the sidecar's usage module at runtime. Users should migrate any bookmarks or dashboards pointing to `http://localhost:3456/usage` to the integrated Usage screen in this app. Archival of the metric-dashboard plugin repo is a separate cleanup follow-up in the base design.

## License

MIT
