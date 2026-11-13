using System.Runtime.InteropServices;

namespace Weave.Player;

/// <summary>libmpv-2.dll 的最薄封装（P/Invoke）。所有事件在后台线程回调，界面层自己切回界面线程。</summary>
public sealed class Mpv : IDisposable
{
    private const string Lib = "libmpv-2.dll";
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_create();
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_initialize(IntPtr h);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void mpv_terminate_destroy(IntPtr h);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_set_option_string(IntPtr h, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string data);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_set_property_string(IntPtr h, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string data);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_get_property_string(IntPtr h, [MarshalAs(UnmanagedType.LPUTF8Str)] string name);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern void mpv_free(IntPtr p);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_command(IntPtr h, IntPtr[] args);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_observe_property(IntPtr h, ulong reply, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int format);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_wait_event(IntPtr h, double timeout);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_error_string(int err);

    private const int FormatString = 1, FormatFlag = 3, FormatInt64 = 4, FormatDouble = 5;
    private const int EvShutdown = 1, EvEndFile = 7, EvFileLoaded = 8, EvProperty = 22;

    private IntPtr _h;
    private Thread? _loop;
    private volatile bool _stop;

    /// <summary>属性变化：名字 + 值（bool / long / double / string / null）</summary>
    public event Action<string, object?>? Property;
    /// <summary>文件播完或出错：reason（0 = 播完，4 = 出错），error（负数 = 错误码）</summary>
    public event Action<int, int>? EndFile;
    public event Action? FileLoaded;

    public static string ErrorText(int code) => Marshal.PtrToStringUTF8(mpv_error_string(code)) ?? code.ToString();

    public Mpv(IntPtr hwnd, bool hdr, string userAgent)
    {
        _h = mpv_create();
        if (_h == IntPtr.Zero) throw new Exception("mpv_create 失败");
        Opt("wid", hwnd.ToInt64().ToString());
        Opt("vo", "gpu-next");
        Opt("gpu-api", "d3d11");
        Opt("gpu-context", "d3d11");
        Opt("hwdec", "auto-safe");
        Opt("target-colorspace-hint", hdr ? "yes" : "no");
        Opt("hdr-compute-peak", "yes");
        Opt("keep-open", "yes");
        Opt("osc", "no");
        Opt("input-default-bindings", "no");
        Opt("input-vo-keyboard", "no");
        Opt("load-scripts", "no");
        Opt("config", "no");
        Opt("ytdl", "no");
        Opt("terminal", "no");
        Opt("cache", "yes");
        Opt("demuxer-lavf-o", "fflags=+discardcorrupt");
        Opt("demuxer-max-bytes", "400MiB");
        Opt("demuxer-max-back-bytes", "120MiB");
        Opt("demuxer-readahead-secs", "90");
        Opt("sub-auto", "no");
        Opt("slang", "chi,zho,chs,cht,zh,eng");
        Opt("sub-font", "Microsoft YaHei");
        Opt("audio-display", "no");
        if (!string.IsNullOrEmpty(userAgent)) Opt("user-agent", userAgent);
        var r = mpv_initialize(_h);
        if (r < 0) throw new Exception("mpv 初始化失败：" + ErrorText(r));
        Observe("pause", FormatFlag);
        Observe("time-pos", FormatDouble);
        Observe("duration", FormatDouble);
        Observe("paused-for-cache", FormatFlag);
        Observe("volume", FormatDouble);
        Observe("mute", FormatFlag);
        Observe("speed", FormatDouble);
        Observe("eof-reached", FormatFlag);
        Observe("demuxer-cache-time", FormatDouble);
        Observe("aid", FormatInt64);
        Observe("sid", FormatInt64);
        _loop = new Thread(Loop) { IsBackground = true, Name = "mpv-events" };
        _loop.Start();
    }

    private void Opt(string k, string v) { mpv_set_option_string(_h, k, v); }
    private void Observe(string name, int fmt) { mpv_observe_property(_h, 0, name, fmt); }

    private void Loop()
    {
        while (!_stop)
        {
            var p = mpv_wait_event(_h, 0.25);
            if (p == IntPtr.Zero) continue;
            int id = Marshal.ReadInt32(p, 0);
            if (id == 0) continue;           // NONE：超时
            if (id == EvShutdown) break;
            var data = Marshal.ReadIntPtr(p, 16);
            try
            {
                switch (id)
                {
                    case EvProperty when data != IntPtr.Zero:
                    {
                        var name = Marshal.PtrToStringUTF8(Marshal.ReadIntPtr(data, 0)) ?? "";
                        int fmt = Marshal.ReadInt32(data, 8);
                        var vp = Marshal.ReadIntPtr(data, 16);
                        object? v = null;
                        if (vp != IntPtr.Zero)
                        {
                            v = fmt switch
                            {
                                FormatFlag => Marshal.ReadInt32(vp) != 0,
                                FormatInt64 => Marshal.ReadInt64(vp),
                                FormatDouble => BitConverter.Int64BitsToDouble(Marshal.ReadInt64(vp)),
                                FormatString => Marshal.PtrToStringUTF8(Marshal.ReadIntPtr(vp)),
                                _ => null,
                            };
                        }
                        Property?.Invoke(name, v);
                        break;
                    }
                    case EvEndFile when data != IntPtr.Zero:
                        EndFile?.Invoke(Marshal.ReadInt32(data, 0), Marshal.ReadInt32(data, 4));
                        break;
                    case EvFileLoaded:
                        FileLoaded?.Invoke();
                        break;
                }
            }
            catch { /* 回调里的异常不能让事件线程退出 */ }
        }
    }

    public int Command(params string[] args)
    {
        var ptrs = new IntPtr[args.Length + 1];
        try
        {
            for (int i = 0; i < args.Length; i++) ptrs[i] = Marshal.StringToCoTaskMemUTF8(args[i]);
            ptrs[args.Length] = IntPtr.Zero;
            return mpv_command(_h, ptrs);
        }
        finally
        {
            for (int i = 0; i < args.Length; i++) if (ptrs[i] != IntPtr.Zero) Marshal.FreeCoTaskMem(ptrs[i]);
        }
    }

    public int Set(string name, string value) => mpv_set_property_string(_h, name, value);

    public string? Get(string name)
    {
        var p = mpv_get_property_string(_h, name);
        if (p == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUTF8(p); } finally { mpv_free(p); }
    }

    public double GetDouble(string name) => double.TryParse(Get(name), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;

    public void Dispose()
    {
        if (_h == IntPtr.Zero) return;
        _stop = true;
        try { _loop?.Join(800); } catch { /* ignore */ }
        mpv_terminate_destroy(_h);
        _h = IntPtr.Zero;
    }
}
