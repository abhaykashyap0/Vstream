package com.vstream.app;

import android.os.Bundle;
import android.os.PowerManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.content.Context;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Acquire wake lock to keep CPU running when screen is off
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "VStream::AudioWakeLock"
        );
    }

    @Override
    public void onPause() {
        super.onPause();
        // Acquire wake lock to keep CPU + audio alive in background
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(3 * 60 * 60 * 1000L); // 3 hours max
        }
        // Force WebView to stay active
        getBridge().getWebView().onResume();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Release wake lock when app is in foreground (screen handles it)
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        getBridge().getWebView().onResume();
    }

    @Override
    public void onStop() {
        super.onStop();
        getBridge().getWebView().onResume();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }
}