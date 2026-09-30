using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed partial class MainForm
{
    private bool _hubPreload;
    private bool _hubPreloadSettled;
    private bool _hubPreloadLaunchScheduled;
    private Process _hubPreloadParent;
    private Rectangle _hubPreloadBounds;
    private System.Windows.Forms.Timer _hubPreloadTimer;
    private CancellationTokenSource _hubPreloadCancellation;
    private readonly CancellationTokenSource _formLifetime = new CancellationTokenSource();

    protected override bool ShowWithoutActivation { get { return _hubPreload || base.ShowWithoutActivation; } }

    private void InitializeHubPreload()
    {
        if (!_hubMode || Program.HubPreloadClaimed) return;
        foreach (string argument in Environment.GetCommandLineArgs())
        {
            if (!argument.StartsWith("--hub-preload=", StringComparison.Ordinal)) continue;
            int parentId;
            if (!int.TryParse(argument.Substring("--hub-preload=".Length), out parentId)) return;
            _hubPreload = true;
            try { _hubPreloadParent = Process.GetProcessById(parentId); }
            catch (ArgumentException) { }
            _hubPreloadCancellation = CancellationTokenSource.CreateLinkedTokenSource(_formLifetime.Token);
            _hubPreloadCancellation.CancelAfter(TimeSpan.FromMinutes(1));
            return;
        }
    }

    private void StartHubPreloadWindow()
    {
        _hubPreloadBounds = Bounds;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-30000, -30000);
        _hubPreloadTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _hubPreloadTimer.Tick += async delegate
        {
            if (!_hubPreload || _exitRequested) return;
            bool parentExited = _hubPreloadParent == null;
            try { parentExited = parentExited || _hubPreloadParent.HasExited; }
            catch (InvalidOperationException) { parentExited = true; }
            if (parentExited) { RetireHubPreload("Initiating DSH exited"); return; }
            if (_hubPreloadSettled || !_hubPreloadCancellation.IsCancellationRequested) return;
            _hubPreloadSettled = true;
            if (!_webUiVerified) { RetireHubPreload("Preload readiness budget expired"); return; }
            _webView.Visible = false;
            if (_revealTimer != null) _revealTimer.Stop();
            try
            {
                await Task.Delay(100, _formLifetime.Token);
                if (!_hubPreload || _exitRequested) return;
                bool suspended = await _webView.CoreWebView2.TrySuspendAsync();
                if (!_hubPreload && !IsDisposed) { _webView.CoreWebView2.Resume(); _webView.Visible = true; }
                else { Hide(); AppendLog(suspended ? "HUB preloaded; renderer suspended" : "HUB preloaded; renderer hidden (suspend declined)"); }
            }
            catch (Exception ex) { AppendLog("HUB renderer sleep: " + ex.ToString()); }
        };
        _hubPreloadTimer.Start();
    }

    private void RetireHubPreload(string reason)
    {
        if (!_hubPreload || _exitRequested) return;
        AppendLog(reason);
        _exitRequested = true;
        Close();
    }

    private void ClaimHubPreload()
    {
        if (!_hubPreload) return;
        _hubPreload = false;
        Program.HubPreloadClaimed = true;
        if (_hubPreloadTimer != null) { _hubPreloadTimer.Stop(); _hubPreloadTimer.Dispose(); _hubPreloadTimer = null; }
        if (_hubPreloadParent != null) { _hubPreloadParent.Dispose(); _hubPreloadParent = null; }
        if (!_hubPreloadCancellation.IsCancellationRequested) _hubPreloadCancellation.CancelAfter(Timeout.Infinite);
        if (_webView != null && _webView.CoreWebView2 != null) _webView.CoreWebView2.Resume();
        if (_webView != null) _webView.Visible = true;
        Bounds = _hubPreloadBounds;
        Opacity = 1D;
        if (_trayIcon != null) _trayIcon.Visible = true;
        if (_revealTimer != null) _revealTimer.Start();
        AppendLog("Preloaded HUB claimed by user; independent lifetime restored");
    }

    private async void ScheduleHubPreload()
    {
        if (_hubMode || _hubPreloadLaunchScheduled || !_hubConfig.PreloadOnDesktopStart) return;
        _hubPreloadLaunchScheduled = true;
        try
        {
            await Task.Delay(5000, _formLifetime.Token);
            if (_exitRequested || IsDisposed || !HubConfig.Load().PreloadOnDesktopStart) return;
            string path = Path.Combine(AppPaths.ExeDir, "dsh-hub.exe");
            if (!File.Exists(path)) return;
            ProcessStartInfo start = new ProcessStartInfo(path, AppPaths.CompanionArguments("--hub-preload=" + Process.GetCurrentProcess().Id));
            start.WorkingDirectory = AppPaths.ExeDir;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            using (Process process = Process.Start(start)) { }
            AppendLog("HUB background preload requested after Desktop readiness");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { AppendLog("Optional HUB preload skipped: " + ex.Message); }
    }

    private void DisposeHubPreload()
    {
        _formLifetime.Cancel();
        if (_hubPreloadCancellation != null) { _hubPreloadCancellation.Cancel(); _hubPreloadCancellation.Dispose(); }
        if (_hubPreloadTimer != null) { _hubPreloadTimer.Stop(); _hubPreloadTimer.Dispose(); }
        if (_hubPreloadParent != null) _hubPreloadParent.Dispose();
    }
}
