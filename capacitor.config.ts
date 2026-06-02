import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vstream.app',
  appName: 'VStream',
  webDir: 'client/build',
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#000000',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;