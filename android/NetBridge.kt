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
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.zip.GZIPInputStream
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
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

    private fun parseProxy(p: String): Proxy? {
        val t = p.trim()
        if (t.isEmpty()) return null
        val m = Regex("^([a-z0-9]+)://", RegexOption.IGNORE_CASE).find(t)
        val scheme = m?.groupValues?.get(1)?.lowercase() ?: "http"
        val rest = t.removePrefix(m?.value ?: "").substringBefore('/').substringAfterLast('@')
        val type = if (scheme.startsWith("socks")) Proxy.Type.SOCKS else Proxy.Type.HTTP
        val host = rest.substringBeforeLast(':', rest)
        val port = rest.substringAfterLast(':', "").toIntOrNull() ?: if (type == Proxy.Type.SOCKS) 1080 else 7890
        return Proxy(type, InetSocketAddress.createUnresolved(host, port))
    }

    private fun doRequest(r: JSONObject): JSONObject {
        val url = URL(r.getString("url"))
        val host = url.host.lowercase()   // JS 端的 hosts 表是小写的，这里也统一成小写再查
        val proxy = parseProxy(r.optString("proxy", ""))
        val ips = ArrayList<String>()
        if (proxy == null) r.optJSONObject("hosts")?.optJSONArray(host)?.let { a -> for (i in 0 until a.length()) ips.add(a.getString(i)) }
        val tries: List<String?> = if (ips.isEmpty()) listOf(null) else ips
        var last: Throwable? = null
        for (ip in tries) {
            try {
                return if (proxy != null) viaProxy(r, url, proxy) else if (ip != null) viaIp(r, url, host, ip) else viaProxy(r, url, Proxy.NO_PROXY)
            } catch (e: Throwable) {
                last = e
            }
        }
        throw last ?: RuntimeException("请求失败")
    }

    /** 走代理：交给系统的 HttpURLConnection（代理会自己解析域名） */
    private fun viaProxy(r: JSONObject, url: URL, proxy: Proxy): JSONObject {
        val c = url.openConnection(proxy) as HttpURLConnection
        c.connectTimeout = r.optInt("timeout", 20000)
        c.readTimeout = r.optInt("timeout", 30000)
        c.requestMethod = r.optString("method", "GET")
        c.instanceFollowRedirects = true
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

    private fun readLine(i: InputStream): String? {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read()
            if (c < 0) return if (b.size() == 0) null else b.toString("ISO-8859-1")
            if (c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
        }
        return b.toString("ISO-8859-1")
    }

    /** hosts 强制解析：自己连 IP，TLS 握手时带上真实域名（SNI + 证书校验），再手写 HTTP/1.1 请求 */
    private fun viaIp(r: JSONObject, url: URL, host: String, ip: String, redirects: Int = 0): JSONObject {
        val https = url.protocol.equals("https", true)
        val port = if (url.port > 0) url.port else if (https) 443 else 80
        val timeout = r.optInt("timeout", 20000)
        val raw = Socket()
        raw.connect(InetSocketAddress(java.net.InetAddress.getByName(ip), port), timeout)
        raw.soTimeout = r.optInt("timeout", 30000)
        val sock: Socket = if (https) {
            val ssl = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, port, true) as SSLSocket
            val p = ssl.sslParameters
            p.serverNames = listOf(SNIHostName(host))
            ssl.sslParameters = p
            ssl.startHandshake()
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.session)) throw RuntimeException("证书与域名不匹配：$host")
            ssl
        } else raw
        sock.use {
            val method = r.optString("method", "GET")
            val body = r.optString("body", "")
            val bytes = if (body.isNotEmpty()) Base64.decode(body, Base64.DEFAULT) else ByteArray(0)
            val sb = StringBuilder()
            sb.append("$method ${url.file.ifEmpty { "/" }} HTTP/1.1\r\n")
            sb.append("Host: ${if (url.port > 0) "$host:${url.port}" else host}\r\n")
            sb.append("Connection: close\r\nAccept-Encoding: identity\r\n")
            val hs = r.optJSONObject("headers")
            if (hs != null) for (k in hs.keys()) {
                if (k.equals("host", true) || k.equals("connection", true) || k.equals("accept-encoding", true) || k.equals("content-length", true)) continue
                sb.append("$k: ${hs.getString(k)}\r\n")
            }
            if (bytes.isNotEmpty()) sb.append("Content-Length: ${bytes.size}\r\n")
            sb.append("\r\n")
            val out = sock.getOutputStream()
            out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
            if (bytes.isNotEmpty()) out.write(bytes)
            out.flush()
            val inp = java.io.BufferedInputStream(sock.getInputStream())
            val status = readLine(inp)?.split(" ")?.getOrNull(1)?.toIntOrNull() ?: throw RuntimeException("响应格式不对")
            val hdr = JSONObject()
            val lower = HashMap<String, String>()
            while (true) {
                val l = readLine(inp) ?: break
                if (l.isEmpty()) break
                val i = l.indexOf(':')
                if (i > 0) { val k = l.substring(0, i).trim(); val v = l.substring(i + 1).trim(); hdr.put(k, v); lower[k.lowercase()] = v }
            }
            val loc = lower["location"]
            if (status in 301..308 && loc != null && redirects < 3 && method == "GET") {
                val next = URL(url, loc)
                val nh = next.host
                if (nh.equals(host, true)) return viaIp(r, next, host, ip, redirects + 1)
            }
            val bos = ByteArrayOutputStream()
            if (lower["transfer-encoding"]?.contains("chunked", true) == true) {
                while (true) {
                    val sz = (readLine(inp) ?: break).substringBefore(';').trim().toIntOrNull(16) ?: break
                    if (sz == 0) break
                    val buf = ByteArray(sz); var got = 0
                    while (got < sz) { val n = inp.read(buf, got, sz - got); if (n < 0) break; got += n }
                    bos.write(buf, 0, got)
                    readLine(inp)
                }
            } else {
                val cl = lower["content-length"]?.toLongOrNull()
                val buf = ByteArray(16384); var left = cl ?: Long.MAX_VALUE
                while (left > 0) { val n = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (n < 0) break; bos.write(buf, 0, n); left -= n }
            }
            var data = bos.toByteArray()
            if (lower["content-encoding"]?.contains("gzip", true) == true) data = GZIPInputStream(ByteArrayInputStream(data)).readBytes()
            return JSONObject().put("status", status).put("headers", hdr).put("body", Base64.encodeToString(data, Base64.NO_WRAP))
        }
    }
}
