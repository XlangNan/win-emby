using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Weave.Emby;

namespace Weave.Player;

/// <summary>内置播放器：mpv 画面 + 盖在上面的透明控制层。
/// 原生子窗口会盖住 WPF 控件（所谓 airspace），所以控制层是另一个跟随主窗口的透明小窗口。</summary>
public sealed class PlayerWindow : Window
{
    private static readonly string[] UaList =
    {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Emby/4.8 (Windows) ExoPlayerLib/2.18.7",
        "VLC/3.0.20 LibVLC/3.0.20",
    };

    private readonly EmbyClient _api;
    private Item _item;
    private readonly double _startSec;
    private readonly MpvHost _host = new();
    private Mpv? _mpv;
    private Overlay? _ov;
    private EmbyClient.PlayInfo? _info;

    private double _pos, _dur;
    private bool _paused, _caching, _started, _ended, _full, _stopped;
    private WindowState _prevState;
    private readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromMilliseconds(500) };
    private readonly DispatcherTimer _report = new() { Interval = TimeSpan.FromSeconds(10) };
    private DateTime _lastMove = DateTime.Now;

    // 打不开时的救援：换 UA → 经 Emby 中转
    private readonly Queue<string> _rescue = new();
    private DispatcherTimer? _openTimer;
    private string _openLog = "";

    public PlayerWindow(EmbyClient api, Item item, double startSec)
    {
        _api = api;
        _item = item;
        _startSec = startSec;
        Title = item.Name;
        Width = 1100; Height = 640; Background = Brushes.Black;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Content = _host;
        Loaded += OnLoaded;
        Closed += OnClosed;
        LocationChanged += (_, _) => SyncOverlay();
        SizeChanged += (_, _) => SyncOverlay();
        StateChanged += (_, _) => SyncOverlay();
        _host.SizeChanged += (_, _) => SyncOverlay();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            _ov = new Overlay(this) { Owner = this };
            _ov.Show();
            SyncOverlay();
            if (_host.Hwnd == IntPtr.Zero) throw new Exception("没有拿到画面窗口");
            _mpv = new Mpv(_host.Hwnd, true, "");
            _mpv.Property += (n, v) => Dispatcher.BeginInvoke(() => OnProp(n, v));
            _mpv.EndFile += (reason, err) => Dispatcher.BeginInvoke(() => OnEndFile(reason, err));
            await StartItemAsync(_item, _startSec);
        }
        catch (Exception ex)
        {
            MessageBox.Show("播放器启动失败：\n" + ex.Message + (ex is DllNotFoundException ? "\n\n缺少 libmpv-2.dll（要和 Weave.exe 放在同一个文件夹）" : ""), "织影");
            Close();
        }
        _tick.Tick += (_, _) => OnTick();
        _tick.Start();
        _report.Tick += (_, _) => _ = Report("/Progress");
        _report.Start();
    }

    private async Task StartItemAsync(Item it, double startSec)
    {
        _item = it;
        Title = it.Name;
        _ov?.SetTitle(it.Type == "Episode" ? $"{it.SeriesName}  S{it.ParentIndexNumber}E{it.IndexNumber}  {it.Name}" : it.Name);
        _pos = 0; _dur = 0; _started = false; _ended = false; _stopped = false;
        _info = await _api.PlaybackInfoAsync(it.Id);
        _rescue.Clear();
        _openLog = "";
        string first;
        if (_info.Remote)
        {
            // strm 直链：先用默认 UA，打不开再依次换 UA，最后经 Emby 中转
            first = _info.Path!;
            for (int i = 0; i < UaList.Length; i++) _rescue.Enqueue("ua:" + i);
            _rescue.Enqueue("emby");
        }
        else first = _api.StreamUrl(it.Id, _info.SourceId, _info.PlaySessionId);
        Load(first, startSec);
        await _api.ReportAsync("", it.Id, _info, startSec, false);
    }

    private void Load(string url, double startSec)
    {
        if (_mpv == null) return;
        _ov?.ShowError("");
        var opts = startSec > 1 ? "start=" + startSec.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) : "";
        _mpv.Command("loadfile", url, "replace", "-1", opts);
        _mpv.Set("pause", "no");
        ArmOpen(12);
    }

    private void ArmOpen(int sec)
    {
        _openTimer?.Stop();
        _openTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(sec) };
        _openTimer.Tick += (_, _) => { _openTimer?.Stop(); OpenFailed(); };
        _openTimer.Start();
    }

    private void OpenFailed()
    {
        if (_started || _ended || _mpv == null || _info == null) return;
        if (_rescue.Count == 0)
        {
            _ov?.ShowError("这个视频播放不了\n" + _openLog + "可以回到列表，换个视频试试");
            return;
        }
        var step = _rescue.Dequeue();
        var resume = _pos > 1 ? _pos : _startSec;
        if (step == "emby")
        {
            _openLog += "改经 Emby 中转\n";
            Load(_api.StreamUrl(_item.Id, _info.SourceId, _info.PlaySessionId), resume);
        }
        else
        {
            int i = int.Parse(step.Substring(3));
            _openLog += $"换 UA {i + 1}\n";
            _mpv.Set("user-agent", UaList[i]);
            Load(_info.Path!, resume);
        }
    }

    // ───────── mpv 事件（已在界面线程） ─────────
    private void OnProp(string name, object? v)
    {
        switch (name)
        {
            case "time-pos" when v is double t:
                _pos = t;
                if (!_started) { _started = true; _openTimer?.Stop(); _ov?.ShowError(""); }
                break;
            case "duration" when v is double d: _dur = d; break;
            case "pause": _paused = v is true; _ov?.SetPaused(_paused); break;
            case "paused-for-cache": _caching = v is true; _ov?.SetBusy(_caching || !_started); break;
            case "volume" when v is double vol: _ov?.SetVolume(vol); break;
            case "mute": _ov?.SetMuted(v is true); break;
            case "speed" when v is double sp: _ov?.SetSpeed(sp); break;
        }
    }

    private async void OnEndFile(int reason, int err)
    {
        if (_stopped) return;
        if (reason == 4 && !_started) { _openTimer?.Stop(); OpenFailed(); return; }
        if (reason != 0) return;
        // 播完
        _ended = true;
        await Report("/Stopped");
        _stopped = true;
        var next = await _api.NextEpisodeAsync(_item);
        if (next != null) { await StartItemAsync(next, 0); return; }
        Close();
    }

    private void OnTick()
    {
        _ov?.SetProgress(_pos, _dur);
        if (_ov != null && DateTime.Now - _lastMove > TimeSpan.FromSeconds(3) && !_paused && !_ov.Hovering) _ov.HideUi();
    }

    private Task Report(string kind) =>
        _info == null ? Task.CompletedTask : _api.ReportAsync(kind, _item.Id, _info, _pos, _paused);

    private async void OnClosed(object? sender, EventArgs e)
    {
        _tick.Stop(); _report.Stop(); _openTimer?.Stop();
        if (!_stopped && _info != null) await Report("/Stopped");
        _ov?.Close();
        _mpv?.Dispose();
        _mpv = null;
    }

    // ───────── 控制层调用 ─────────
    public void TogglePause() => _mpv?.Set("pause", _paused ? "no" : "yes");
    public void SeekAbs(double sec) => _mpv?.Command("seek", sec.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture), "absolute");
    public void SeekRel(double sec) => _mpv?.Command("seek", sec.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture), "relative");
    public void SetVolume(double v) => _mpv?.Set("volume", Math.Clamp(v, 0, 130).ToString("0", System.Globalization.CultureInfo.InvariantCulture));
    public void ToggleMute() => _mpv?.Command("cycle", "mute");
    public void SetSpeed(double s) => _mpv?.Set("speed", s.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
    public double Volume => _mpv?.GetDouble("volume") ?? 100;
    public void Moved() { _lastMove = DateTime.Now; _ov?.ShowUi(); }

    public async void PlayNext()
    {
        var n = await _api.NextEpisodeAsync(_item);
        if (n == null) return;
        await Report("/Stopped");
        await StartItemAsync(n, 0);
    }

    public record Track(string Type, string Id, string Label, bool Selected);
    public List<Track> Tracks()
    {
        var list = new List<Track>();
        if (_mpv == null) return list;
        int n = int.TryParse(_mpv.Get("track-list/count"), out var c) ? c : 0;
        for (int i = 0; i < n; i++)
        {
            var type = _mpv.Get($"track-list/{i}/type") ?? "";
            if (type != "audio" && type != "sub") continue;
            var id = _mpv.Get($"track-list/{i}/id") ?? "";
            var lang = _mpv.Get($"track-list/{i}/lang") ?? "";
            var title = _mpv.Get($"track-list/{i}/title") ?? "";
            var codec = _mpv.Get($"track-list/{i}/codec") ?? "";
            var sel = _mpv.Get($"track-list/{i}/selected") == "yes";
            var label = string.Join("  ", new[] { lang, title, codec }.Where(x => x.Length > 0));
            list.Add(new Track(type, id, label.Length > 0 ? label : $"轨道 {id}", sel));
        }
        return list;
    }
    public void PickTrack(string type, string id) => _mpv?.Set(type == "audio" ? "aid" : "sid", id);

    public bool IsFull => _full;
    public void ToggleFull()
    {
        if (!_full)
        {
            _prevState = WindowState;
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            WindowState = _prevState;
        }
        _full = !_full;
        SyncOverlay();
    }

    private void SyncOverlay()
    {
        if (_ov == null || !_host.IsLoaded) return;
        var src = PresentationSource.FromVisual(_host);
        if (src?.CompositionTarget == null) return;
        var px = _host.PointToScreen(new Point(0, 0));
        var tl = src.CompositionTarget.TransformFromDevice.Transform(px);
        _ov.Left = tl.X; _ov.Top = tl.Y;
        _ov.Width = Math.Max(1, _host.ActualWidth); _ov.Height = Math.Max(1, _host.ActualHeight);
    }

    // ───────────────────────── 控制层 ─────────────────────────
    private sealed class Overlay : Window
    {
        private readonly PlayerWindow _p;
        private readonly Grid _ui = new();
        private readonly Border _top, _bottom;
        private readonly TextBlock _title = Ui.Text("", 16, Brushes.White, FontWeights.SemiBold);
        private readonly TextBlock _timeL = Ui.Text("0:00", 12.5, Brushes.White), _timeR = Ui.Text("0:00", 12.5, Brushes.White);
        private readonly Slider _seek = new() { Minimum = 0, Maximum = 1, IsMoveToPointEnabled = true, Height = 22, VerticalAlignment = VerticalAlignment.Center };
        private readonly Slider _vol = new() { Minimum = 0, Maximum = 130, Value = 100, Width = 90, IsMoveToPointEnabled = true, VerticalAlignment = VerticalAlignment.Center };
        private readonly Button _play = Mk("⏸"), _mute = Mk("🔊"), _audio = Mk("音轨"), _sub = Mk("字幕"), _speed = Mk("1×"), _full = Mk("⛶"), _next = Mk("⏭"), _back = Mk("←");
        private readonly TextBlock _busy = Ui.Text("加载中…", 16, Brushes.White);
        private readonly TextBlock _err = Ui.Text("", 15, Brushes.White, null, true);
        private bool _syncing, _dragging;
        public bool Hovering => _bottom.IsMouseOver || _top.IsMouseOver;

        private static Button Mk(string t) => new() { Content = t, Background = Brushes.Transparent, Foreground = Brushes.White, FontSize = 15, Padding = new Thickness(10, 6, 10, 6), Margin = new Thickness(2, 0, 2, 0), BorderThickness = new Thickness(0), MinWidth = 36 };

        public Overlay(PlayerWindow p)
        {
            _p = p;
            WindowStyle = WindowStyle.None; AllowsTransparency = true; ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false; Background = Brushes.Transparent; Topmost = false;

            var root = new Grid();
            // 整块透明底：接住点击（暂停 / 双击全屏）和鼠标移动
            var backdrop = new Border { Background = Ui.Hex("#01000000") };
            backdrop.MouseLeftButtonDown += (_, e) =>
            {
                if (e.ClickCount == 1) _p.TogglePause();
                else if (e.ClickCount == 2) { _p.TogglePause(); _p.ToggleFull(); }
            };
            root.Children.Add(backdrop);

            _busy.HorizontalAlignment = HorizontalAlignment.Center; _busy.VerticalAlignment = VerticalAlignment.Center; _busy.IsHitTestVisible = false;
            root.Children.Add(_busy);
            _err.HorizontalAlignment = HorizontalAlignment.Center; _err.VerticalAlignment = VerticalAlignment.Center; _err.TextAlignment = TextAlignment.Center; _err.MaxWidth = 620; _err.IsHitTestVisible = false;
            root.Children.Add(_err);

            // 顶栏
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(12, 10, 12, 30) };
            topRow.Children.Add(_back);
            _title.Margin = new Thickness(8, 0, 0, 0); _title.VerticalAlignment = VerticalAlignment.Center;
            topRow.Children.Add(_title);
            _top = new Border { VerticalAlignment = VerticalAlignment.Top, Child = topRow, Background = new LinearGradientBrush(Color.FromArgb(200, 0, 0, 0), Color.FromArgb(0, 0, 0, 0), 90) };
            root.Children.Add(_top);

            // 底栏
            var seekRow = new Grid { Margin = new Thickness(0, 0, 0, 2) };
            seekRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            seekRow.ColumnDefinitions.Add(new ColumnDefinition());
            seekRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            _timeL.Margin = new Thickness(0, 0, 10, 0); _timeR.Margin = new Thickness(10, 0, 0, 0);
            Grid.SetColumn(_seek, 1); Grid.SetColumn(_timeR, 2);
            seekRow.Children.Add(_timeL); seekRow.Children.Add(_seek); seekRow.Children.Add(_timeR);

            var btns = new DockPanel();
            var left = new StackPanel { Orientation = Orientation.Horizontal };
            left.Children.Add(_play); left.Children.Add(_next); left.Children.Add(_mute); left.Children.Add(_vol);
            var right = new StackPanel { Orientation = Orientation.Horizontal };
            right.Children.Add(_audio); right.Children.Add(_sub); right.Children.Add(_speed); right.Children.Add(_full);
            DockPanel.SetDock(right, Dock.Right);
            btns.Children.Add(right); btns.Children.Add(left);
            var col = new StackPanel(); col.Children.Add(seekRow); col.Children.Add(btns);
            col.Margin = new Thickness(18, 34, 18, 12);
            _bottom = new Border { VerticalAlignment = VerticalAlignment.Bottom, Child = col, Background = new LinearGradientBrush(Color.FromArgb(0, 0, 0, 0), Color.FromArgb(220, 0, 0, 0), 90) };
            root.Children.Add(_bottom);
            Content = root;

            // 事件
            _back.Click += (_, _) => _p.Close();
            _play.Click += (_, _) => _p.TogglePause();
            _next.Click += (_, _) => _p.PlayNext();
            _mute.Click += (_, _) => _p.ToggleMute();
            _full.Click += (_, _) => _p.ToggleFull();
            _vol.ValueChanged += (_, e) => { if (!_syncing) _p.SetVolume(e.NewValue); };
            _audio.Click += (_, _) => TrackMenu(_audio, "audio");
            _sub.Click += (_, _) => TrackMenu(_sub, "sub");
            _speed.Click += (_, _) => SpeedMenu();
            _seek.AddHandler(Thumb.DragStartedEvent, new DragStartedEventHandler((_, _) => _dragging = true));
            _seek.AddHandler(Thumb.DragCompletedEvent, new DragCompletedEventHandler((_, _) => { _dragging = false; _p.SeekAbs(_seek.Value); }));
            _seek.ValueChanged += (_, e) =>
            {
                if (_syncing) return;
                if (!_dragging) _p.SeekAbs(e.NewValue);   // 点进度条某处
                _timeL.Text = Fmt(e.NewValue);
            };
            MouseMove += (_, _) => _p.Moved();
            PreviewKeyDown += OnKey;
            Loaded += (_, _) => Focus();
            // Alt+F4 关到控制层时，连播放窗口一起关
            Closed += (_, _) => { try { _p.Close(); } catch { /* 已在关闭中 */ } };
        }

        private void OnKey(object s, KeyEventArgs e)
        {
            switch (e.Key)
            {
                case Key.Space: _p.TogglePause(); break;
                case Key.Left: _p.SeekRel(e.KeyboardDevice.Modifiers == ModifierKeys.Shift ? -30 : -10); break;
                case Key.Right: _p.SeekRel(e.KeyboardDevice.Modifiers == ModifierKeys.Shift ? 30 : 10); break;
                case Key.Up: _p.SetVolume(_p.Volume + 5); break;
                case Key.Down: _p.SetVolume(_p.Volume - 5); break;
                case Key.F: _p.ToggleFull(); break;
                case Key.M: _p.ToggleMute(); break;
                case Key.N: _p.PlayNext(); break;
                case Key.Escape: if (_p.IsFull) _p.ToggleFull(); else _p.Close(); break;
                default: return;
            }
            e.Handled = true;
            _p.Moved();
        }

        private void TrackMenu(Button anchor, string type)
        {
            var m = new ContextMenu { PlacementTarget = anchor, Placement = PlacementMode.Top };
            if (type == "sub")
            {
                var off = new MenuItem { Header = "关闭字幕" };
                off.Click += (_, _) => _p.PickTrack("sub", "no");
                m.Items.Add(off);
            }
            foreach (var t in _p.Tracks().Where(x => x.Type == type))
            {
                var mi = new MenuItem { Header = t.Label, IsChecked = t.Selected };
                var id = t.Id;
                mi.Click += (_, _) => _p.PickTrack(type, id);
                m.Items.Add(mi);
            }
            if (m.Items.Count == 0) m.Items.Add(new MenuItem { Header = "没有可选的轨道", IsEnabled = false });
            m.IsOpen = true;
        }

        private void SpeedMenu()
        {
            var m = new ContextMenu { PlacementTarget = _speed, Placement = PlacementMode.Top };
            foreach (var s in new[] { 0.5, 0.75, 1.0, 1.25, 1.5, 2.0 })
            {
                var v = s;
                var mi = new MenuItem { Header = $"{s}×" };
                mi.Click += (_, _) => _p.SetSpeed(v);
                m.Items.Add(mi);
            }
            m.IsOpen = true;
        }

        private static string Fmt(double s)
        {
            if (s < 0 || double.IsNaN(s)) s = 0;
            var t = TimeSpan.FromSeconds(s);
            return t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes}:{t.Seconds:00}";
        }

        // ── 给 PlayerWindow 调用 ──
        public void SetTitle(string t) => _title.Text = t;
        public void SetPaused(bool p) => _play.Content = p ? "▶" : "⏸";
        public void SetBusy(bool b) => _busy.Visibility = b ? Visibility.Visible : Visibility.Collapsed;
        public void SetMuted(bool m) => _mute.Content = m ? "🔇" : "🔊";
        public void SetSpeed(double s) => _speed.Content = $"{s}×";
        public void ShowError(string t) { _err.Text = t; if (t.Length > 0) _busy.Visibility = Visibility.Collapsed; }
        public void SetVolume(double v) { _syncing = true; _vol.Value = v; _syncing = false; }
        public void SetProgress(double pos, double dur)
        {
            if (_dragging) return;
            _syncing = true;
            if (dur > 0) _seek.Maximum = dur;
            _seek.Value = Math.Min(pos, _seek.Maximum);
            _syncing = false;
            _timeL.Text = Fmt(pos); _timeR.Text = Fmt(dur);
        }
        public void ShowUi() { _top.Opacity = 1; _bottom.Opacity = 1; Cursor = Cursors.Arrow; }
        public void HideUi() { _top.Opacity = 0; _bottom.Opacity = 0; Cursor = Cursors.None; }
    }
}
