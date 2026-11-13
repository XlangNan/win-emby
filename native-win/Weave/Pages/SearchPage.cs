using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace Weave.Pages;

public sealed class SearchPage : UserControl
{
    private readonly INav _nav;
    private readonly TextBox _box = new() { FontSize = 15, Padding = new Thickness(10, 8, 10, 8), Margin = new Thickness(6, 0, 6, 12) };
    private readonly WrapPanel _wrap = new();
    private readonly TextBlock _status = Ui.Text("输入片名、剧名或合集名", 14, Ui.Muted);
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private int _gen;

    public SearchPage(INav nav)
    {
        _nav = nav;
        var stack = new StackPanel();
        stack.Children.Add(_box);
        stack.Children.Add(_wrap);
        stack.Children.Add(_status);
        Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = stack };
        _timer.Tick += (_, _) => { _timer.Stop(); _ = RunAsync(); };
        _box.TextChanged += (_, _) => { _timer.Stop(); _timer.Start(); };
        Loaded += (_, _) => _box.Focus();
    }

    private async Task RunAsync()
    {
        var q = _box.Text.Trim();
        var gen = ++_gen;
        _wrap.Children.Clear();
        if (q.Length == 0) { _status.Text = "输入片名、剧名或合集名"; return; }
        _status.Text = "搜索中…";
        try
        {
            var r = await _nav.Api.SearchAsync(q);
            if (gen != _gen) return;
            foreach (var i in r) _wrap.Children.Add(Ui.CardOf(i, _nav));
            _status.Text = r.Count == 0 ? $"没有匹配「{q}」的内容" : "";
        }
        catch (Exception e) { if (gen == _gen) _status.Text = "搜索失败：" + e.Message; }
    }
}
