#!/bin/bash
set -e

echo "Installing imsg (Node.js version for macOS 11+)..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 14+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    echo "Error: Node.js version 14 or higher is required"
    echo "Current version: $(node -v)"
    exit 1
fi

# Check macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "Error: imsg is only compatible with macOS"
    exit 1
fi

# Check macOS version
MACOS_VERSION=$(sw_vers -productVersion | cut -d'.' -f1,2)
MACOS_MAJOR=$(sw_vers -productVersion | cut -d'.' -f1)
echo "Detected macOS $MACOS_VERSION"

# Validate macOS version is 11+
if [ "$MACOS_MAJOR" -lt 11 ]; then
    echo "Error: imsg requires macOS 11 (Big Sur) or later"
    echo "Current version: $(sw_vers -productVersion)"
    exit 1
fi
echo "✓ macOS version compatible: $(sw_vers -productVersion)"

# Install dependencies
echo "Installing dependencies..."
npm install

# Create symlink
echo "Creating global command..."
npm link

echo ""
echo "✓ Installation complete!"
echo ""
echo "Please grant permissions:"
echo "1. Full Disk Access: System Preferences → Security & Privacy → Privacy → Full Disk Access"
echo "   Add Terminal (or iTerm) to the list"
echo ""
echo "2. Automation: System Preferences → Security & Privacy → Privacy → Automation"
echo "   Find 'Messages' and check Terminal (or your terminal app)"
echo ""
echo "Then try:"
echo "  imsg chats --limit 5"
echo ""
echo "Test send (replace with your test email):"
echo "  imsg send --to \"test@example.com\" --text \"Test\""
echo ""
