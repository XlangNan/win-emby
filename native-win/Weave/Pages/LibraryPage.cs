using System.Windows;
using System.Windows.Controls;
using Weave.Emby;

namespace Weave.Pages;

/// <summary>媒体库 / 合集 / 季 的内容：海报墙，滚到底自动加载更多，可排序</summary>
public sealed class LibraryPage : UserControl
{
    private readonly INav _nav;
    private readonly string _parentId;
    private readonly WrapPanel _wrap = new();
    private readonly TextBlock _status = Ui.Text("加载中…", 14, Ui.Muted);
    private readonly ScrollViewer _sv;
    private int _loaded, _total = int.MaxValue;
    private bool _busy;
    private int _gen;
    private (string By, bool Desc) _sort = ("SortName", false);

    public LibraryPage(INav nav, string parentId)
    {
        _nav = nav;
        _parentId = parentId;
        var sort = new ComboBox { Width = 140, Margin = new Thickness(6, 0, 0, 10), HorizontalAlignment = HorizontalAlignment.Left };
        var opts = new (string Name, string By, bool Desc)[] { ("名称", "SortName", false), ("最近添加", "DateCreated", true), ("上映年份", "PremiereDate", true), ("评分", "CommunityRating", true) };
        foreach (var o in opts) sort.Items.Add(o.Name);
        sort.SelectedIndex = 0;
        sort.SelectionChanged += (_, _) =>
        {
            var o = opts[Math.Max(0, sort.SelectedIndex)];
            _sort = (o.By, o.Desc);
            _ = ReloadAsync();
        };
        var stack = new StackPanel();
        stack.Children.Add(sort);
        stack.Children.Add(_wrap);
        stack.Children.Add(_status);
        _sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = stack };
        _sv.ScrollChanged += (_, e) =>
        {
            if (e.VerticalChange != 0 && _sv.VerticalOffset > _sv.ScrollableHeight - 400) _ = MoreAsync();
        };
        Content = _sv;
        _ = ReloadAsync();
    }

    private async Task ReloadAsync()
    {
        _gen++;
        _wrap.Children.Clear();
        _loaded = 0; _total = int.MaxValue; _busy = false;
        _sv.ScrollToTop();
        await MoreAsync();
    }

    private async Task MoreAsync()
    {
        if (_busy || _loaded >= _total) return;
        _busy = true;
        var gen = _gen;
        _status.Text = "加载中…";
        try
        {
            var r = await _nav.Api.LibraryAsync(_parentId, _loaded, 100, _sort.By, _sort.Desc);
            if (gen != _gen) return;
            _total = r.TotalRecordCount;
            foreach (var i in r.Items) _wrap.Children.Add(Ui.CardOf(i, _nav));
            _loaded += r.Items.Count;
            if (r.Items.Count == 0) _total = _loaded;
            _status.Text = _loaded == 0 ? "这里还没有内容" : "";
        }
        catch (Exception e)
        {
            if (gen == _gen) { _status.Text = "加载失败：" + e.Message; _total = _loaded; }
        }
        finally { if (gen == _gen) _busy = false; }
    }
}
