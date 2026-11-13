using System.Windows;
using System.Windows.Controls;

namespace Weave.Pages;

public sealed class SettingsPage : UserControl
{
    public SettingsPage(INav nav, Action logout)
    {
        var s = new StackPanel { Margin = new Thickness(6), MaxWidth = 560, HorizontalAlignment = HorizontalAlignment.Left };
        s.Children.Add(Ui.Text("账号", 18, null, FontWeights.SemiBold));
        s.Children.Add(Row("服务器", nav.Api.S.Server));
        s.Children.Add(Row("用户", nav.Api.S.UserName));
        var out_ = Ui.Btn("退出登录", false);
        out_.Margin = new Thickness(0, 14, 0, 0);
        out_.HorizontalAlignment = HorizontalAlignment.Left;
        out_.Click += (_, _) => logout();
        s.Children.Add(out_);
        s.Children.Add(Ui.Text("关于", 18, null, FontWeights.SemiBold).WithMargin(0, 28, 0, 0));
        s.Children.Add(Row("版本", "织影 Weave 原生版 0.2.0（开发中）"));
        Content = s;
    }

    private static UIElement Row(string k, string v)
    {
        var g = new Grid { Margin = new Thickness(0, 8, 0, 0) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.Children.Add(Ui.Text(k, 14, Ui.Muted));
        var val = Ui.Text(v, 14, null, null, true);
        Grid.SetColumn(val, 1);
        g.Children.Add(val);
        return g;
    }
}

internal static class Ext
{
    public static T WithMargin<T>(this T e, double l, double t, double r, double b) where T : FrameworkElement
    {
        e.Margin = new Thickness(l, t, r, b);
        return e;
    }
}
