const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withGradleProperties,
  withDangerousMod,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// Copies google-services.json, applies google-services Gradle plugin,
// and sets android.minSdkVersion=24 (required by react-native-webrtc).
const withFirebase = (config) => {
  // 1. Copy google-services.json from project root into android/app/
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const src = path.resolve(cfg.modRequest.projectRoot, 'google-services.json');
      const dest = path.resolve(cfg.modRequest.platformProjectRoot, 'app', 'google-services.json');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('✅ google-services.json copied to android/app/');
      } else {
        console.warn('⚠️  google-services.json not found at project root — FCM will not work');
      }
      return cfg;
    },
  ]);

  // 2. Add google-services classpath to root build.gradle
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n        classpath('com.google.gms:google-services:4.4.4')"
      );
    }
    return cfg;
  });

  // 3. Apply google-services plugin in app/build.gradle
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms.google-services')) {
      cfg.modResults.contents += "\napply plugin: 'com.google.gms.google-services'\n";
    }
    return cfg;
  });

  // 4. Gradle properties: minSdkVersion=24 + increased heap for Jetifier
  config = withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      cfg.modResults = cfg.modResults.filter((item) => item.key !== key);
      cfg.modResults.push({ type: 'property', key, value });
    };
    set('android.minSdkVersion', '24');
    set('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=512m');
    set('org.gradle.parallel', 'true');
    return cfg;
  });

  return config;
};

module.exports = withFirebase;
