using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Weave.Emby;

namespace Weave.Pages;

/// <summary>电影 / 剧集 / 单集 详情：背景图、简介、播放 / 收藏 / 已看、选集、演职员、相似推荐</summary>
public sealed class DetailPage : UserControl
{
    private readonly INav _nav;
    private readonly Item _brief;
    private readonly StackPanel _root = new() { Margin = new Thickness(0, 0, 0, 40) };
    private Item? _it;
    private readonly StackPanel _episodes = new() { Margin = new Thickness(6, 4, 6, 0) };
    private List<Item> _seasons = new();

    public DetailPage(INav nav, Item brief)
    {
        _nav = nav;
        _brief = brief;
        _root.Children.Add(Ui.Text("加载中…", 14, Ui.Muted).WithMargin(6, 0, 0, 0));
        Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = _root };
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            _it = await _nav.Api.ItemAsync(_brief.Id);
            Build(_it);
            if (_it.Type == "Series") await LoadSeasonsAsync(_it);
            else if (_it.Type == "Movie") await LoadSimilarAsync(_it);
        }
        catch (Exception e)
        {
            _root.Children.Clear();
            _root.Children.Add(Ui.Text("加载失败：" + e.Message, 14, Ui.Muted).WithMargin(6, 0, 0, 0));
        }
    }

    private void Build(Item it)
    {
        _root.Children.Clear();
        // 顶部：背景图 + 渐变
        var head = new Grid { Height = 330 };
        var bg = new Image { Stretch = Stretch.UniformToFill, Opacity = 0.55 };
        Ui.SetImage(bg, _nav.Api.ImageUrl(it, "Backdrop", 1280), 1280);
        head.Children.Add(bg);
        head.Children.Add(new Border
        {
            Background = new LinearGradientBrush(Color.FromArgb(0, 20, 22, 27), Color.FromRgb(20, 22, 27), 90)
        });
        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(6, 0, 0, 0) };
        var poster = new Image { Width = 160, Height = 240, Stretch = Stretch.UniformToFill };
        Ui.SetImage(poster, _nav.Api.ImageUrl(it, "Primary", 400), 400);
        row.Children.Add(new Border { Width = 160, Height = 240, CornerRadius = new CornerRadius(8), Background = Ui.Card, Clip = new RectangleGeometry(new Rect(0, 0, 160, 240), 8, 8), Child = poster, Margin = new Thickness(0, 0, 22, 0) });

        var info = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, MaxWidth = 720 };
        info.Children.Add(Ui.Text(it.Name, 28, null, FontWeights.Bold, true));
        if (it.Type == "Episode") info.Children.Add(Ui.Text(it.Sub, 14, Ui.Muted).WithMargin(0, 4, 0, 0));
        var meta = new List<string>();
        if (it.ProductionYear != null) meta.Add(it.ProductionYear.ToString()!);
        if (!string.IsNullOrEmpty(it.OfficialRating)) meta.Add(it.OfficialRating!);
        if (it.Minutes > 0) meta.Add(Ui.Duration(it.Minutes));
        if (it.CommunityRating != null) meta.Add($"★ {it.CommunityRating:0.0}");
        if (meta.Count > 0) info.Children.Add(Ui.Text(string.Join("  ·  ", meta), 14, Ui.Muted).WithMargin(0, 8, 0, 0));
        if (it.Genres?.Count > 0) info.Children.Add(Ui.Text(string.Join(" / ", it.Genres), 13, Ui.Muted).WithMargin(0, 4, 0, 0));

        var btns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 16, 0, 4) };
        if (it.IsPlayable)
        {
            var pos = it.UserData?.PlaybackPositionTicks ?? 0;
            var play = Ui.Btn(pos > 0 ? "▶ 继续播放" : "▶ 播放");
            play.Click += (_, _) => _nav.Play(it);
            btns.Children.Add(play);
            if (pos > 0)
            {
                var again = Ui.Btn("从头播放", false);
                again.Click += (_, _) => _nav.Play(new Item { Id = it.Id, Name = it.Name, Type = it.Type, UserData = new UserData() });
                btns.Children.Add(again);
            }
        }
        var fav = Ui.Btn(it.UserData?.IsFavorite == true ? "♥ 已收藏" : "♡ 收藏", false);
        fav.Click += async (_, _) =>
        {
            var on = !(it.UserData?.IsFavorite ?? false);
            try
            {
                await _nav.Api.SetFavoriteAsync(it.Id, on);
                (it.UserData ??= new UserData()).IsFavorite = on;
                fav.Content = on ? "♥ 已收藏" : "♡ 收藏";
            }
            catch (Exception e) { MessageBox.Show(e.Message, "收藏失败"); }
        };
        btns.Children.Add(fav);
        var seen = Ui.Btn(it.UserData?.Played == true ? "✓ 已看" : "标记已看", false);
        seen.Click += async (_, _) =>
        {
            var on = !(it.UserData?.Played ?? false);
            try
            {
                await _nav.Api.SetPlayedAsync(it.Id, on);
                (it.UserData ??= new UserData()).Played = on;
                seen.Content = on ? "✓ 已看" : "标记已看";
            }
            catch (Exception e) { MessageBox.Show(e.Message, "操作失败"); }
        };
        btns.Children.Add(seen);
        info.Children.Add(btns);
        row.Children.Add(info);
        head.Children.Add(row);
        _root.Children.Add(head);

        if (!string.IsNullOrWhiteSpace(it.Overview))
            _root.Children.Add(Ui.Text(it.Overview!, 14, Ui.Fg, null, true).WithMargin(6, 14, 20, 10));

        if (it.Type == "Series") _root.Children.Add(_episodes);
        var people = (it.People ?? new()).Where(p => p.Type is "Actor" or "Director" or "GuestStar").Take(24).ToList();
        if (people.Count > 0)
            _root.Children.Add(Ui.Shelf("演职员", people.Select(PersonCard)));
    }

    private FrameworkElement PersonCard(Person p)
    {
        var img = new Image { Stretch = Stretch.UniformToFill };
        Ui.SetImage(img, _nav.Api.ImageUrl(p.Id, "Primary", 200, p.PrimaryImageTag), 200);
        var circle = new Border { Width = 84, Height = 84, CornerRadius = new CornerRadius(42), Background = Ui.Card, Clip = new EllipseGeometry(new Point(42, 42), 42, 42), Child = img };
        var sp = new StackPanel { Width = 110, Margin = new Thickness(4, 0, 4, 8) };
        circle.HorizontalAlignment = HorizontalAlignment.Center;
        sp.Children.Add(circle);
        sp.Children.Add(new TextBlock { Text = p.Name, FontSize = 12.5, Foreground = Ui.Fg, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 6, 0, 0) });
        if (!string.IsNullOrEmpty(p.Role)) sp.Children.Add(new TextBlock { Text = p.Role, FontSize = 11.5, Foreground = Ui.Muted, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
        return sp;
    }

    private async Task LoadSimilarAsync(Item it)
    {
        try
        {
            var sim = await _nav.Api.SimilarAsync(it.Id);
            if (sim.Count > 0) _root.Children.Add(Ui.Shelf("相似推荐", sim.Select(i => Ui.CardOf(i, _nav))));
        }
        catch { /* 没有就算了 */ }
    }

    // ───────── 剧集：季 + 集 ─────────
    private async Task LoadSeasonsAsync(Item series)
    {
        try
        {
            _seasons = await _nav.Api.SeasonsAsync(series.Id);
            if (_seasons.Count == 0) { _episodes.Children.Add(Ui.Text("还没有剧集", 14, Ui.Muted)); return; }
            var tabs = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            var sel = Math.Max(0, _seasons.FindIndex(s => s.UserData?.UnplayedItemCount != 0));
            var buttons = new List<Button>();
            for (int i = 0; i < _seasons.Count; i++)
            {
                var idx = i;
                var b = Ui.Btn(_seasons[i].Name, false);
                b.Margin = new Thickness(0, 0, 8, 8);
                b.Padding = new Thickness(14, 6, 14, 6);
                b.Click += async (_, _) => { Mark(buttons, idx); await ShowSeasonAsync(series, _seasons[idx]); };
                buttons.Add(b); tabs.Children.Add(b);
            }
            _episodes.Children.Add(tabs);
            _episodes.Children.Add(new StackPanel { Tag = "list" });
            Mark(buttons, sel);
            await ShowSeasonAsync(series, _seasons[sel]);
        }
        catch (Exception e) { _episodes.Children.Add(Ui.Text("选集加载失败：" + e.Message, 14, Ui.Muted)); }
    }

    private static void Mark(List<Button> bs, int i)
    {
        for (int k = 0; k < bs.Count; k++) bs[k].Background = k == i ? Ui.Accent : Ui.Hex("#2A2E39");
    }

    private async Task ShowSeasonAsync(Item series, Item season)
    {
        var host = _episodes.Children.OfType<StackPanel>().First(p => (p.Tag as string) == "list");
        host.Children.Clear();
        host.Children.Add(Ui.Text("加载中…", 14, Ui.Muted));
        try
        {
            var eps = await _nav.Api.EpisodesAsync(series.Id, season.Id);
            host.Children.Clear();
            foreach (var e in eps) host.Children.Add(EpisodeRow(e));
            if (eps.Count == 0) host.Children.Add(Ui.Text("这一季还没有剧集", 14, Ui.Muted));
        }
        catch (Exception ex) { host.Children.Clear(); host.Children.Add(Ui.Text("加载失败：" + ex.Message, 14, Ui.Muted)); }
    }

    private FrameworkElement EpisodeRow(Item e)
    {
        var img = new Image { Stretch = Stretch.UniformToFill };
        Ui.SetImage(img, _nav.Api.ImageUrl(e, "Primary", 320), 320);
        var thumb = new Grid { Width = 160, Height = 90, Background = Ui.Card, Clip = new RectangleGeometry(new Rect(0, 0, 160, 90), 6, 6) };
        thumb.Children.Add(img);
        var pct = e.UserData?.PlayedPercentage ?? 0;
        if (pct > 1 && pct < 100)
        {
            var bar = new Border { Height = 3, Background = Ui.Hex("#99000000"), VerticalAlignment = VerticalAlignment.Bottom };
            bar.Child = new Border { Background = Ui.Accent, HorizontalAlignment = HorizontalAlignment.Left, Width = 160 * pct / 100 };
            thumb.Children.Add(bar);
        }
        var text = new StackPanel { Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        var title = $"{e.IndexNumber}. {e.Name}" + (e.UserData?.Played == true ? "  ✓" : "");
        text.Children.Add(Ui.Text(title, 15, null, FontWeights.SemiBold));
        var sub = Ui.Duration(e.Minutes);
        if (sub.Length > 0) text.Children.Add(Ui.Text(sub, 12, Ui.Muted).WithMargin(0, 2, 0, 0));
        if (!string.IsNullOrWhiteSpace(e.Overview))
        {
            var ov = Ui.Text(e.Overview!, 12.5, Ui.Muted, null, true);
            ov.MaxHeight = 36; ov.Margin = new Thickness(0, 4, 0, 0);
            text.Children.Add(ov);
        }
        var row = new Border { Padding = new Thickness(8), CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand, Background = Brushes.Transparent, Margin = new Thickness(0, 0, 0, 2) };
        var g = new StackPanel { Orientation = Orientation.Horizontal };
        g.Children.Add(thumb);
        g.Children.Add(text);
        row.Child = g;
        row.MouseEnter += (_, _) => row.Background = Ui.Hex("#1C1F26");
        row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
        row.MouseLeftButtonUp += (_, _) => _nav.Play(e);
        return row;
    }
}
