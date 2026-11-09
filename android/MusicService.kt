package com.weave.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL

/**
 * 音乐通知服务：状态栏 / 锁屏显示正在播放的歌曲，带 上一首 / 播放·暂停 / 下一首 / 关闭 按钮。
 * 只在有音乐会话时存在；停止播放（关闭播放条）后通知消失。按钮事件经 [onCommand] 回到网页里的播放器。
 */
class MusicService : Service() {
    companion object {
        const val CH = "weave_music"
        const val NID = 7301
        const val ACT = "weave.music.cmd"
        @Volatile var instance: MusicService? = null
        var onCommand: ((String, Long) -> Unit)? = null

        fun push(ctx: Context, title: String, artist: String, album: String, cover: String, dur: Long, pos: Long, playing: Boolean) {
            val inst = instance
            if (inst != null) { inst.set(title, artist, album, cover, dur, pos, playing); return }
            val i = Intent(ctx, MusicService::class.java)
                .putExtra("title", title).putExtra("artist", artist).putExtra("album", album)
                .putExtra("cover", cover).putExtra("dur", dur).putExtra("pos", pos).putExtra("playing", playing)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun clear(ctx: Context) {
            val inst = instance
            if (inst != null) inst.shutdown() else ctx.stopService(Intent(ctx, MusicService::class.java))
        }
    }

    private var session: MediaSession? = null
    private var title = ""
    private var artist = ""
    private var album = ""
    private var dur = 0L
    private var pos = 0L
    private var playing = false
    private var cover: Bitmap? = null
    private var coverKey = ""
    private val main = Handler(Looper.getMainLooper())
    private var inForeground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CH, "音乐播放", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(ch)
        }
        val s = MediaSession(this, "weave")
        s.setCallback(object : MediaSession.Callback() {
            override fun onPlay() { onCommand?.invoke("play", 0) }
            override fun onPause() { onCommand?.invoke("pause", 0) }
            override fun onSkipToNext() { onCommand?.invoke("next", 0) }
            override fun onSkipToPrevious() { onCommand?.invoke("prev", 0) }
            override fun onStop() { onCommand?.invoke("stop", 0) }
            override fun onSeekTo(p: Long) { onCommand?.invoke("seek", p / 1000) }
        })
        session = s
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val a = intent?.action
        if (intent != null && a == ACT) {
            val c = intent.getStringExtra("cmd") ?: ""
            if (c == "toggle") onCommand?.invoke(if (playing) "pause" else "play", 0) else onCommand?.invoke(c, 0)
            return START_NOT_STICKY
        }
        if (intent != null && intent.hasExtra("title")) {
            set(
                intent.getStringExtra("title") ?: "", intent.getStringExtra("artist") ?: "", intent.getStringExtra("album") ?: "",
                intent.getStringExtra("cover") ?: "", intent.getLongExtra("dur", 0), intent.getLongExtra("pos", 0), intent.getBooleanExtra("playing", false),
            )
        } else if (!inForeground) {
            // 被系统用空 Intent 拉起：没有内容可显示，直接结束
            stopSelf()
        }
        return START_NOT_STICKY
    }

    fun set(t: String, ar: String, al: String, cv: String, d: Long, p: Long, pl: Boolean) {
        main.post {
            title = t; artist = ar; album = al; dur = d; pos = p; playing = pl
            if (cv != coverKey) { coverKey = cv; cover = null; loadCover(cv) }
            apply()
        }
    }

    private fun loadCover(src: String) {
        if (src.isEmpty()) return
        Thread {
            var bmp: Bitmap? = null
            try {
                bmp = if (src.startsWith("data:")) {
                    val b = Base64.decode(src.substring(src.indexOf(',') + 1), Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(b, 0, b.size)
                } else {
                    val c = URL(src).openConnection() as HttpURLConnection
                    c.connectTimeout = 8000; c.readTimeout = 8000
                    c.inputStream.use { BitmapFactory.decodeStream(it) }
                }
            } catch (_: Exception) { }
            val out = bmp
            if (out != null) main.post { if (coverKey == src) { cover = out; apply() } }
        }.start()
    }

    private fun pi(cmd: String, code: Int): PendingIntent {
        val i = Intent(this, MusicService::class.java).setAction(ACT).putExtra("cmd", cmd)
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun act(icon: Int, label: String, cmd: String, code: Int): Notification.Action =
        Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi(cmd, code)).build()

    private fun apply() {
        val s = session ?: return
        val md = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, dur * 1000)
        cover?.let { md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }
        s.setMetadata(md.build())
        val acts = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP
        s.setPlaybackState(
            PlaybackState.Builder().setActions(acts)
                .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, pos * 1000, if (playing) 1f else 0f).build(),
        )
        s.isActive = true

        val open = packageManager.getLaunchIntentForPackage(packageName)
        val contentPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH) else Notification.Builder(this)
        b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title).setContentText(artist).setSubText(album.ifEmpty { null })
            .setContentIntent(contentPi)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true).setShowWhen(false).setOngoing(playing)
            .addAction(act(android.R.drawable.ic_media_previous, "上一首", "prev", 1))
            .addAction(act(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (playing) "暂停" else "播放", "toggle", 2))
            .addAction(act(android.R.drawable.ic_media_next, "下一首", "next", 3))
            .addAction(act(android.R.drawable.ic_menu_close_clear_cancel, "关闭", "stop", 4))
            .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(0, 1, 2))
        cover?.let { b.setLargeIcon(it) }
        val n = b.build()
        try {
            if (playing) {
                if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(NID, n)
                inForeground = true
            } else {
                if (!inForeground) {
                    // 刚启动就是暂停：也得先进前台（系统要求），再退回普通通知，这样可以左滑清除
                    if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(NID, n)
                }
                stopForeground(false)
                inForeground = false
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NID, n)
            }
        } catch (_: Exception) { }
    }

    fun shutdown() {
        main.post {
            try { stopForeground(true) } catch (_: Exception) { }
            stopSelf()
        }
    }

    override fun onDestroy() {
        instance = null
        try { session?.isActive = false; session?.release() } catch (_: Exception) { }
        session = null
        super.onDestroy()
    }
}
