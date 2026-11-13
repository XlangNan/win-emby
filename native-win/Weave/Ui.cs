using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Weave.Emby;

namespace Weave;

/// <summary>页面和主窗口之间的接口</summary>
public interface INav
{
    EmbyClient Api { get; }
    void Open(Item it);          // 打开详情 / 子列表
    void Play(Item it);          // 播放
    void Back();
}

/// <summary>界面小工具：封面卡片、横向列表、图片加载</summary>
public static class Ui
{
    public static SolidColorBrush Hex(string hex) => (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
    public static readonly Brush Panel = Hex("#1C1F26");
    public static readonly Brush Card = Hex("#242832");
    public static readonly Brush Muted = Hex("#8B91A0");
    public static readonly Brush Accent = Hex("#4C8DFF");
    public static readonly Brush Fg = Hex("#E8EAEE");

    public static void SetImage(Image img, string url, int decodeWidth)
    {
        if (string.IsNullOrEmpty(url)) return;
        try
        {
            var b = new BitmapImage();
            b.BeginInit();
            b.UriSource = new Uri(url);
            b.DecodePixelWidth = decodeWidth;
            b.CacheOption = BitmapCacheOption.OnLoad;
            b.EndInit();
            img.Source = b;
        }
        catch { /* 图片坏了就显示占位 */ }
    }

    public static TextBlock Text(string t, double size = 13, Brush? fg = null, FontWeight? w = null, bool wrap = false)
    {
        var tb = new TextBlock { Text = t, FontSize = size, Foreground = fg ?? Fg, FontWeight = w ?? FontWeights.Normal };
        if (wrap) tb.TextWrapping = TextWrapping.Wrap; else tb.TextTrimming = TextTrimming.CharacterEllipsis;
        return tb;
    }

    public static string Duration(double minutes)
    {
        if (minutes <= 0) return "";
        int m = (int)Math.Round(minutes);
        return m >= 60 ? $"{m / 60} 小时 {m % 60} 分" : $"{m} 分钟";
    }

    /// <summary>封面卡片。wide = 横版（16:9，继续观看用）</summary>
    public static FrameworkElement CardOf(Item it, INav nav, double w = 150, bool wide = false)
    {
        double h = wide ? w * 9 / 16 : w * 1.5;
        var img = new Image { Stretch = Stretch.UniformToFill };
        SetImage(img, nav.Api.ImageUrl(it, "Primary", (int)(w * 2)), (int)(w * 2));
        var grid = new Grid { Width = w, Height = h, Clip = new RectangleGeometry(new Rect(0, 0, w, h), 6, 6), Background = Card };
        grid.Children.Add(new TextBlock { Text = it.Name.Length > 0 ? it.Name[..1] : "?", FontSize = 28, Foreground = Muted, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
        grid.Children.Add(img);
        var pct = it.UserData?.PlayedPercentage ?? 0;
        if (pct > 1 && pct < 100)
        {
            var bar = new Border { Height = 4, Background = Hex("#99000000"), VerticalAlignment = VerticalAlignment.Bottom };
            bar.Child = new Border { Background = Accent, HorizontalAlignment = HorizontalAlignment.Left, Width = w * pct / 100 };
            grid.Children.Add(bar);
        }
        if (it.UserData?.Played == true)
            grid.Children.Add(new Border { Background = Accent, CornerRadius = new CornerRadius(10), Width = 20, Height = 20, Margin = new Thickness(0, 6, 6, 0), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Child = new TextBlock { Text = "✓", FontSize = 12, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } });
        var frame = new Border { BorderThickness = new Thickness(2), BorderBrush = Brushes.Transparent, CornerRadius = new CornerRadius(8), Child = grid };
        var sp = new StackPanel { Width = w + 4, Margin = new Thickness(6, 4, 6, 10), Cursor = Cursors.Hand, Background = Brushes.Transparent };
        sp.Children.Add(frame);
        sp.Children.Add(new TextBlock { Text = it.Name, FontSize = 13, Foreground = Fg, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(2, 6, 2, 0), ToolTip = it.Name });
        sp.Children.Add(new TextBlock { Text = it.Sub, FontSize = 12, Foreground = Muted, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(2, 0, 2, 0) });
        sp.MouseEnter += (_, _) => frame.BorderBrush = Accent;
        sp.MouseLeave += (_, _) => frame.BorderBrush = Brushes.Transparent;
        sp.MouseLeftButtonUp += (_, _) => nav.Open(it);
        return sp;
    }

    /// <summary>带标题的横向滚动列表</summary>
    public static StackPanel Shelf(string title, IEnumerable<FrameworkElement> cards)
    {
        var root = new StackPanel { Margin = new Thickness(0, 0, 0, 14) };
        root.Children.Add(new TextBlock { Text = title, FontSize = 18, FontWeight = FontWeights.SemiBold, Foreground = Fg, Margin = new Thickness(6, 0, 0, 6) });
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var c in cards) row.Children.Add(c);
        var sv = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = row };
        sv.PreviewMouseWheel += (s, e) =>
        {
            // 竖向滚轮交给外层页面滚动，不被横向列表吃掉
            if (e.Handled) return;
            e.Handled = true;
            var a = new MouseWheelEventArgs(e.MouseDevice, e.Timestamp, e.Delta) { RoutedEvent = UIElement.MouseWheelEvent, Source = s };
            (((FrameworkElement)s).Parent as UIElement)?.RaiseEvent(a);
        };
        root.Children.Add(sv);
        return root;
    }

    public static Button Btn(string text, bool primary = true)
    {
        var b = new Button { Content = text, Margin = new Thickness(0, 0, 10, 0), Padding = new Thickness(18, 9, 18, 9), FontSize = 14 };
        if (!primary) b.Background = Hex("#2A2E39");
        return b;
    }
}
