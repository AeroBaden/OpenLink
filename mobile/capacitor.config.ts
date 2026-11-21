import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.openlink.app',
  appName: 'OpenLink',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000',
    captureInput: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
