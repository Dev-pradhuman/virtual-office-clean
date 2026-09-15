#!/bin/bash
set -e

# Define directories
SRC_DIR="/mnt/c/Users/Pradhuman/projects/virtual-office (Copy)"
BUILD_DIR="/tmp/vo-linux-build"
DEST_DIR="${SRC_DIR}/dist-linux"

echo "Step 1/5: Copying project to WSL native filesystem (skipping heavy node_modules)..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
rsync -a --exclude 'node_modules' --exclude 'Team Hearth/node_modules' --exclude 'dist' --exclude 'dist-new' --exclude '.git' "$SRC_DIR/" "$BUILD_DIR/"

cd "$BUILD_DIR"
echo "Step 2/5: Workspace ready..."

echo "Step 3/5: Installing dependencies for Linux (this compiles sqlite3 natively)..."
npm install
npm install --prefix "Team Hearth"

echo "Step 4/5: Building Linux installers (AppImage, deb)..."
npx electron-builder --linux AppImage deb

echo "Step 5/5: Copying installers back to Windows..."
mkdir -p "$DEST_DIR"
cp dist/*.AppImage "$DEST_DIR/" 2>/dev/null || true
cp dist/*.deb "$DEST_DIR/" 2>/dev/null || true

echo "======================================"
echo "Build complete! Linux installers are in the 'dist-linux' folder."
echo "======================================"
