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

    private var askedNotif = false

    /** 网页把当前歌曲 / 播放状态交给原生，用来显示状态栏、锁屏的通知 */
    inner class MusicNotifBridge {
        @android.webkit.JavascriptInterface
        fun update(json: String) {
            runOnUiThread {
                try {
                    // Android 13+ 要先授权「通知」，只在第一次播放时问一次
                    if (android.os.Build.VERSION.SDK_INT >= 33 && !askedNotif &&
                        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        askedNotif = true
                        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 71)
                    }
                    val o = org.json.JSONObject(json)
                    MusicService.push(
                        this@MainActivity, o.optString("title"), o.optString("artist"), o.optString("album"), o.optString("cover"),
                        o.optLong("dur"), o.optLong("pos"), o.optBoolean("playing"),
                    )
                } catch (_: Exception) { }
            }
        }

        @android.webkit.JavascriptInterface
        fun clear() { runOnUiThread { try { MusicService.clear(this@MainActivity) } catch (_: Exception) { } } }
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))
        // 所有安卓版本统一成「内容铺满全屏 + 透明系统栏」。不设的话，部分手机（Android 14 及以下 / 国产 ROM）
        // 会用系统主题色涂状态栏（紫色）和导航栏（白色）
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
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
        webView.addJavascriptInterface(MusicNotifBridge(), "AndroidMusicNotif")
        // 通知栏 / 锁屏按钮 → 网页里的播放器
        MusicService.onCommand = { c, a ->
            runOnUiThread { web?.evaluateJavascript("window.__musicCmd&&window.__musicCmd('$c',$a)", null) }
        }
    }

    override fun onPause() {
        bridge?.pauseForBackground()
        super.onPause()
        // 音乐在播放：不让 WebView 跟着暂停，后台继续播
        if (musicOn) web?.onResume()
    }

    override fun onDestroy() {
        MusicService.onCommand = null
        try { MusicService.clear(this) } catch (_: Exception) { }
        try { if (wake?.isHeld == true) wake?.release() } catch (_: Exception) { }
        bridge?.release()
        super.onDestroy()
    }
}
