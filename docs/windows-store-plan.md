# Plan: Publish GridWatch to the Microsoft Store

## Problem Statement

GridWatch is currently distributed as an unsigned NSIS `.exe` installer via GitHub Releases. To publish on the Microsoft Store, we need MSIX/APPX packaging, code signing, a Microsoft Partner Centre account, and CI/CD automation.

### Key Findings from Codebase Audit

**Already in good shape:**

- Modern Electron 35.7.5 with `contextIsolation: true` and `sandbox: true`
- Cross-platform path handling throughout (`path.join()` + `os.homedir()`)
- `safeStorage` API uses Windows Credential Manager — works natively
- electron-builder 26.8.1 has full APPX/MSIX support
- No hardcoded macOS paths or platform assumptions
- Existing `pack:win` script and CI job on `windows-latest`

**Gaps to close:**

- No APPX/MSIX target in electron-builder config (only NSIS)
- No Windows code signing certificates or config
- No `pack:appx` npm script
- x64 only — no arm64 for Windows 11 on ARM
- CI/CD has no signing or Store upload steps
- No Microsoft Partner Centre account or app listing
- Frameless window (`frame: false`) needs custom title bar handling on Windows
- File access to `~/.copilot/` may need `broadFileSystemAccess` capability in APPX manifest

### Chosen Approach

- **Packaging:** APPX target via electron-builder (generates MSIX-compatible packages)
- **Distribution:** Microsoft Store via Partner Centre
- **CI/CD:** Extend existing GitHub Actions release workflow
- **Dual distribution:** Keep both NSIS (GitHub Releases) and APPX (Store) builds

---

## Phase 0 — Microsoft Partner Centre Setup (Manual, Outside Code)

- [ ] **Register for Microsoft Partner Centre** at <https://partner.microsoft.com/>. One-time registration fee (~£14 for individuals). Required for Store publishing and code signing certificates.
- [ ] **Reserve app name** "GridWatch" in Partner Centre → Apps and Games → New product.
- [ ] **Obtain a code signing certificate** — either:
  - A certificate from the Partner Centre (for Store-only distribution), or
  - A standard code signing certificate from a CA (DigiCert, Sectigo, etc.) for both Store and direct distribution.
  - Export as `.pfx` for CI/CD use.
- [ ] **Create app listing** in Partner Centre:
  - App name: GridWatch
  - Category: Developer Tools
  - Screenshots (1366×768 minimum, 16:9 recommended)
  - Description, keywords, support URL, privacy policy URL
  - Age rating questionnaire
  - Pricing (Free)
  - Privacy declarations (app reads local files only, no data collection)

## Phase 1 — APPX Configuration

- [ ] **Add APPX target** to `electron-builder.json5`:
  ```json5
  appx: {
    applicationId: "GridWatch",
    identityName: "<Partner-Centre-Identity>",
    publisher: "CN=<Your-Publisher-ID>",
    publisherDisplayName: "Faesel Saeed",
    displayName: "GridWatch",
    languages: ["en-GB"],
    showNameOnTiles: true,
    backgroundColor: "#050510",
  }
  ```
  The `identityName` and `publisher` values come from Partner Centre after app reservation.

- [ ] **Add APPX to Windows targets** in electron-builder:
  ```json5
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "appx", arch: ["x64", "arm64"] }
    ]
  }
  ```

- [ ] **Add `pack:appx` npm script** to `package.json`:
  ```json
  "pack:appx": "npm run clean && tsc && vite build && electron-builder --win appx"
  ```

- [ ] **Declare APPX capabilities** — electron-builder generates the manifest, but verify it includes:
  - `broadFileSystemAccess` — required for reading `%USERPROFILE%\.copilot\`
  - `internetClient` — if any network features are used
  - Review generated `AppxManifest.xml` after first build.

## Phase 2 — Windows-Specific Code Fixes

- [ ] **Fix frameless window on Windows** — currently `frame: false` with `titleBarStyle: 'hiddenInset'` (macOS-only). On Windows this creates a completely frameless window with no drag region or window controls. Options:
  - Use `titleBarOverlay` option for Windows (Electron's built-in Windows Controls Overlay):
    ```typescript
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0a0e1f',
        symbolColor: '#c0e8ff',
        height: 44
      }
    } : {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 12 }
    })
    ```
  - This gives native Windows window controls (minimise/maximise/close) with the app's dark theme colours.

- [ ] **Test file access under MSIX** — MSIX apps run in a lightweight container. Access to `%USERPROFILE%\.copilot\` requires `broadFileSystemAccess` capability AND the user must grant permission in Windows Settings → Privacy → File system. Verify this works, and add a first-run check:
  - If files can't be read, show a helpful message directing the user to enable file system access in Windows Settings.

- [ ] **Verify `safeStorage` in MSIX sandbox** — should work as it uses Windows Credential Manager, but test to confirm.

- [ ] **Test `shell.showItemInFolder()` and `shell.openExternal()`** — both should work in MSIX but verify.

## Phase 3 — Code Signing

- [ ] **Configure electron-builder signing** — add certificate config for Windows builds:
  - Set `CSC_LINK` (base64-encoded `.pfx`) and `CSC_KEY_PASSWORD` as environment variables
  - electron-builder automatically signs when these are present

- [ ] **Sign NSIS installer too** — the same certificate works for both APPX and NSIS targets. This eliminates the "Unknown publisher" SmartScreen warning on the direct-download EXE.

## Phase 4 — CI/CD Pipeline Updates

- [ ] **Add APPX build step** to `.github/workflows/release.yml`:
  - In the existing `release-win` job (or a new `release-appx` job)
  - Import signing certificate from GitHub Secrets
  - Run `npm run pack:appx`
  - Upload `.appx` artifact to the GitHub Release

- [ ] **Configure GitHub Actions secrets:**
  - `WIN_CSC_LINK` — base64-encoded `.pfx` certificate
  - `WIN_CSC_KEY_PASSWORD` — certificate password

- [ ] **Add Store upload step** — upload `.appx` to Partner Centre using the [Microsoft Store submission API](https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions) or manually via the Partner Centre web UI.

- [ ] **Add NSIS signing** — pass `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to the existing NSIS build step so direct-download EXEs are also signed.

