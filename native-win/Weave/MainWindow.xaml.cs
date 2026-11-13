using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Weave.Emby;
using Weave.Pages;

namespace Weave;

public partial class MainWindow : Window, INav
{
    private readonly Settings _s = Settings.Load();
    private readonly EmbyClient _api;
    private List<Item> _views = new();
    private readonly Stack<(UIElement Page, string Title)> _stack = new();

    public EmbyClient Api => _api;

    public MainWindow()
    {
        InitializeComponent();
        _api = new EmbyClient(_s);
        ServerBox.Text = _s.Server;
        UserBox.Text = _s.UserName;
        Loaded += async (_, _) =>
        {
            if (!_api.LoggedIn) ShowLogin(); else await EnterMainAsync();
        };
    }

    // ───────── 登录 ─────────
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
            _views = await _api.ViewsAsync();
            var nav = new List<NavEntry> { new("首页", "home", null), new("搜索", "search", null) };
            nav.AddRange(_views.Select(v => new NavEntry(v.Name, "lib", v.Id)));
            nav.Add(new("设置", "settings", null));
            Nav.ItemsSource = nav;
            Nav.SelectedIndex = 0;
        }
        catch (Exception e)
        {
            if (!_api.LoggedIn) { LoginErr.Text = e.Message; ShowLogin(); }
            else Root(Ui.Text("加载失败：" + e.Message, 14, Ui.Muted), "");
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

    private void Logout()
    {
        _api.Logout();
        _stack.Clear();
        Host.Content = null;
        ShowLogin();
    }

    // ───────── 导航 ─────────
    private void Root(UIElement page, string title)
    {
        _stack.Clear();
        Host.Content = page;
        PageTitle.Text = title;
        BackBtn.Visibility = Visibility.Collapsed;
    }

    private void Push(UIElement page, string title)
    {
        if (Host.Content is UIElement cur) _stack.Push((cur, PageTitle.Text));
        Host.Content = page;
        PageTitle.Text = title;
        BackBtn.Visibility = Visibility.Visible;
    }

    public void Back()
    {
        if (_stack.Count == 0) return;
        var (p, t) = _stack.Pop();
        Host.Content = p;
        PageTitle.Text = t;
        BackBtn.Visibility = _stack.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void Back_Click(object sender, RoutedEventArgs e) => Back();

    private void Window_PreviewMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.XButton1) { Back(); e.Handled = true; }
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.OriginalSource is TextBox or PasswordBox) return;
        if (e.Key == Key.Escape || (e.Key == Key.Left && Keyboard.Modifiers == ModifierKeys.Alt)) { Back(); e.Handled = true; }
    }

    private void Nav_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (Nav.SelectedItem is not NavEntry n) return;
        switch (n.Kind)
        {
            case "home": Root(new HomePage(this, _views), "首页"); break;
            case "search": Root(new SearchPage(this), "搜索"); break;
            case "lib": Root(new LibraryPage(this, n.Id!), n.Name); break;
            case "settings": Root(new SettingsPage(this, Logout), "设置"); break;
        }
    }

    public void Open(Item it)
    {
        if (it.NeedsLibraryPage) Push(new LibraryPage(this, it.Id), it.Name);
        else Push(new DetailPage(this, it), it.Name);
    }

    // ───────── 播放 ─────────
    public void Play(Item it)
    {
        var start = (it.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000.0;
        // 播完 95% 以上算看完了，从头开始
        if (it.RunTimeTicks is > 0 && (it.UserData?.PlaybackPositionTicks ?? 0) > it.RunTimeTicks * 0.95) start = 0;
        try
        {
            new Player.PlayerWindow(_api, it, start).Show();
        }
        catch (Exception e)
        {
            MessageBox.Show("播放器打不开：\n" + e.Message, "织影");
        }
    }

    private sealed record NavEntry(string Name, string Kind, string? Id);
}
