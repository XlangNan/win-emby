package com.winemby.app

import android.graphics.Color
import android.media.AudioManager
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    private var bridge: MpvBridge? = null

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))
        // 手机音量键始终调「媒体音量」
        volumeControlStream = AudioManager.STREAM_MUSIC

        // 深色界面：状态栏 / 导航栏用浅色图标；内容区按系统栏和刘海留白（播放全屏时不留）
        val ic = WindowCompat.getInsetsController(window, window.decorView)
        ic.isAppearanceLightStatusBars = false
        ic.isAppearanceLightNavigationBars = false
        val content = findViewById<android.view.ViewGroup>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
            if (MpvBridge.fullscreen) {
                v.setPadding(0, 0, 0, 0)
            } else {
                val m = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                v.setPadding(m.left, m.top, m.right, m.bottom)
            }
            WindowInsetsCompat.CONSUMED
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.setBackgroundColor(Color.TRANSPARENT)
        val b = MpvBridge(this, webView)
        bridge = b
        webView.addJavascriptInterface(b, "AndroidMpv")
    }

    override fun onPause() {
        bridge?.pauseForBackground()
        super.onPause()
    }

    override fun onDestroy() {
        bridge?.release()
        super.onDestroy()
    }
}
