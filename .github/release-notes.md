> [!NOTE]
> LumioNG is in early development: some features may have bugs or not work in every setup yet.
> Please [report problems or suggest improvements](https://github.com/NGxxxx/lumioNG/issues) —
> feedback decides what gets fixed first. All features are free, with no Pro tier.

## Downloads

| OS | Installer | Portable (no install) |
|---|---|---|
| **Windows 10/11** (x64) | `LumioNG_{{VERSION}}_x64-setup.exe` or `LumioNG_{{VERSION}}_x64_en-US.msi` | `LumioNG_{{VERSION}}_x64_portable.zip` |
| **macOS 10.13+** (Apple Silicon + Intel) | `LumioNG_{{VERSION}}_universal.dmg` | `LumioNG_{{VERSION}}_universal_portable.app.zip` |
| **Linux** (x64) | `.deb` (Debian/Ubuntu) or `.rpm` (Fedora/RHEL/openSUSE) | `LumioNG_{{VERSION}}_amd64.AppImage` |

### First launch

- **Windows:** the builds are not code-signed yet, so SmartScreen may say "Windows protected your PC".
  Click **More info → Run anyway**. The portable build needs the WebView2 runtime, which ships with
  Windows 10 (21H2+) and Windows 11.
- **macOS:** the app is not notarized yet. Open it once with right-click → **Open**, or allow it in
  **System Settings → Privacy & Security → Open Anyway**. If macOS says the app "is damaged", run
  `xattr -cr /Applications/LumioNG.app`.
- **Linux AppImage:** `chmod +x LumioNG_*.AppImage` and run it. Requires WebKitGTK 4.1
  (Ubuntu 22.04+, Debian 12+, Fedora 36+).

Portable builds still keep settings and saved connections in your user profile, the same place as
the installed app.

## What's new

<!-- Write the changes for this release here before publishing. -->