## Phase 5 — Icon & Asset Preparation

- [ ] **Generate Windows icon assets** — APPX requires specific tile sizes. electron-builder can generate these from the 1024×1024 PNG, but verify the following are produced:
  - 44×44, 50×50, 150×150, 310×310 (square tiles)
  - 71×71, 310×150 (wide tile)
  - Store logo: 300×300
  - Splash screen: 620×300 (optional)

- [ ] **Verify .ico generation** — electron-builder creates `.ico` from the PNG. Confirm it includes 16×16, 32×32, 48×48, and 256×256 sizes.

## Phase 6 — Store Review Preparation

- [ ] **Create a privacy policy page** — same one used for the Apple App Store plan (or a single unified policy). Microsoft requires a privacy policy URL.

- [ ] **Prepare Store description and screenshots:**
  - Feature overview and key benefits
  - At least 1 screenshot per supported resolution (1366×768 recommended)
  - Show sessions page, tokens page, activity page, skills page

- [ ] **Complete the app declarations** in Partner Centre:
  - Does the app access the file system? → Yes (reads Copilot CLI session data)
  - Does the app collect personal data? → No
  - Does the app require internet access? → Optional (for GitHub API features if any)
  - Age rating: suitable for all ages

- [ ] **Test with Windows App Certification Kit (WACK)** — Microsoft requires APPX packages to pass WACK before submission. Run it locally:
  ```powershell
  appcert.exe test -appxpackagepath "GridWatch.appx" -reportoutputpath "report.xml"
  ```

## Phase 7 — Testing & Submission

- [ ] **Build APPX locally** with `npm run pack:appx` on a Windows machine. Install and verify:
  - App installs from APPX without errors
  - First-run file access prompt or settings redirect works
  - All session/token/skill reading works
  - Window title bar has working controls (minimise/maximise/close)
  - `safeStorage` encryption works
  - `shell.showItemInFolder()` and `shell.openExternal()` work

- [ ] **Test on Windows 11 ARM** (if possible) to validate arm64 build.

- [ ] **Run WACK** and fix any failures.

- [ ] **Submit to Microsoft Store** via Partner Centre. Upload the `.appx`, complete all metadata, and submit for certification.

---

## Notes & Considerations

- **Dual distribution**: Keep both NSIS (GitHub Releases) and APPX (Store) builds. The NSIS version doesn't need `broadFileSystemAccess` capability since it runs as a regular desktop app.
- **`broadFileSystemAccess` user experience**: Unlike macOS, Windows doesn't show a system dialog automatically. The user must manually enable "File system" access for GridWatch in Settings → Privacy → File system. The app should detect this and show a helpful onboarding screen.
- **arm64 support**: Windows 11 on ARM can run x64 apps via emulation, but native arm64 builds launch faster and use less battery. electron-builder supports `arch: ["x64", "arm64"]` for APPX.
- **Auto-updates**: Store apps are updated through the Microsoft Store — no custom update logic needed. The existing GitHub-based update check should be disabled or hidden in the Store build.
- **SmartScreen**: Even after signing, new certificates may trigger SmartScreen warnings until they build reputation. Store distribution bypasses SmartScreen entirely.
- **Version format**: MSIX requires 4-part versions (e.g., `0.21.3.0`). electron-builder appends `.0` automatically.
- **Certification timeline**: Microsoft Store certification typically takes 1–3 business days. First submissions may take longer.
- **Partner Centre vs Partner Center**: Microsoft uses American spelling in their portal ("Partner Center"). This document uses British spelling per project conventions except when referring to the portal by name.
