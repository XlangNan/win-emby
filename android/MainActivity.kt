package com.weave.player

import android.graphics.Color
import android.media.AudioManager
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    private var bridge: MpvBridge? = null
    private var web: WebView? = null
    private var musicOn = false
    private var wake: android.os.PowerManager.WakeLock? = null

    /** 网页里的音乐在播放时：保持 CPU 唤醒，切到后台 / 息屏后继续出声 */
    inner class MusicKeep {
        @android.webkit.JavascriptInterface
        fun playing(on: Boolean) {
            runOnUiThread {
                musicOn = on
                try {
                    if (on) {
                        if (wake == null) {
                            val pm = getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
                            wake = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "weave:music")
                            wake?.setReferenceCounted(false)
                        }
                        // 每次调用都先释放再重新申请：JS 端播放中会定期续期，不会 4 小时后悄悄失效
                        if (wake?.isHeld == true) wake?.release()
                        wake?.acquire(4 * 60 * 60 * 1000L)
                    } else if (wake?.isHeld == true) {
                        wake?.release()
                    }
                } catch (_: Exception) { }
            }
        }
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))
        // 手机音量键始终调「媒体音量」
        volumeControlStream = AudioManager.STREAM_MUSIC
        // 和主流流媒体 App 一样：平时锁竖屏，只有播放时才横屏
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT

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
                // 顶部不留白：网页自己按 --sat 留（详情页要让图片铺到状态栏下面）
                v.setPadding(m.left, 0, m.right, m.bottom)
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
        webView.addJavascriptInterface(NetBridge(webView), "AndroidNet")
        web = webView
        webView.addJavascriptInterface(MusicKeep(), "AndroidMusic")
    }

    override fun onPause() {
        bridge?.pauseForBackground()
        super.onPause()
        // 音乐在播放：不让 WebView 跟着暂停，后台继续播
        if (musicOn) web?.onResume()
    }

    override fun onDestroy() {
        try { if (wake?.isHeld == true) wake?.release() } catch (_: Exception) { }
        bridge?.release()
        super.onDestroy()
    }
}
