# ADB Logger Client 🤖📱

A lightning-fast, modern, desktop Graphical User Interface (GUI) for Android Debug Bridge (ADB), built with **Rust (Tauri)** and **React**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 🌟 Features

- **Device Management**: View, connect, and manage connected Android devices (USB and Wireless/mDNS supported).
- **Logcat Streaming**: Highly performant, real-time filtered Android logging right in your desktop.
- **Background APK Builder**: Built-in support to compile your Android Projects (`assembleDebug` & `assembleRelease`) in the background.
- **One-Click Installs**: Scan folders for `.apk` files and auto-install them.
- **scrcpy Integration**: Screen Mirroring built-in! If scrcpy isn't installed, the app can automatically install it via Homebrew/apt/winget.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Rust](https://www.rust-lang.org/tools/install)
- [Android Platform Tools / ADB](https://developer.android.com/studio/releases/platform-tools) available on your system path.
- *Optional*: `scrcpy` for screen mirroring functionality.

### Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/YOUR_USERNAME/adb-debugger.git
   cd adb-debugger
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Run in development mode:
   ```bash
   pnpm tauri dev
   ```

## 🛠 Building for Production

To build a standalone executable for your operating system:
```bash
pnpm tauri build
```
This will generate the installer (`.dmg`, `.app`, `.exe`, or `.deb` depending on your OS) inside `src-tauri/target/release/bundle/`.

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! 

## 📝 License
This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.
