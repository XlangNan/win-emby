using System.Windows;
using System.Windows.Controls;
using Weave.Emby;

namespace Weave.Pages;

/// <summary>首页：继续观看 + 每个媒体库的「最近添加」</summary>
public sealed class HomePage : UserControl
{
    private readonly INav _nav;
    private readonly StackPanel _body = new() { Margin = new Thickness(0, 0, 0, 30) };
    private readonly TextBlock _status = Ui.Text("加载中…", 14, Ui.Muted);

    public HomePage(INav nav, List<Item> views)
    {
        _nav = nav;
        _body.Children.Add(_status);
        Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = _body };
        _ = LoadAsync(views);
    }

    private async Task LoadAsync(List<Item> views)
    {
        try
        {
            var resume = await _nav.Api.ResumeAsync();
            _status.Visibility = Visibility.Collapsed;
            if (resume.Count > 0) _body.Children.Add(Ui.Shelf("继续观看", resume.Select(i => Ui.CardOf(i, _nav, 250, true))));
            foreach (var v in views)
            {
                if (v.CollectionType is "livetv" or "playlists") continue;
                try
                {
                    var latest = await _nav.Api.LatestAsync(v.Id);
                    if (latest.Count > 0) _body.Children.Add(Ui.Shelf($"最近添加 · {v.Name}", latest.Select(i => Ui.CardOf(i, _nav))));
                }
                catch { /* 某个库失败，不影响其他 */ }
            }
            if (_body.Children.Count == 1) { _status.Text = "还没有内容"; _status.Visibility = Visibility.Visible; }
        }
        catch (Exception e)
        {
            _status.Text = "加载失败：" + e.Message;
        }
    }
}
