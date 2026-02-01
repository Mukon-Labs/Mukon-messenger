#!/bin/bash

# Mukon Messenger - APK Build Script
# Builds APK and outputs to app/ folder for easy access
# Usage: ./build-apk.sh [debug|release] [clean]

set -e  # Exit on error

echo "🔨 Building Mukon APK..."
echo ""

# Determine build variant (debug or release)
VARIANT=${1:-debug}
CLEAN_FLAG=${2}

if [ "$VARIANT" = "release" ]; then
  echo "📦 Building RELEASE APK..."
  GRADLE_TASK="assembleRelease"
  APK_NAME="mukon-release.apk"
  SOURCE_PATH="android/app/build/outputs/apk/release/app-release.apk"

  # Bundle JS for release using Expo
  echo "📦 Bundling JavaScript with Expo..."
  mkdir -p android/app/src/main/assets

  # Export the app bundle
  npx expo export:embed --platform android --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --dev false

  echo "✅ JavaScript bundled"
  echo ""
else
  echo "🐛 Building DEBUG APK..."
  GRADLE_TASK="assembleDebug"
  APK_NAME="mukon-debug.apk"
  SOURCE_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
fi

# Navigate to android folder
cd android

# Run clean if requested
if [ "$CLEAN_FLAG" = "clean" ]; then
  echo "🧹 Running gradle clean..."
  ./gradlew clean
  echo ""
fi

# Build
./gradlew $GRADLE_TASK

# Go back to app folder
cd ..

# Copy APK to app root with clean name
if [ -f "$SOURCE_PATH" ]; then
  cp "$SOURCE_PATH" "$APK_NAME"

  # Get file size
  SIZE=$(ls -lh "$APK_NAME" | awk '{print $5}')

  echo ""
  echo "✅ Build complete!"
  echo "📱 APK: $APK_NAME ($SIZE)"
  echo "📍 Location: $(pwd)/$APK_NAME"
  echo ""
  echo "Install with: adb install -r $APK_NAME"
else
  echo "❌ Build failed - APK not found at $SOURCE_PATH"
  exit 1
fi
