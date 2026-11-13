package com.weave.player

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.SubtitleView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

/**
 * ExoPlayer（Media3）播放内核。对网页暴露的接口和 MpvBridge 的 init / command / getProp / destroy 完全一致：
 * 网页里 window.AndroidExo.*，事件同样走 window.__mpvEvt(name, value)，所以播放页、一起看、手势全部沿用。
 * 亮度 / 音量 / 全屏 / 退出仍由 MpvBridge 负责（window.AndroidMpv）。
 */
@UnstableApi
class ExoBridge(private val act: Activity, private val web: WebView) : Player.Listener {
    private val main = Handler(Looper.getMainLooper())
    private var root: FrameLayout? = null
    private var sv: SurfaceView? = null
    private var subs: SubtitleView? = null
    private var p: ExoPlayer? = null
    private var dsf: DefaultHttpDataSource.Factory? = null
    private var ua = "Emby/4.8 (Linux; Android) ExoPlayerLib/1.3.1"

    private var extSubs = ArrayList<MediaItem.SubtitleConfiguration>()
    private var curUrl = ""
    private var pendAid = -1          // >0：载入后选第 N 条音轨
    private var pendSid = -2          // -2 = 不动；-1 = 关字幕；>0 = 第 N 条；-3 = 选最后一条（刚挂上的外挂字幕）
    private var lastErr = ""
    private var lastTime = -10.0
    private var lastCache = -10.0
    private var lastDur = -1.0
    private var started = false

    private val tick = object : Runnable {
        override fun run() {
            val pl = p ?: return
            if (pl.playbackState != Player.STATE_IDLE) {
                val t = pl.currentPosition / 1000.0
                if (kotlin.math.abs(t - lastTime) >= 0.25) { lastTime = t; emit("time-pos", t.toString()) }
                val c = pl.bufferedPosition / 1000.0
                if (kotlin.math.abs(c - lastCache) >= 0.5) { lastCache = c; emit("demuxer-cache-time", c.toString()) }
                val d = pl.duration
                if (d != C.TIME_UNSET && d > 0 && kotlin.math.abs(d / 1000.0 - lastDur) > 0.5) {
                    lastDur = d / 1000.0; emit("duration", lastDur.toString())
                }
            }
            main.postDelayed(this, 250)
        }
    }

    private fun <T> onMain(def: T, f: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return try { f() } catch (_: Throwable) { def }
        val out = AtomicReference<T>(def)
        val l = CountDownLatch(1)
        main.post { try { out.set(f()) } catch (_: Throwable) { } finally { l.countDown() } }
        l.await()
        return out.get()
    }

    // ───────── 初始化 / 销毁 ─────────
    @JavascriptInterface
    fun init(json: String): String {
        return try {
            val err = onMain("ExoPlayer 初始化失败") {
                release()
                val parent = web.parent as ViewGroup
                val fl = FrameLayout(act)
                val v = SurfaceView(act)
                fl.addView(v, FrameLayout.LayoutParams(-1, -1))
                val sub = SubtitleView(act)
                fl.addView(sub, FrameLayout.LayoutParams(-1, -1))
                parent.addView(fl, 0, ViewGroup.LayoutParams(-1, -1))
                root = fl; sv = v; subs = sub
                val f = DefaultHttpDataSource.Factory()
                    .setUserAgent(ua)
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(15000)
                    .setReadTimeoutMs(20000)
                dsf = f
                val lc = DefaultLoadControl.Builder()
                    .setBufferDurationsMs(30000, 120000, 2500, 5000)
                    .build()
                val pl = ExoPlayer.Builder(act, DefaultRenderersFactory(act).setEnableDecoderFallback(true))
                    .setMediaSourceFactory(DefaultMediaSourceFactory(act).setDataSourceFactory(f))
                    .setLoadControl(lc)
                    .build()
                pl.setVideoSurfaceView(v)
                pl.addListener(this)
                pl.setSeekParameters(SeekParameters.CLOSEST_SYNC)
                p = pl
                act.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                main.removeCallbacks(tick); main.postDelayed(tick, 250)
                ""
            }
            if (err.isNotEmpty()) err else { emit("__ready", "true"); "ok" }
        } catch (t: Throwable) {
            "ExoPlayer 初始化失败：$t"
        }
    }

