package com.weave.player

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory
import android.util.Base64

/**
 * 安卓端网络桥：支持 HTTP/SOCKS5 代理，以及「域名 → IP」强制解析（等价于改 hosts，IPv4 / IPv6 都行）。
 * 网页里 httpFetch 在设置了代理或命中 hosts 时会走这里；其余请求仍走原来的通道。
 */
class NetBridge(private val web: WebView) {
    private val pool = Executors.newFixedThreadPool(6)

    @JavascriptInterface
    fun request(id: String, json: String) {
        pool.execute {
            val out = try {
                doRequest(JSONObject(json))
            } catch (e: Throwable) {
                JSONObject().put("error", e.message ?: e.toString())
            }
            val js = "window.__netDone(" + JSONObject.quote(id) + "," + JSONObject.quote(out.toString()) + ")"
            web.post { web.evaluateJavascript(js, null) }
        }
    }

    private class SniFactory(private val d: SSLSocketFactory, private val realHost: String) : SSLSocketFactory() {
        override fun getDefaultCipherSuites(): Array<String> = d.defaultCipherSuites
        override fun getSupportedCipherSuites(): Array<String> = d.supportedCipherSuites
        override fun createSocket(s: Socket, host: String, port: Int, autoClose: Boolean): Socket = d.createSocket(s, realHost, port, autoClose)
        override fun createSocket(host: String, port: Int): Socket = d.createSocket(realHost, port)
        override fun createSocket(host: String, port: Int, la: java.net.InetAddress, lp: Int): Socket = d.createSocket(realHost, port, la, lp)
        override fun createSocket(host: java.net.InetAddress, port: Int): Socket = d.createSocket(host, port)
        override fun createSocket(a: java.net.InetAddress, port: Int, la: java.net.InetAddress, lp: Int): Socket = d.createSocket(a, port, la, lp)
    }

    private fun parseProxy(p: String): Proxy? {
        if (p.isBlank()) return null
        val u = URL(if (Regex("^[a-z0-9]+://", RegexOption.IGNORE_CASE).containsMatchIn(p)) p.replaceFirst(Regex("^socks5h?://", RegexOption.IGNORE_CASE), "socks://") else "http://$p")
        val type = if (u.protocol.startsWith("socks")) Proxy.Type.SOCKS else Proxy.Type.HTTP
        return Proxy(type, InetSocketAddress.createUnresolved(u.host, if (u.port > 0) u.port else if (type == Proxy.Type.SOCKS) 1080 else 7890))
    }

    private fun doRequest(r: JSONObject): JSONObject {
        val url = URL(r.getString("url"))
        val host = url.host
        val proxy = parseProxy(r.optString("proxy", ""))
        val ips = ArrayList<String>()
        if (proxy == null) r.optJSONObject("hosts")?.optJSONArray(host)?.let { a -> for (i in 0 until a.length()) ips.add(a.getString(i)) }
        val tries: List<String?> = if (ips.isEmpty()) listOf(null) else ips
        var last: Throwable? = null
        for (ip in tries) {
            try {
                return once(r, url, host, proxy, ip)
            } catch (e: Throwable) {
                last = e
            }
        }
        throw last ?: RuntimeException("请求失败")
    }

    private fun once(r: JSONObject, url: URL, host: String, proxy: Proxy?, ip: String?): JSONObject {
        val target = if (ip != null) URL(url.protocol, if (ip.contains(':')) "[$ip]" else ip, url.port, url.file) else url
        val c = (if (proxy != null) target.openConnection(proxy) else target.openConnection()) as HttpURLConnection
        c.connectTimeout = r.optInt("timeout", 20000)
        c.readTimeout = r.optInt("timeout", 30000)
        c.requestMethod = r.optString("method", "GET")
        c.instanceFollowRedirects = true
        if (ip != null) {
            c.setRequestProperty("Host", if (url.port > 0) "$host:${url.port}" else host)
            if (c is HttpsURLConnection) {
                c.sslSocketFactory = SniFactory(HttpsURLConnection.getDefaultSSLSocketFactory() as SSLSocketFactory, host)
                c.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, s -> HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s) }
            }
        }
        val hs = r.optJSONObject("headers")
        if (hs != null) for (k in hs.keys()) if (!k.equals("host", true)) c.setRequestProperty(k, hs.getString(k))
        val body = r.optString("body", "")
        if (body.isNotEmpty()) {
            c.doOutput = true
            c.outputStream.use { it.write(Base64.decode(body, Base64.DEFAULT)) }
        }
        val code = c.responseCode
        val stream = if (code >= 400) c.errorStream else c.inputStream
        val bos = ByteArrayOutputStream()
        stream?.use { s -> val buf = ByteArray(16384); while (true) { val n = s.read(buf); if (n < 0) break; bos.write(buf, 0, n) } }
        val hdr = JSONObject()
        for ((k, v) in c.headerFields) if (k != null && v.isNotEmpty()) hdr.put(k, v.joinToString(", "))
        c.disconnect()
        return JSONObject().put("status", code).put("headers", hdr).put("body", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP))
    }
}
