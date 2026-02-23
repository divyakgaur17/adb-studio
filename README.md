# ADB Studio 🤖⚡️

A lightning-fast, modern, desktop Graphical User Interface (GUI) for Android Debug Bridge (ADB), built with **Rust (Tauri)** and **React**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 🌟 Why Use ADB Studio? (The Pitch)

Are you a **React Native, Expo, Flutter, or AI Mobile** developer? Does opening full-blown **Android Studio** to read a single log line or build an APK consume 8GB of your Mac's RAM and cause it to overheat? 

**ADB Studio is your solution.** 
Built on **Rust (Tauri)**, this desktop client uses less than ~50MB of RAM. It gives you a gorgeous, Apple-styled GUI for 90% of the tasks you realistically need Android Studio for, without ever leaving your VS Code / Cursor workflow. No heavy JVMs, no memory leaks—just lightning-fast ADB commands wrapped in a beautiful interface.

## 🚀 Key Features

We've packed ADB Studio with everything you need to debug and manage your devices seamlessly:

### 📱 **Refined Tabbed UI**
A beautiful, premium Apple-style interface with dedicated workspaces for Debugging, App Management, Profiling, and File Exploration.

### 📝 **Advanced Logcat Analysis**
- **Regex Filtering & Highlighting:** Instantly find what you need with advanced regex support.
- **Crash Detection:** Automatic crash isolation and highlighting so you never miss a fatal exception.
- **Export Logs:** Save logs locally with a single click.

### 📊 **Real-time Device Profiler**
Live, low-latency monitoring of CPU, RAM, and Battery stats for your connected devices, right from the dashboard.

### 📦 **Advanced App Manager**
- **Complete Control:** View installed apps, Launch, Stop, Clear Data, or Uninstall them instantly.
- **APK Extraction:** Pull the raw `.apk` file of any installed app directly to your computer.
- **Deep Link Tester:** Trigger deep links effortlessly without memorizing complex ADB shell intents.
- **Permission Manager:** Toggle runtime permissions for apps via the GUI.

### 📂 **Native File Explorer & Gallery**
- **File Browser:** Browse `/sdcard` intuitively, Push/Pull files, and delete items directly from your computer.
- **Smart Media Gallery:** Dedicated photo & video viewer that recursively scans Android's `DCIM`, `Pictures`, and `Movies` folders. Features lazy-loaded thumbnail caching and a beautiful grid layout!

### 📸 **One-Click Screen Utilities**
- **Screen Recording:** Record your screen directly from the app.
- **Instant Screenshots:** Capture screenshots that automatically copy straight to your clipboard (as well as an optional file save).

### 🛠 **Background APK Builder & scrcpy**
- **Compile in Background:** Built-in support to compile your Android Projects (`assembleDebug` & `assembleRelease`).
- **One-Click Installs:** Scan folders for `.apk` files and auto-install them.
- **scrcpy Integration:** Screen Mirroring built-in! If scrcpy isn't installed, the app can automatically install it via Homebrew/apt/winget.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Rust](https://www.rust-lang.org/tools/install)
- [Android Platform Tools / ADB](https://developer.android.com/studio/releases/platform-tools) available on your system path.
- *Optional*: [scrcpy](cci:1://file:///Users/divyak/Downloads/adb-debugger/src-tauri/src/main.rs:353:0-398:1) for screen mirroring functionality.

### Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/divyakgaur17/adb-studio.git
   cd adb-studio
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
