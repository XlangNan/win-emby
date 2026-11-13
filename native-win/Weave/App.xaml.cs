using System.Windows;

namespace Weave;

public partial class App : Application
{
    public App()
    {
        // 未处理的异常：弹出原因，而不是直接闪退
        DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(e.Exception.ToString(), "织影出错了");
            e.Handled = true;
        };
    }
}