    @JavascriptInterface
    fun destroy() { onMain(Unit) { release() } }

    private fun release() {
        main.removeCallbacks(tick)
        p?.let { try { it.removeListener(this); it.release() } catch (_: Throwable) {} }
        p = null
        root?.let { (it.parent as? ViewGroup)?.removeView(it) }
        root = null; sv = null; subs = null
        started = false
        try { act.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) } catch (_: Throwable) {}
    }

    /** 切到后台时暂停 */
    fun pauseForBackground() { main.post { try { p?.playWhenReady = false } catch (_: Throwable) {} } }

    // ───────── 命令 ─────────
    @JavascriptInterface
    fun command(json: String): String {
        return try {
            val a = JSONArray(json)
            val args = List(a.length()) { a.getString(it) }
            var err = ""
            onMain(Unit) { try { exec(args) } catch (t: Throwable) { err = "命令失败：$t" } }
            if (err.isEmpty()) "ok" else err
        } catch (t: Throwable) {
            "命令失败：$t"
        }
    }

    private fun truthy(s: String) = s == "yes" || s == "true" || s == "1"

    private fun exec(a: List<String>) {
        val pl = p ?: throw IllegalStateException("ExoPlayer 未初始化")
        when (a[0]) {
            "loadfile" -> {
                val url = a[1]
                val opts = HashMap<String, String>()
                if (a.size > 4 && a[4].isNotEmpty()) for (kv in a[4].split(',')) {
                    val i = kv.indexOf('='); if (i > 0) opts[kv.substring(0, i)] = kv.substring(i + 1)
                }
                extSubs = ArrayList()
                curUrl = url
                pendAid = opts["aid"]?.toIntOrNull() ?: -1
                pendSid = when (val s = opts["sid"]) { null -> -2; "no" -> -1; else -> s.toIntOrNull() ?: -2 }
                lastErr = ""; started = false; lastTime = -10.0; lastCache = -10.0; lastDur = -1.0
                dsf?.setUserAgent(ua)
                val startMs = ((opts["start"]?.toDoubleOrNull() ?: 0.0) * 1000).toLong()
                pl.setMediaItem(MediaItem.Builder().setUri(url).build(), startMs)
                pl.prepare()
                pl.playWhenReady = true
                emit("eof-reached", "false")
                emit("pause", "false")
            }
            "set" -> setProp(pl, a[1], a.getOrElse(2) { "" })
            "seek" -> {
                val t = a[1].toDoubleOrNull() ?: 0.0
                val f = a.getOrElse(2) { "relative" }
                pl.setSeekParameters(if (f.contains("exact")) SeekParameters.EXACT else SeekParameters.CLOSEST_SYNC)
                val ms = if (f.contains("absolute")) (t * 1000).toLong() else pl.currentPosition + (t * 1000).toLong()
                val dur = pl.duration
                val to = if (dur != C.TIME_UNSET) ms.coerceIn(0, dur) else ms.coerceAtLeast(0)
                if (pl.playbackState == Player.STATE_ENDED) pl.playWhenReady = false
                pl.seekTo(to)
                lastTime = to / 1000.0
                emit("time-pos", lastTime.toString())
            }
            "cycle" -> when (a.getOrNull(1)) {
                "pause" -> setProp(pl, "pause", if (pl.playWhenReady) "yes" else "no")
                "mute" -> setProp(pl, "mute", if (pl.volume > 0f) "yes" else "no")
            }
            "stop" -> pl.stop()
            "sub-add" -> addSub(pl, a)
            else -> { /* 其余 mpv 命令（字幕样式、osd 等）在 ExoPlayer 下无对应，忽略 */ }
        }
    }

    private var muted = false
    private var vol = 1f

    private fun setProp(pl: ExoPlayer, name: String, v: String) {
        when (name) {
            "pause" -> {
                val want = !truthy(v)
                pl.playWhenReady = want
                // 播完以后按播放：回到开头
                if (want && pl.playbackState == Player.STATE_ENDED) pl.seekTo(0)
                emit("pause", (!want).toString())
            }
            "volume" -> { vol = ((v.toDoubleOrNull() ?: 100.0) / 100.0).toFloat().coerceIn(0f, 1f); pl.volume = if (muted) 0f else vol; emit("volume", (vol * 100.0).toString()) }
            "mute" -> { muted = truthy(v); pl.volume = if (muted) 0f else vol; emit("mute", muted.toString()) }
            "speed" -> { val s = (v.toFloatOrNull() ?: 1f).coerceIn(0.25f, 4f); pl.playbackParameters = PlaybackParameters(s); emit("speed", s.toString()) }
            "user-agent" -> { ua = v; dsf?.setUserAgent(v) }
            "aid" -> selectIdx(pl, C.TRACK_TYPE_AUDIO, v.toIntOrNull() ?: -1)
            "sid" -> selectIdx(pl, C.TRACK_TYPE_TEXT, if (v == "no") -1 else v.toIntOrNull() ?: -1)
            else -> { /* hwdec 等 mpv 专属选项：忽略 */ }
        }
    }

    private fun groups(pl: Player, type: Int): List<Tracks.Group> = pl.currentTracks.groups.filter { it.type == type }

    /** n 从 1 开始（和 mpv 的 aid / sid 一致）；-1 = 关闭（仅字幕） */
    private fun selectIdx(pl: Player, type: Int, n: Int) {
        val g = groups(pl, type)
        val b = pl.trackSelectionParameters.buildUpon()
        if (n <= 0 || n > g.size) {
            if (type == C.TRACK_TYPE_TEXT) b.setTrackTypeDisabled(type, true)
        } else {
            b.setTrackTypeDisabled(type, false)
            b.setOverrideForType(TrackSelectionOverride(g[n - 1].mediaTrackGroup, 0))
        }
        pl.trackSelectionParameters = b.build()
    }

    private fun addSub(pl: ExoPlayer, a: List<String>) {
        val url = a[1]
        val low = url.lowercase()
        val mime = when {
            low.contains("ass") || low.contains("ssa") -> MimeTypes.TEXT_SSA
            low.contains("vtt") -> MimeTypes.TEXT_VTT
            else -> MimeTypes.APPLICATION_SUBRIP
        }
        val cfg = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(url))
            .setMimeType(mime)
            .setLabel(a.getOrNull(3)?.takeIf { it.isNotEmpty() } ?: a.getOrNull(2))
            .setLanguage(a.getOrNull(4)?.takeIf { it.isNotEmpty() })
            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build()
        extSubs.add(cfg)
        // 外挂字幕要重新装载媒体：记住位置和当前音轨，装完再恢复
        val pos = pl.currentPosition
        val play = pl.playWhenReady
        val ai = groups(pl, C.TRACK_TYPE_AUDIO).indexOfFirst { it.isSelected } + 1
        pendAid = if (ai > 0) ai else -1
        pendSid = if (a.getOrNull(1) != null && a.getOrNull(2) == "select") -3 else -2
        pl.setMediaItem(MediaItem.Builder().setUri(curUrl).setSubtitleConfigurations(extSubs).build(), pos)
        pl.prepare()
        pl.playWhenReady = play
    }

    // ───────── 属性 ─────────
    @JavascriptInterface
    fun getProp(name: String, type: String): String {
        return onMain("null") {
            val pl = p ?: return@onMain "null"
            when (name) {
                "pause" -> (!pl.playWhenReady).toString()
                "time-pos" -> (pl.currentPosition / 1000.0).toString()
                "duration" -> if (pl.duration == C.TIME_UNSET) "null" else (pl.duration / 1000.0).toString()
                "speed" -> pl.playbackParameters.speed.toString()
                "volume" -> (vol * 100.0).toString()
                "mute" -> muted.toString()
                "aid" -> groups(pl, C.TRACK_TYPE_AUDIO).indexOfFirst { it.isSelected }.let { if (it >= 0) (it + 1).toString() else "null" }
                "sid" -> groups(pl, C.TRACK_TYPE_TEXT).indexOfFirst { it.isSelected }.let { if (it >= 0) (it + 1).toString() else "null" }
                "hwdec-current" -> JSONObject.quote("exoplayer")
                else -> "null"
            }
        }
    }

    // ───────── ExoPlayer 事件 → 网页 ─────────
    private fun emit(name: String, valueJson: String) {
        val js = "window.__mpvEvt&&window.__mpvEvt(${JSONObject.quote(name)},$valueJson)"
        web.post { web.evaluateJavascript(js, null) }
    }

    override fun onPlaybackStateChanged(state: Int) {
        val pl = p ?: return
        emit("paused-for-cache", (state == Player.STATE_BUFFERING && pl.playWhenReady).toString())
        if (state == Player.STATE_READY && pl.duration != C.TIME_UNSET) { lastDur = pl.duration / 1000.0; emit("duration", lastDur.toString()) }
        if (state == Player.STATE_ENDED) {
            pl.playWhenReady = false
            emit("pause", "true")
            emit("eof-reached", "true")
        }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        emit("pause", (!playWhenReady).toString())
        val pl = p ?: return
        emit("paused-for-cache", (pl.playbackState == Player.STATE_BUFFERING && playWhenReady).toString())
    }

    override fun onPlayerError(error: PlaybackException) {
        var cause: Throwable? = error
        var http = ""
        while (cause != null) {
            if (cause is androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) { http = "HTTP ${cause.responseCode}"; break }
            cause = cause.cause
        }
        lastErr = (if (http.isNotEmpty()) "$http，" else "") + error.errorCodeName
        emit("exo-error", JSONObject.quote(lastErr))
    }

    override fun onTracksChanged(tracks: Tracks) {
        val pl = p ?: return
        if (pendAid > 0) { val n = pendAid; pendAid = -1; selectIdx(pl, C.TRACK_TYPE_AUDIO, n) }
        when (pendSid) {
            -1 -> selectIdx(pl, C.TRACK_TYPE_TEXT, -1)
            -3 -> { val n = groups(pl, C.TRACK_TYPE_TEXT).size; if (n > 0) selectIdx(pl, C.TRACK_TYPE_TEXT, n) }
            in 1..99 -> selectIdx(pl, C.TRACK_TYPE_TEXT, pendSid)
            else -> {}
        }
        if (groups(pl, C.TRACK_TYPE_TEXT).isNotEmpty() || pendSid == -1) pendSid = -2
        val ai = groups(pl, C.TRACK_TYPE_AUDIO).indexOfFirst { it.isSelected }
        val si = groups(pl, C.TRACK_TYPE_TEXT).indexOfFirst { it.isSelected }
        emit("aid", if (ai >= 0) (ai + 1).toString() else "null")
        emit("sid", if (si >= 0) (si + 1).toString() else "null")
        val vf = tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO && it.length > 0 }?.getTrackFormat(0)
        if (vf != null) {
            emit("container-fps", if (vf.frameRate > 0) vf.frameRate.toString() else "null")
            emit("video-bitrate", if (vf.bitrate > 0) vf.bitrate.toString() else "null")
        }
    }

    override fun onVideoSizeChanged(v: VideoSize) {
        emit("width", v.width.toString())
        emit("height", v.height.toString())
        if (!started) started = true
    }

    override fun onCues(cueGroup: CueGroup) {
        subs?.setCues(cueGroup.cues)
    }
}
