# GridWatch

> A retro-Tron-themed desktop dashboard for monitoring your GitHub Copilot CLI sessions.

GridWatch reads the local session data written by [GitHub Copilot CLI](https://githubnext.com/) to `~/.copilot/session-state/` and presents it as a beautiful, real-time dashboard — giving you visibility into your AI-assisted workflow across every project you work on.

---

## Features

- **Sessions overview** — browse all Copilot CLI sessions with live status, turn counts, token utilisation, and last prompt
- **Prompt history** — read every user message from a session's `events.jsonl` directly in the UI
- **Token usage graphs** — line and bar charts tracking peak context window usage over time
- **Activity heatmap** — GitHub-style contribution grid showing your session activity over 52 weeks
- **Tagging** — add, remove, and search sessions by custom tags
- **Rename sessions** — give sessions a meaningful name beyond the auto-generated summary
- **Archive / Delete** — safely archive or permanently remove old sessions (guards against deleting active sessions)
- **Settings** — adjustable UI scale, font size, and density presets, persisted between launches
- **Auto-refresh** — dashboard refreshes every 30 seconds automatically
- **Retro Tron theme** — neon cyan, electric blue, and orange accents on near-black backgrounds with JetBrains Mono typography

---

## Screenshots

### Sessions
![Sessions](public/images/screenshot-sessions.svg)

### Tokens
![Tokens](public/images/screenshot-tokens.svg)

### Activity
![Activity](public/images/screenshot-activity.svg)

### Settings
![Settings](public/images/screenshot-settings.svg)

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| GitHub Copilot CLI | Any version that writes to `~/.copilot/session-state/` |
| macOS / Windows | 10+ |

---

## Installation

### Download a release

Visit the [Releases](https://github.com/faesel/gridwatch/releases) page and download the installer for your platform:

- **macOS** — `.dmg` (arm64 or x64)
- **Windows** — `.exe` (NSIS installer)

### Build from source

```bash
# Clone the repository
git clone https://github.com/faesel/gridwatch.git
cd gridwatch

# Install dependencies
npm install

# Start in development mode
npm run dev
```

---

## Development

### Project structure

```
gridwatch/
├── electron/
│   ├── main.ts          # Main process — window creation, all IPC handlers
│   └── preload.ts       # Context bridge — exposes gridwatchAPI to renderer
├── src/
│   ├── pages/
│   │   ├── SessionsPage.tsx    # Sessions list + detail panel
│   │   ├── TokensPage.tsx      # Token usage charts
│   │   ├── ActivityPage.tsx    # Heatmap + activity analytics
│   │   └── SettingsPage.tsx    # UI scale / font / density controls
│   ├── types/
│   │   ├── session.ts          # SessionData and related interfaces
│   │   └── global.d.ts         # Window.gridwatchAPI type declarations
│   ├── App.tsx                 # Shell layout, sidebar nav, auto-refresh
│   └── index.css               # Global styles + Tron design system variables
├── public/
│   └── icon.png                # App icon (1024x1024)
└── build/
    └── icon.png                # electron-builder icon source
```

### Available scripts

```bash
npm run dev          # Start development server with hot reload
npm run dev:debug    # Start with DevTools open (useful for debugging)
npm run pack:mac     # Build and package for macOS (creates .dmg files)
npm run pack:win     # Build and package for Windows (creates .exe installer)
npm run pack:all     # Build for all platforms
```

### Data sources

GridWatch reads exclusively from local files — no network requests are made.

| Data | Source |
|---|---|
| Session metadata | `~/.copilot/session-state/<uuid>/workspace.yaml` |
| Prompt history | `~/.copilot/session-state/<uuid>/events.jsonl` |
| Rewind snapshots | `~/.copilot/session-state/<uuid>/rewind-snapshots/index.json` |
| Token usage | `~/.copilot/logs/process-<timestamp>-<pid>.log` |
| Session tags / custom data | `~/.copilot/session-state/<uuid>/gridwatch.json` (written by GridWatch) |

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Electron |
| UI | React 19 + TypeScript |
| Build | Vite + vite-plugin-electron |
| Packaging | electron-builder |
| Styling | CSS Modules + CSS custom properties |
| Charts | Recharts |
| YAML parsing | js-yaml |
| Font | JetBrains Mono (@fontsource) |

### Design system

The Tron-inspired colour palette is defined as CSS custom properties in `src/index.css`:

```css
--tron-bg:        #060a14   /* near-black background */
--tron-panel:     #0a0e1f   /* panel/card background */
--tron-cyan:      #00f5ff   /* primary accent */
--tron-blue:      #0080ff   /* secondary accent */
--tron-orange:    #ff6600   /* destructive / highlight */
--tron-border:    #1a2a4a   /* border colour */
```

---

## Releasing

Releases are built and published automatically by GitHub Actions when a version tag is pushed.

```bash
# 1. Bump the version (choose one)
npm version patch --no-git-tag-version   # 0.5.4 → 0.5.5  (bug fixes)
npm version minor --no-git-tag-version   # 0.5.4 → 0.6.0  (new features)
npm version major --no-git-tag-version   # 0.5.4 → 1.0.0  (breaking changes)

# 2. Commit and push
git add package.json package-lock.json
git commit -m "chore: bump version to $(node -p "require('./package.json').version")"
git push origin main

# 3. Tag and push — this triggers the release workflow
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION" && git push origin "v$VERSION"
```

The release workflow will:
1. Create a GitHub Release with auto-generated release notes
2. Build a signed `.dmg` for macOS (arm64 + x64) in parallel
3. Build an `.exe` NSIS installer for Windows (x64) in parallel
4. Upload both artifacts to the release

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before submitting a pull request.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

**Faesel Saeed**
[faesel.com](https://www.faesel.com) · [GitHub](https://github.com/faesel) · [LinkedIn](https://www.linkedin.com/in/faesel-saeed-a97b1614)
