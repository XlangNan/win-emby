package com.weave.player

import android.content.Context
import android.net.wifi.WifiManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.Collections

/**
 * DLNA 设备搜索（SSDP）。网页里没法发 UDP 组播，所以由这里发 M-SEARCH，把收到的原始回应交回网页解析。
 * 需要 CHANGE_WIFI_MULTICAST_STATE 权限（android-patch.mjs 会写进清单）和一把 MulticastLock，
 * 否则不少手机会把收到的组播包直接丢掉。
 * 每个可用的 IPv4 网卡各发一次：开着移动数据时只走默认网卡，常常搜不到 Wi-Fi 里的设备。
 */
class DlnaBridge(private val ctx: Context, private val web: WebView) {
    private val queries = listOf(
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n",
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n"
    )

    @JavascriptInterface
    fun search(id: String, ms: Int) {
        Thread {
            val out = JSONObject()
            var lock: WifiManager.MulticastLock? = null
            try {
                val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                lock = wm?.createMulticastLock("weave:dlna")?.also { it.setReferenceCounted(false); it.acquire() }
                val list = JSONArray()
                val total = ms.coerceIn(500, 8000)
                val workers = ArrayList<Thread>()
                val sink = Collections.synchronizedList(ArrayList<String>())
                for (ni in NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()) {
                    if (!ni.isUp || ni.isLoopback || !ni.supportsMulticast()) continue
                    val ip = ni.inetAddresses.toList().firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress } ?: continue
                    val t = Thread { sink.addAll(one(ni, ip, total)) }
                    workers.add(t); t.start()
                }
                workers.forEach { it.join() }
                sink.forEach { list.put(it) }
                out.put("list", list)
            } catch (e: Throwable) {
                out.put("error", e.message ?: e.toString())
            } finally {
                try { lock?.release() } catch (_: Throwable) {}
            }
            val js = "window.__dlnaDone&&window.__dlnaDone(" + JSONObject.quote(id) + "," + JSONObject.quote(out.toString()) + ")"
            web.post { web.evaluateJavascript(js, null) }
        }.start()
    }

    private fun one(ni: NetworkInterface, ip: InetAddress, ms: Int): List<String> {
        val res = ArrayList<String>()
        var s: MulticastSocket? = null
        try {
            s = MulticastSocket(InetSocketAddress(ip, 0))
            s.networkInterface = ni
            s.timeToLive = 4
            s.soTimeout = 250
            val dst = InetSocketAddress(InetAddress.getByName("239.255.255.250"), 1900)
            // UDP 可能丢包：整套查询发两遍
            for (round in 0 until 2) {
                for (q in queries) {
                    val b = q.toByteArray()
                    s.send(DatagramPacket(b, b.size, dst))
                }
                if (round == 0) Thread.sleep(120)
            }
            val end = System.currentTimeMillis() + ms
            val buf = ByteArray(2048)
            while (System.currentTimeMillis() < end) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    res.add(String(p.data, 0, p.length))
                } catch (_: java.net.SocketTimeoutException) {
                }
            }
        } catch (_: Throwable) {
        } finally {
            try { s?.close() } catch (_: Throwable) {}
        }
        return res
    }
}
