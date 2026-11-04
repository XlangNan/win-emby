package com.winemby.app

import android.graphics.Color
import android.webkit.WebView

class MainActivity : TauriActivity() {
    private var bridge: MpvBridge? = null

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))
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
