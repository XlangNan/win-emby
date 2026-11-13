using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Weave.Emby;

namespace Weave;

public partial class MainWindow : Window
{
    private readonly Settings _s = Settings.Load();
    private readonly EmbyClient _api;
    private int _navToken;

    public MainWindow()
    {
        InitializeComponent();
        _api = new EmbyClient(_s);
        ServerBox.Text = _s.Server;
        UserBox.Text = _s.UserName;
        Loaded += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        if (!_api.LoggedIn) { ShowLogin(); return; }
        await EnterMainAsync();
    }

    private void ShowLogin()
    {
        MainPane.Visibility = Visibility.Collapsed;
        LoginPane.Visibility = Visibility.Visible;
    }

    private async Task EnterMainAsync()
    {
        LoginPane.Visibility = Visibility.Collapsed;
        MainPane.Visibility = Visibility.Visible;
        try
        {
            var views = await _api.ViewsAsync();
            var nav = new List<NavItem> { new("继续观看", null) };
            nav.AddRange(views.Select(v => new NavItem(v.Name, v.Id)));
            Nav.ItemsSource = nav;
            Nav.SelectedIndex = 0;
        }
        catch (Exception e)
        {
            if (!_api.LoggedIn) { LoginErr.Text = e.Message; ShowLogin(); }
            else { PageTitle.Text = ""; Status.Text = "加载失败：" + e.Message; }
        }
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        LoginErr.Text = "";
        if (string.IsNullOrWhiteSpace(ServerBox.Text) || string.IsNullOrWhiteSpace(UserBox.Text)) { LoginErr.Text = "请填写服务器地址和用户名"; return; }
        LoginBtn.IsEnabled = false;
        try
        {
            await _api.LoginAsync(ServerBox.Text, UserBox.Text.Trim(), PassBox.Password);
            PassBox.Password = "";
            await EnterMainAsync();
        }
        catch (TaskCanceledException) { LoginErr.Text = "连接超时，检查服务器地址和网络"; }
        catch (Exception ex) { LoginErr.Text = ex.Message; }
        finally { LoginBtn.IsEnabled = true; }
    }

    private void PassBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Login_Click(sender, e);
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        _api.Logout();
        ShowLogin();
    }

    private async void Nav_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (Nav.SelectedItem is not NavItem n) return;
        var token = ++_navToken;
        PageTitle.Text = n.Name;
        Grid2.ItemsSource = null;
        Status.Text = "加载中…";
        try
        {
            var items = n.Id == null ? await _api.ResumeAsync() : (await _api.LibraryAsync(n.Id)).Items;
            if (token != _navToken) return;
            Grid2.ItemsSource = items;
            Status.Text = items.Count == 0 ? "这里还没有内容" : "";
        }
        catch (Exception ex)
        {
            if (token != _navToken) return;
            Status.Text = "加载失败：" + ex.Message;
        }
    }

    private void Grid2_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (Grid2.SelectedItem is Item it) MessageBox.Show($"「{it.Name}」的详情页和播放，下一阶段做。", "织影");
    }

    private sealed record NavItem(string Name, string? Id);
}
