using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace Weave.Player;

/// <summary>在 WPF 窗口里挖一块原生子窗口，把它的句柄交给 mpv 去画画面。</summary>
public sealed class MpvHost : HwndHost
{
    private const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_CLIPCHILDREN = 0x02000000, WS_CLIPSIBLINGS = 0x04000000, SS_BLACKRECT = 0x4;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(int exStyle, string cls, string name, int style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr h);

    public IntPtr Hwnd { get; private set; }
    public event Action<IntPtr>? HandleReady;

    protected override HandleRef BuildWindowCore(HandleRef hwndParent)
    {
        Hwnd = CreateWindowEx(0, "static", "", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | SS_BLACKRECT,
            0, 0, 16, 16, hwndParent.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        HandleReady?.Invoke(Hwnd);
        return new HandleRef(this, Hwnd);
    }

    protected override void DestroyWindowCore(HandleRef hwnd) { DestroyWindow(hwnd.Handle); }
}
