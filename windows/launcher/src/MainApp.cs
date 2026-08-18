using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class ProcessJob : IDisposable
{
    private const uint KillOnJobClose = 0x00002000;
    private const int ExtendedLimitInformation = 9;
    private IntPtr _handle;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInfo
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref ExtendedLimitInfo info, uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public ProcessJob()
    {
        _handle = CreateJobObject(IntPtr.Zero, null);
        if (_handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

        ExtendedLimitInfo info = new ExtendedLimitInfo();
        info.BasicLimitInformation.LimitFlags = KillOnJobClose;
        if (!SetInformationJobObject(_handle, ExtendedLimitInformation, ref info,
            (uint)Marshal.SizeOf(typeof(ExtendedLimitInfo))))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(_handle);
            _handle = IntPtr.Zero;
            throw new Win32Exception(error);
        }
    }

    public void Assign(Process process)
    {
        if (_handle == IntPtr.Zero) throw new ObjectDisposedException("ProcessJob");
        if (!AssignProcessToJobObject(_handle, process.Handle))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static bool IsCurrentProcessInJob()
    {
        bool result;
        if (!IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out result))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return result;
    }

    public void Terminate(uint exitCode)
    {
        if (_handle == IntPtr.Zero) return;
        if (!TerminateJobObject(_handle, exitCode))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public void Dispose()
    {
        if (_handle == IntPtr.Zero) return;
        CloseHandle(_handle);
        _handle = IntPtr.Zero;
    }
}

internal static class Program
{
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [STAThread]
    private static void Main()
    {
        try { SetProcessDPIAware(); } catch { }
        bool hubMode = string.Equals(
            Path.GetFileNameWithoutExtension(Application.ExecutablePath),
            "dsh-hub",
            StringComparison.OrdinalIgnoreCase);
        try
        {
            SetCurrentProcessExplicitAppUserModelID(hubMode
                ? "DeepSeek.Harness.Hub"
                : "DeepSeek.Harness.Desktop");
        }
        catch
        {
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        AppConfig config = AppConfig.Load();
        HubConfig hubConfig = HubConfig.Load();
        string productName = hubMode ? "HUB" : "DSH";
        bool silentActivation = Array.Exists(Environment.GetCommandLineArgs(), delegate(string argument)
        {
            return string.Equals(argument, "--activate-silent", StringComparison.OrdinalIgnoreCase);
        });
        bool reloadActivation = Array.Exists(Environment.GetCommandLineArgs(), delegate(string argument)
        {
            return string.Equals(argument, "--reload-silent", StringComparison.OrdinalIgnoreCase);
        });
        string instanceSuffix = BuildInstanceSuffix();
        string mutexName = "Local\\DeepSeekHarness." + (hubMode ? "Hub." : "Desktop.") + instanceSuffix;
        string activationEventName = mutexName + ".Activate";
        string silentActivationEventName = mutexName + ".ActivateSilent";
        string reloadActivationEventName = mutexName + ".ReloadSilent";
        bool createdNew;
        bool eventCreated;
        using (EventWaitHandle activationEvent = new EventWaitHandle(
            false, EventResetMode.AutoReset, activationEventName, out eventCreated))
        using (EventWaitHandle silentActivationEvent = new EventWaitHandle(
            false, EventResetMode.AutoReset, silentActivationEventName, out eventCreated))
        using (EventWaitHandle reloadActivationEvent = new EventWaitHandle(
            false, EventResetMode.AutoReset, reloadActivationEventName, out eventCreated))
        using (Mutex instanceMutex = new Mutex(true, mutexName, out createdNew))
        {
            if (!createdNew)
            {
                if (reloadActivation) reloadActivationEvent.Set();
                else if (silentActivation) silentActivationEvent.Set();
                else activationEvent.Set();
                return;
            }

            if (!config.FirstRunCompleted)
            {
                string configApp = Path.Combine(AppPaths.ExeDir, "dsh-config.exe");
                if (File.Exists(configApp))
                {
                    ProcessStartInfo startInfo = new ProcessStartInfo(configApp, "--first-run");
                    startInfo.WorkingDirectory = AppPaths.ExeDir;
                    Process.Start(startInfo);
                }
                else
                {
                    MessageBox.Show("First-time setup requires dsh-config.exe next to dsh.exe.",
                        "DSH", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return;
            }

            Application.Run(new MainForm(config, hubConfig, hubMode, activationEvent, silentActivationEvent, reloadActivationEvent));
        }
    }

    private static string BuildInstanceSuffix()
    {
        string value = Environment.GetEnvironmentVariable("DEEPSEEK_HARNESS_INSTANCE_SCOPE");
        if (string.IsNullOrEmpty(value)) return "DEFAULT";
        value = value.ToUpperInvariant();
        unchecked
        {
            uint hash = 2166136261;
            foreach (char character in value)
            {
                hash ^= character;
                hash *= 16777619;
            }
            return hash.ToString("X8");
        }
    }
}

internal sealed class LoadingOverlay : Control
{
    private readonly string _style;
    private readonly string _productName;
    private readonly System.Windows.Forms.Timer _timer;
    private string _stage;
    private float _progress;
    private float _targetProgress;
    private float _angle;
    private bool _completing;
    private bool _error;
    private bool _dismissed;
    private int _completeTicks;

    public event EventHandler Dismissed;

    public LoadingOverlay(string style, string productName)
    {
        _style = style;
        _productName = string.IsNullOrEmpty(productName) ? "DSH" : productName;
        _stage = "Preparing application";
        _progress = 4F;
        _targetProgress = 8F;
        Dock = DockStyle.Fill;
        BackColor = Color.FromArgb(8, 22, 52);
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

        _timer = new System.Windows.Forms.Timer();
        _timer.Interval = 33;
        _timer.Tick += delegate
        {
            _angle += 1.8F;
            if (_angle >= 360F) _angle -= 360F;
            if (_progress < _targetProgress)
            {
                float increment = Math.Max(0.12F, (_targetProgress - _progress) * 0.055F);
                _progress = Math.Min(_targetProgress, _progress + increment);
            }
            if (_completing && _progress >= 99.7F)
            {
                _completeTicks++;
                if (_completeTicks >= 9)
                {
                    _timer.Stop();
                    _dismissed = true;
                    Visible = false;
                    EventHandler handler = Dismissed;
                    if (handler != null) handler(this, EventArgs.Empty);
                    return;
                }
            }
            Invalidate();
        };

        Visible = style != "off";
        if (Visible) _timer.Start();
    }

    public void SetStage(string stage, float progress)
    {
        if (_style == "off" || _dismissed) return;
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)delegate { SetStage(stage, progress); });
            return;
        }
        _stage = string.IsNullOrEmpty(stage) ? "Working" : stage;
        _targetProgress = Math.Max(_targetProgress, Math.Min(96F, progress));
        _error = false;
        if (!_timer.Enabled) _timer.Start();
        Invalidate();
    }

    public void Complete(string stage)
    {
        if (_style == "off")
        {
            EventHandler handler = Dismissed;
            if (handler != null) handler(this, EventArgs.Empty);
            return;
        }
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)delegate { Complete(stage); });
            return;
        }
        _stage = string.IsNullOrEmpty(stage) ? "Interface ready" : stage;
        _targetProgress = 100F;
        _completing = true;
        _error = false;
        Invalidate();
    }

    public void ShowError(string stage)
    {
        if (_style == "off") return;
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)delegate { ShowError(stage); });
            return;
        }
        _stage = string.IsNullOrEmpty(stage) ? "Startup stopped" : stage;
        _targetProgress = Math.Max(_targetProgress, 72F);
        _progress = _targetProgress;
        _completing = false;
        _error = true;
        _timer.Stop();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        if (_style == "progress") DrawProgressLoader(e.Graphics);
        else DrawWhaleLoader(e.Graphics);
    }

    private void DrawWhaleLoader(Graphics graphics)
    {
        Rectangle bounds = ClientRectangle;
        if (bounds.Width <= 0 || bounds.Height <= 0) return;

        using (LinearGradientBrush background = new LinearGradientBrush(bounds,
            Color.FromArgb(6, 24, 59), Color.FromArgb(8, 54, 94), 90F))
        {
            graphics.FillRectangle(background, bounds);
        }

        int glowSize = Math.Max(420, Math.Min(bounds.Width, bounds.Height));
        Rectangle glowBounds = new Rectangle(
            bounds.Width / 2 - glowSize / 2,
            bounds.Height / 2 - glowSize / 2 - 40,
            glowSize,
            glowSize);
        using (GraphicsPath glowPath = new GraphicsPath())
        {
            glowPath.AddEllipse(glowBounds);
            using (PathGradientBrush glow = new PathGradientBrush(glowPath))
            {
                glow.CenterColor = Color.FromArgb(105, 78, 194, 224);
                glow.SurroundColors = new Color[] { Color.FromArgb(0, 8, 36, 72) };
                graphics.FillPath(glow, glowPath);
            }
        }

        for (int i = 0; i < 18; i++)
        {
            float bubbleX = (i * 137 % Math.Max(1, bounds.Width - 30)) + 15F;
            float bubbleY = (i * 83 % Math.Max(1, bounds.Height - 90)) + 45F;
            float bubbleSize = 2F + (i % 4);
            using (Brush bubble = new SolidBrush(Color.FromArgb(28 + (i % 3) * 10, 212, 244, 255)))
            {
                graphics.FillEllipse(bubble, bubbleX, bubbleY, bubbleSize, bubbleSize);
            }
        }

        float centerX = bounds.Width / 2F;
        float centerY = bounds.Height / 2F - 48F;
        float orbit = Math.Max(74F, Math.Min(bounds.Width, bounds.Height) * 0.095F);
        float whaleScale = Math.Max(0.72F, Math.Min(1.35F, Math.Min(bounds.Width, bounds.Height) / 720F));
        double radians = _angle * Math.PI / 180.0;
        PointF first = new PointF(
            centerX + (float)Math.Cos(radians) * orbit,
            centerY + (float)Math.Sin(radians) * orbit);
        PointF second = new PointF(
            centerX - (float)Math.Cos(radians) * orbit,
            centerY - (float)Math.Sin(radians) * orbit);
        DrawWhale(graphics, first, _angle + 90F, whaleScale, Color.FromArgb(238, 222, 248, 255));
        DrawWhale(graphics, second, _angle + 270F, whaleScale * 0.92F, Color.FromArgb(220, 118, 211, 240));

        float barY;
        using (StringFormat centered = new StringFormat())
        {
            centered.Alignment = StringAlignment.Center;
            centered.LineAlignment = StringAlignment.Center;
            using (Font titleFont = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold))
            using (Font stageFont = new Font("Consolas", 10F, FontStyle.Regular))
            using (Brush titleBrush = new SolidBrush(Color.FromArgb(244, 250, 255)))
            using (Brush stageBrush = new SolidBrush(_error ? Color.FromArgb(255, 181, 181) : Color.FromArgb(202, 225, 239)))
            {
                float titleY = centerY + orbit + 72F;
                float titleHeight = Math.Max(46F, titleFont.GetHeight(graphics) + 10F);
                float stageY = titleY + titleHeight + 2F;
                float stageHeight = Math.Max(30F, stageFont.GetHeight(graphics) + 8F);
                graphics.DrawString(_productName, titleFont, titleBrush,
                    new RectangleF(30F, titleY, bounds.Width - 60F, titleHeight), centered);
                graphics.DrawString(BuildStageLine(), stageFont, stageBrush,
                    new RectangleF(30F, stageY, bounds.Width - 60F, stageHeight), centered);
                barY = stageY + stageHeight + 20F;
            }
        }

        float barWidth = Math.Min(520F, Math.Max(220F, bounds.Width - 100F));
        float barX = centerX - barWidth / 2F;
        using (Brush track = new SolidBrush(Color.FromArgb(45, 226, 243, 252)))
        using (Brush fill = new SolidBrush(_error ? Color.FromArgb(230, 238, 107, 107) : Color.FromArgb(230, 121, 214, 239)))
        {
            graphics.FillRectangle(track, barX, barY, barWidth, 3F);
            graphics.FillRectangle(fill, barX, barY, barWidth * _progress / 100F, 3F);
        }
    }

    private void DrawProgressLoader(Graphics graphics)
    {
        Rectangle bounds = ClientRectangle;
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        using (LinearGradientBrush background = new LinearGradientBrush(bounds,
            Color.FromArgb(7, 11, 24), Color.FromArgb(14, 28, 48), 90F))
        {
            graphics.FillRectangle(background, bounds);
        }

        float cardWidth = Math.Min(720F, Math.Max(420F, bounds.Width - 80F));
        float cardHeight = 270F;
        RectangleF card = new RectangleF(
            bounds.Width / 2F - cardWidth / 2F,
            bounds.Height / 2F - cardHeight / 2F,
            cardWidth,
            cardHeight);
        using (GraphicsPath cardPath = RoundedRectangle(card, 18F))
        using (Brush shadow = new SolidBrush(Color.FromArgb(72, 0, 0, 0)))
        using (Brush surface = new SolidBrush(Color.FromArgb(242, 16, 25, 42)))
        using (Pen border = new Pen(Color.FromArgb(70, 117, 169, 218)))
        {
            RectangleF shadowRect = card;
            shadowRect.Offset(0F, 10F);
            using (GraphicsPath shadowPath = RoundedRectangle(shadowRect, 18F)) graphics.FillPath(shadow, shadowPath);
            graphics.FillPath(surface, cardPath);
            graphics.DrawPath(border, cardPath);
        }

        float left = card.Left + 38F;
        float top = card.Top + 30F;
        using (Font monoSmall = new Font("Consolas", 9F, FontStyle.Regular))
        using (Font monoLarge = new Font("Consolas", 15F, FontStyle.Bold))
        using (Brush muted = new SolidBrush(Color.FromArgb(132, 157, 184)))
        using (Brush primary = new SolidBrush(Color.FromArgb(223, 235, 248)))
        using (Brush accent = new SolidBrush(_error ? Color.FromArgb(255, 138, 138) : Color.FromArgb(98, 213, 190)))
        {
            graphics.DrawString("DSH / EMBEDDED WEB RUNTIME", monoSmall, muted, left, top);
            graphics.DrawString("BOOT SEQUENCE", monoLarge, primary, left, top + 30F);
            graphics.DrawString(BuildStageLine(), monoSmall, accent,
                new RectangleF(left, top + 86F, cardWidth - 76F, 24F));

            const int segments = 28;
            float gap = 5F;
            float segmentWidth = (cardWidth - 76F - gap * (segments - 1)) / segments;
            int active = (int)Math.Round(segments * _progress / 100F);
            for (int i = 0; i < segments; i++)
            {
                Color color = i < active
                    ? (_error ? Color.FromArgb(228, 230, 94, 94) : Color.FromArgb(228, 74, 203, 179))
                    : Color.FromArgb(55, 124, 145, 169);
                using (Brush segment = new SolidBrush(color))
                {
                    graphics.FillRectangle(segment, left + i * (segmentWidth + gap), top + 126F, segmentWidth, 12F);
                }
            }

            graphics.DrawString(((int)_progress).ToString("00") + "%", monoSmall, primary,
                new RectangleF(left, top + 153F, cardWidth - 76F, 20F));
            graphics.DrawString("Local service  •  WebView2  •  Web interface", monoSmall, muted,
                new RectangleF(left, top + 190F, cardWidth - 76F, 24F));
        }
    }

    private string BuildStageLine()
    {
        int step = Math.Max(1, Math.Min(5, (int)Math.Ceiling(_progress / 20F)));
        return "[BOOT " + step.ToString("00") + "/05] " + _stage;
    }

    private static void DrawWhale(Graphics graphics, PointF center, float rotation, float scale, Color color)
    {
        GraphicsState state = graphics.Save();
        graphics.TranslateTransform(center.X, center.Y);
        graphics.RotateTransform(rotation);
        graphics.ScaleTransform(scale, scale);

        using (GraphicsPath body = new GraphicsPath())
        {
            body.StartFigure();
            body.AddBezier(53F, 0F, 45F, -17F, 22F, -23F, -8F, -16F);
            body.AddBezier(-8F, -16F, -29F, -12F, -47F, -4F, -54F, -1F);
            body.AddBezier(-54F, -1F, -54F, 1F, -47F, 4F, -8F, 16F);
            body.AddBezier(-8F, 16F, 22F, 23F, 45F, 17F, 53F, 0F);
            body.CloseFigure();

            using (Brush bodyBrush = new SolidBrush(color)) graphics.FillPath(bodyBrush, body);
        }

        using (GraphicsPath fins = new GraphicsPath())
        {
            fins.AddBezier(13F, -11F, 4F, -29F, -8F, -39F, -1F, -11F);
            fins.CloseFigure();
            fins.StartFigure();
            fins.AddBezier(13F, 11F, 4F, 29F, -8F, 39F, -1F, 11F);
            fins.CloseFigure();
            using (Brush finBrush = new SolidBrush(Color.FromArgb(Math.Max(0, color.A - 26), color.R, color.G, color.B)))
            {
                graphics.FillPath(finBrush, fins);
            }
        }

        using (GraphicsPath tail = new GraphicsPath())
        {
            tail.StartFigure();
            tail.AddBezier(-44F, -2F, -62F, -10F, -72F, -25F, -65F, -2F);
            tail.AddBezier(-65F, -2F, -62F, 0F, -62F, 0F, -65F, 2F);
            tail.AddBezier(-65F, 2F, -72F, 25F, -62F, 10F, -44F, 2F);
            tail.AddBezier(-44F, 2F, -46F, 1F, -46F, -1F, -44F, -2F);
            tail.CloseFigure();
            using (Brush tailBrush = new SolidBrush(color)) graphics.FillPath(tailBrush, tail);
        }

        using (Pen highlight = new Pen(Color.FromArgb(76, 255, 255, 255), 1.2F))
        {
            graphics.DrawBezier(highlight, 34F, 0F, 15F, -3F, -10F, -2F, -38F, 0F);
        }
        graphics.Restore(state);
    }

    private static GraphicsPath RoundedRectangle(RectangleF rectangle, float radius)
    {
        float diameter = radius * 2F;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180F, 90F);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270F, 90F);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0F, 90F);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90F, 90F);
        path.CloseFigure();
        return path;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}

internal sealed class RestartOverlay : Control
{
    private readonly string _message;
    private readonly System.Windows.Forms.Timer _timer;
    private float _angle;

    public RestartOverlay(string message)
    {
        _message = string.IsNullOrEmpty(message) ? "Restarting" : message;
        Dock = DockStyle.Fill;
        BackColor = Color.FromArgb(249, 250, 252);
        Visible = false;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        _timer = new System.Windows.Forms.Timer();
        _timer.Interval = 16;
        _timer.Tick += delegate
        {
            _angle += 7F;
            if (_angle >= 360F) _angle -= 360F;
            Invalidate();
        };
    }

    public void ShowRestarting()
    {
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)ShowRestarting);
            return;
        }
        _angle = 0F;
        Visible = true;
        BringToFront();
        if (!_timer.Enabled) _timer.Start();
        Invalidate();
    }

    public void HideRestarting()
    {
        if (InvokeRequired)
        {
            BeginInvoke((MethodInvoker)HideRestarting);
            return;
        }
        _timer.Stop();
        Visible = false;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        Rectangle bounds = ClientRectangle;
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(BackColor);

        float centerX = bounds.Width / 2F;
        float centerY = bounds.Height / 2F - 18F;
        RectangleF ring = new RectangleF(centerX - 14F, centerY - 14F, 28F, 28F);
        using (Pen track = new Pen(Color.FromArgb(32, 60, 72, 92), 3F))
        using (Pen accent = new Pen(Color.FromArgb(57, 100, 254), 3F))
        {
            track.StartCap = LineCap.Round;
            track.EndCap = LineCap.Round;
            accent.StartCap = LineCap.Round;
            accent.EndCap = LineCap.Round;
            e.Graphics.DrawArc(track, ring, 0F, 360F);
            e.Graphics.DrawArc(accent, ring, _angle, 92F);
        }

        using (Font font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular))
        using (Brush brush = new SolidBrush(Color.FromArgb(83, 89, 101)))
        using (StringFormat centered = new StringFormat())
        {
            centered.Alignment = StringAlignment.Center;
            centered.LineAlignment = StringAlignment.Center;
            e.Graphics.DrawString(_message, font, brush,
                new RectangleF(20F, centerY + 32F, bounds.Width - 40F, 28F), centered);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}

internal sealed class MainForm : Form
{
    private sealed class DshmkCatalogSnapshot
    {
        public Dictionary<string, object> Catalog;
        public string Mode;
        public string Path;
        public DateTime GeneratedAtUtc;
        public int RepositoryCount;
        public int InstallableCount;
    }

    private sealed class ManualDownloadSession
    {
        public string Id;
        public string SetupRequestId;
        public string FileName;
        public string Kind;
        public string DownloadUrl;
        public string RepositoryUrl;
        public string ExpectedSha256;
        public long ExpectedBytes;
        public bool HubProgress;
        public CancellationTokenSource OnlineCancellation;
        public TaskCompletionSource<CommunityArtifactInfo> Imported;
    }

    private const int MaxWebMessageCharacters = 4 * 1024 * 1024;
    private const int MaxCommunityRegistryCharacters = 8 * 1024 * 1024;
    private const int MaxDshmkCatalogCharacters = 16 * 1024 * 1024;
    private const long MaxCommunityArtifactBytes = 256L * 1024L * 1024L;
    private const string CommunityRegistryUrl = "https://awesome-dsh-plugin.com/plugins.json";
    private const string DshmkCatalogUrl = "https://dshmk.com/catalog.json";
    private const string DshmkCatalogRawUrl = "https://raw.githubusercontent.com/ZASENJC/dsh-plugins-store/main/src/data/catalog.json";
    private const int MaxWebUiRetries = 1;
    private const int MaxWebUiServiceRecoveries = 1;
    private const int WebUiStatusIdleTimeoutMilliseconds = 45000;
    private const int WebUiRetryStatusIdleTimeoutMilliseconds = 30000;
    private const int WebUiStatusHardTimeoutMilliseconds = 120000;
    private const int WebUiRetryStatusHardTimeoutMilliseconds = 60000;
    private const int ShowWindowRestore = 9;
    private const int ExtendedWindowStyle = -20;
    private const int WindowOwner = -8;
    private const long AppWindowStyle = 0x00040000L;
    private const long ToolWindowStyle = 0x00000080L;
    private const long TopMostWindowStyle = 0x00000008L;
    private const uint SetWindowPositionNoMove = 0x0002;
    private const uint SetWindowPositionNoSize = 0x0001;
    private const uint SetWindowPositionNoZOrder = 0x0004;
    private const uint SetWindowPositionFrameChanged = 0x0020;
    private const uint SetWindowPositionShowWindow = 0x0040;
    private static readonly IntPtr WindowTopMost = new IntPtr(-1);
    private static readonly IntPtr WindowNoTopMost = new IntPtr(-2);
    private const string SetupProgressPrefix = "DSH_SETUP_PROGRESS ";
    private const string DesktopMarketCompatibilityCss =
        "[data-dsh-desktop-market='true'] [class$='_irow']{flex-wrap:wrap!important;align-items:center!important;justify-content:flex-end!important;gap:10px 12px!important;}"
        + "[data-dsh-desktop-market='true'] [class$='_irow']>div:first-child{flex:1 0 100%!important;width:100%!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;}"
        + "[data-dsh-desktop-market='true'] [class$='_irow']>[class$='_grow']{display:none!important;}"
        + "[data-dsh-desktop-market='true'] [class$='_irow'] [class$='_spec']{display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}"
        + "[data-dsh-desktop-market='true'] [class$='_irow']>[class$='_src'],[data-dsh-desktop-market='true'] [class$='_irow']>button,[data-dsh-desktop-market='true'] [class$='_irow']>span{flex:0 0 auto!important;align-self:center!important;}"
        + "@media(max-width:720px){[data-dsh-desktop-market='true'] [class$='_irow']{justify-content:flex-start!important;}[data-dsh-desktop-market='true'] [class$='_irow']>[class$='_src']{margin-left:0!important;}}";
    private const string DesktopMarketCompatibilityMarkerScript =
        "(function(){var mark=function(){var titles=document.querySelectorAll('h1,h2,h3');for(var i=0;i<titles.length;i++){var text=(titles[i].textContent||'').trim();if(text!=='插件市场'&&text!=='Plugin Market')continue;var root=titles[i].parentElement;while(root){var name=typeof root.className==='string'?root.className:'';if(/(^|\\s)\\S+_root(\\s|$)/.test(name)){root.setAttribute('data-dsh-desktop-market','true');break;}root=root.parentElement;}}};var start=function(){mark();new MutationObserver(mark).observe(document.documentElement,{childList:true,subtree:true});};if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});})();";

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint sourceThreadId, uint targetThreadId, bool attach);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int valueSize);

    private AppConfig _cfg;
    private Panel _toolPanel;
    private Panel _logPanel;
    private TextBox _logBox;
    private WebView2 _webView;
    private Label _toolbarTitle;
    private Label _statusText;
    private Button _startButton;
    private Button _stopButton;
    private Button _refreshButton;
    private Button _openBrowserButton;
    private Button _configButton;
    private Button _logButton;
    private Button _exitButton;
    private Button _trayButton;
    private System.Windows.Forms.Timer _revealTimer;
    private LoadingOverlay _loadingOverlay;
    private RestartOverlay _restartOverlay;
    private NotifyIcon _trayIcon;
    private ProcessJob _serverJob;
    private ProcessJob _setupJob;

    private Process _proc;
    private Process _setupProcess;
    private FileStream _serviceStartGate;
    private bool _shuttingDown;
    private bool _exitRequested;
    private bool _coreReady;
    private volatile bool _serviceReady;
    private bool _fullscreen;
    private bool _toolbarSticky;
    private bool _forceToolbarVisible;
    private bool _toolbarTargetVisible;
    private bool _layingOutToolbar;
    private bool _runtimeErrorShown;
    private bool _webViewInitializing;
    private bool _webUiVerified;
    private bool _webUiBootTerminal;
    private bool _restartInProgress;
    private readonly bool _hubMode;
    private readonly HubConfig _hubConfig;
    private readonly string _loadingStyle;
    private readonly string _closeAction;
    private readonly bool _showTrayButton;
    private readonly EventWaitHandle _activationEvent;
    private readonly EventWaitHandle _silentActivationEvent;
    private readonly EventWaitHandle _reloadActivationEvent;
    private RegisteredWaitHandle _activationRegistration;
    private RegisteredWaitHandle _silentActivationRegistration;
    private RegisteredWaitHandle _reloadActivationRegistration;
    private bool _trayHidePending;
    private bool _setupInstallRunning;
    private volatile bool _setupCancellationRequested;
    private readonly object _manualDownloadSync = new object();
    private ManualDownloadSession _activeManualDownload;
    private Dictionary<string, object> _dshmkCatalogCache;
    private DateTime _dshmkCatalogCacheUntilUtc;
    private bool _dshmkCatalogRefreshRunning;
    private string _dshmkCatalogSourceMode;
    private string _dshmkCatalogSourceUrl;
    private Dictionary<string, object> _communityRegistryCache;
    private DateTime _communityRegistryCacheUntilUtc;
    private bool _serviceStartWaiting;
    private int _activePort;
    private int _webUiRetryCount;
    private int _webUiServiceRecoveryCount;
    private bool _preserveWebUiServiceRecoveryCount;
    private DateTime _webUiBootStartedUtc;
    private DateTime _webUiBootLastActivityUtc;
    private string _webUiBootStage;
    private string _activeUrl;
    private string _navigationUrl;
    private string _desktopBootId;
    private ulong _activeNavigationId;
    private int _toolbarTargetTop;
    private int _toolbarHideTicks;
    private Keys _toolbarKey;
    private Keys _toolbarMods;
    private Keys _fullscreenKey;
    private Keys _fullscreenMods;

    public MainForm()
        : this(AppConfig.Load(), HubConfig.Load(), false, null, null, null)
    {
    }

    public MainForm(AppConfig config)
        : this(config, HubConfig.Load(), false, null, null, null)
    {
    }

    public MainForm(AppConfig config, bool hubMode)
        : this(config, HubConfig.Load(), hubMode, null, null, null)
    {
    }

    public MainForm(AppConfig config, bool hubMode, bool headlessDataMode)
        : this(config, HubConfig.Load(), hubMode, null, null, null, headlessDataMode)
    {
    }

    public MainForm(AppConfig config, HubConfig hubConfig, bool hubMode, EventWaitHandle activationEvent,
        EventWaitHandle silentActivationEvent, EventWaitHandle reloadActivationEvent)
        : this(config, hubConfig, hubMode, activationEvent, silentActivationEvent, reloadActivationEvent, false)
    {
    }

    private MainForm(AppConfig config, HubConfig hubConfig, bool hubMode, EventWaitHandle activationEvent,
        EventWaitHandle silentActivationEvent, EventWaitHandle reloadActivationEvent, bool headlessDataMode)
    {
        _cfg = config ?? AppConfig.Load();
        _hubConfig = hubConfig ?? HubConfig.Load();
        _hubMode = hubMode;
        _loadingStyle = _hubMode ? _hubConfig.LoadingStyle : _cfg.LoadingStyle;
        _closeAction = _hubMode ? _hubConfig.CloseAction : _cfg.CloseAction;
        _showTrayButton = _hubMode ? _hubConfig.ShowTrayButton : _cfg.ShowTrayButton;
        _activationEvent = activationEvent;
        _silentActivationEvent = silentActivationEvent;
        _reloadActivationEvent = reloadActivationEvent;
        _activePort = _cfg.Port;
        _activeUrl = _cfg.Url;
        _navigationUrl = BuildNavigationUrl(_activeUrl, _hubMode, _hubConfig, out _desktopBootId);
        if (!TryParseHotkey(_cfg.ToolbarHotkey, out _toolbarKey, out _toolbarMods)) { _toolbarKey = Keys.F8; _toolbarMods = Keys.None; }
        if (!TryParseHotkey(_cfg.FullscreenHotkey, out _fullscreenKey, out _fullscreenMods)) { _fullscreenKey = Keys.F11; _fullscreenMods = Keys.None; }
        if (headlessDataMode) return;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { Icon = SystemIcons.Application; }
        ApplyLaunchMode(_hubMode ? "window" : _cfg.LaunchMode);
        BuildUi();
        try
        {
            _serverJob = new ProcessJob();
            AppendLog("Launcher process job state: " + (ProcessJob.IsCurrentProcessInJob() ? "inherited external job" : "standalone"));
        }
        catch (Exception ex)
        {
            AppendLog("Process containment unavailable: " + ex.Message);
        }
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        Keys modifiers = keyData & Keys.Modifiers;
        if (key == _toolbarKey && modifiers == _toolbarMods)
        {
            ToggleToolbarSticky();
            return true;
        }
        if (key == _fullscreenKey && modifiers == _fullscreenMods)
        {
            ToggleFullscreen();
            return true;
        }
        if (key == Keys.Escape && modifiers == Keys.None && _fullscreen)
        {
            _fullscreen = false;
            ApplyLaunchMode("window");
            return true;
        }
        return base.ProcessCmdKey(ref message, keyData);
    }

    private void BuildUi()
    {
        Text = ProductDisplayName;
        AutoScaleMode = AutoScaleMode.None;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft YaHei UI", 9F);
        DoubleBuffered = true;
        Opacity = 0D;

        _webView = new WebView2();
        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = Color.White;
        _webView.CreationProperties = new CoreWebView2CreationProperties();
        _webView.CreationProperties.UserDataFolder = AppPaths.WebView2Dir;
        _webView.Visible = _loadingStyle == "off";
        Controls.Add(_webView);

        _logPanel = new Panel();
        _logPanel.Dock = DockStyle.Top;
        _logPanel.Height = 160;
        _logPanel.Visible = false;
        Controls.Add(_logPanel);

        _logBox = new TextBox();
        _logBox.Multiline = true;
        _logBox.ReadOnly = true;
        _logBox.ScrollBars = ScrollBars.Vertical;
        _logBox.Dock = DockStyle.Fill;
        _logBox.BackColor = Color.FromArgb(24, 27, 36);
        _logBox.ForeColor = Color.FromArgb(200, 205, 220);
        _logBox.Font = new Font("Consolas", 9F);
        _logPanel.Controls.Add(_logBox);

        _toolPanel = new Panel();
        _toolPanel.Dock = DockStyle.None;
        _toolPanel.Height = 60;
        _toolPanel.Location = new Point(0, 0);
        _toolPanel.Width = ClientSize.Width;
        _toolPanel.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        _toolPanel.BackColor = Color.FromArgb(250, 251, 254);
        Controls.Add(_toolPanel);

        _toolbarTitle = new Label();
        _toolbarTitle.Text = ProductDisplayName;
        _toolbarTitle.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
        _toolbarTitle.AutoSize = false;
        _toolbarTitle.TextAlign = ContentAlignment.MiddleLeft;
        _toolbarTitle.ForeColor = Color.FromArgb(30, 41, 99);
        _toolPanel.Controls.Add(_toolbarTitle);

        _statusText = new Label();
        _statusText.Text = "Not started";
        _statusText.AutoSize = false;
        _statusText.AutoEllipsis = true;
        _statusText.TextAlign = ContentAlignment.MiddleLeft;
        _statusText.ForeColor = Color.FromArgb(120, 120, 120);
        _toolPanel.Controls.Add(_statusText);

        int x = 0;
        _startButton = MakeToolButton("Start", ref x);
        _stopButton = MakeToolButton("Stop", ref x);
        _refreshButton = MakeToolButton("Reload", ref x);
        _openBrowserButton = MakeToolButton("In browser", ref x);
        _configButton = MakeToolButton("Config", ref x);
        _logButton = MakeToolButton("Log", ref x);
        _exitButton = MakeToolButton("Exit", ref x);
        _startButton.Click += delegate { BeginServerStart(); };
        _stopButton.Click += delegate { StopServer(); };
        _refreshButton.Click += delegate { RefreshPage(); };
        _openBrowserButton.Click += delegate { OpenInBrowser(); };
        _configButton.Click += delegate { OpenConfigApp(); };
        _logButton.Click += delegate { ToggleLog(); };
        _exitButton.Click += delegate { ExitApplication(); };

        if (_showTrayButton && _closeAction == "exit")
        {
            _trayButton = new Button();
            _trayButton.Text = "To tray";
            _trayButton.Size = new Size(126, 42);
            _trayButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _trayButton.FlatStyle = FlatStyle.Flat;
            _trayButton.FlatAppearance.BorderColor = Color.FromArgb(160, 177, 207);
            _trayButton.UseVisualStyleBackColor = true;
            _trayButton.Click += delegate { MinimizeToTray(); };
            _toolPanel.Controls.Add(_trayButton);
        }
        _toolPanel.Resize += delegate { PositionTrayButton(); };
        Resize += delegate { PositionTrayButton(); };

        _toolbarSticky = !_cfg.ToolbarAutoHide;
        _toolbarTargetVisible = _toolbarSticky;
        PositionTrayButton();
        RequestToolbar(_forceToolbarVisible || _toolbarSticky, true);

        SetupTrayIcon();

        _loadingOverlay = new LoadingOverlay(_loadingStyle, ProductDisplayName);
        _loadingOverlay.Dismissed += delegate { RevealInterface(); };
        Controls.Add(_loadingOverlay);
        if (_loadingOverlay.Visible) _loadingOverlay.BringToFront();

        _restartOverlay = new RestartOverlay(_cfg.Language == "zh-CN" ? "重启中" : "Restarting");
        Controls.Add(_restartOverlay);

        _revealTimer = new System.Windows.Forms.Timer();
        _revealTimer.Interval = 16;
        _revealTimer.Tick += delegate
        {
            UpdateToolbarReveal();
            AnimateToolbar();
        };
        _revealTimer.Start();

        FormClosing += delegate(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && !_exitRequested && _closeAction == "tray")
            {
                e.Cancel = true;
                MinimizeToTray();
                return;
            }
            _exitRequested = true;
            _serviceStartWaiting = false;
            ReleaseServiceStartGate();
            StopSetupInstaller();
            StopServer();
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIcon = null;
            }
        };
        FormClosed += delegate
        {
            if (_activationRegistration != null)
            {
                _activationRegistration.Unregister(null);
                _activationRegistration = null;
            }
            if (_silentActivationRegistration != null)
            {
                _silentActivationRegistration.Unregister(null);
                _silentActivationRegistration = null;
            }
            if (_reloadActivationRegistration != null)
            {
                _reloadActivationRegistration.Unregister(null);
                _reloadActivationRegistration = null;
            }
            if (_serverJob != null)
            {
                _serverJob.Dispose();
                _serverJob = null;
            }
        };
        Load += delegate
        {
            ApplyNativeTitleBarTheme();
            EnsureTaskbarPresence();
        };
        Shown += delegate
        {
            EnsureTaskbarPresence();
            BeginInvoke((MethodInvoker)delegate
            {
                if (IsDisposed || Disposing) return;
                Refresh();
                if (_loadingOverlay != null)
                {
                    _loadingOverlay.Refresh();
                    _loadingOverlay.Update();
                }
                Update();
                BeginInvoke((MethodInvoker)delegate
                {
                    if (IsDisposed || Disposing) return;
                    Opacity = 1D;
                    AppendLog("Initial window frame revealed");
                    EnsureTaskbarPresence();
                    RegisterActivationSignals();
                    PositionTrayButton();
                    SetLoadingStage("Preparing runtime", 12F);
                    BeginInvoke((MethodInvoker)BeginServerStart);
                    BeginInvoke((MethodInvoker)delegate { InitWebView(); });
                    BeginInvoke((MethodInvoker)ForceForegroundWindow);
                });
            });
        };
        SetButtons();
    }

    private Button MakeToolButton(string text, ref int x)
    {
        Button b = new Button();
        b.Text = text;
        b.Location = new Point(x, 9);
        int width = Math.Max(72, Math.Min(132, TextRenderer.MeasureText(text, Font).Width + 42));
        b.Size = new Size(width, 42);
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = Color.FromArgb(180, 190, 215);
        b.UseVisualStyleBackColor = true;
        _toolPanel.Controls.Add(b);
        x += width + 8;
        return b;
    }

    private void SetupTrayIcon()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        bool chinese = _cfg.Language == "zh-CN";
        ToolStripMenuItem showItem = new ToolStripMenuItem((chinese ? "显示 " : "Show ") + ProductDisplayName);
        ToolStripMenuItem companionItem = new ToolStripMenuItem((chinese ? "打开 " : "Open ") + CompanionDisplayName);
        ToolStripMenuItem configItem = new ToolStripMenuItem(chinese ? "打开 CONFIG" : "Open CONFIG");
        ToolStripMenuItem exitItem = new ToolStripMenuItem(_cfg.Language == "zh-CN" ? "退出" : "Exit");
        showItem.Click += delegate { RestoreFromTray(); };
        companionItem.Click += delegate { OpenCompanionApp(); };
        configItem.Click += delegate { OpenConfigApp(); };
        exitItem.Click += delegate { ExitApplication(); };
        menu.Items.Add(showItem);
        menu.Items.Add(companionItem);
        menu.Items.Add(configItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exitItem);

        _trayIcon = new NotifyIcon();
        _trayIcon.Icon = Icon == null ? SystemIcons.Application : Icon;
        _trayIcon.Text = ProductDisplayName;
        _trayIcon.ContextMenuStrip = menu;
        _trayIcon.Visible = true;
        _trayIcon.DoubleClick += delegate { RestoreFromTray(); };
    }

    private void PositionTrayButton()
    {
        if (_layingOutToolbar) return;
        _layingOutToolbar = true;
        try
        {
            int previousHeight = _toolPanel.Height;
            _toolPanel.Width = ClientSize.Width;

            const int left = 14;
            const int top = 8;
            const int buttonHeight = 42;
            const int gap = 8;
            int titleWidth = Math.Max(176, TextRenderer.MeasureText(_toolbarTitle.Text, _toolbarTitle.Font).Width + 10);
            _toolbarTitle.SetBounds(left, top, titleWidth, 44);
            _statusText.SetBounds(_toolbarTitle.Right + 12, top, 180, 44);

            Button[] actions = new Button[]
            {
                _startButton, _stopButton, _refreshButton, _openBrowserButton,
                _configButton, _logButton, _exitButton
            };
            int totalWidth = 0;
            foreach (Button action in actions) totalWidth += action.Width + gap;
            if (totalWidth > 0) totalWidth -= gap;

            int trayReserve = _trayButton == null ? 0 : _trayButton.Width + 18;
            int oneRowRight = Math.Max(280, _toolPanel.ClientSize.Width - trayReserve - 12);
            int actionsStart = _statusText.Right + 14;
            int x;
            int y;
            int neededHeight;
            if (actionsStart + totalWidth <= oneRowRight)
            {
                x = actionsStart;
                y = 9;
                foreach (Button action in actions)
                {
                    action.Location = new Point(x, y);
                    action.Height = buttonHeight;
                    x += action.Width + gap;
                }
                neededHeight = 60;
            }
            else
            {
                x = left;
                y = 60;
                int right = Math.Max(120, _toolPanel.ClientSize.Width - 14);
                foreach (Button action in actions)
                {
                    if (x > left && x + action.Width > right)
                    {
                        x = left;
                        y += buttonHeight + gap;
                    }
                    action.Location = new Point(x, y);
                    action.Height = buttonHeight;
                    x += action.Width + gap;
                }
                neededHeight = y + buttonHeight + 10;
            }

            if (_toolPanel.Height != neededHeight) _toolPanel.Height = neededHeight;

            if (_trayButton != null)
            {
                _trayButton.Location = new Point(Math.Max(8, _toolPanel.ClientSize.Width - _trayButton.Width - 10), 9);
            }

            _toolbarTargetTop = _toolbarTargetVisible ? 0 : -_toolPanel.Height;
            bool wasFullyHidden = previousHeight > 0 && _toolPanel.Top <= -previousHeight + 1;
            if (!_toolbarTargetVisible && wasFullyHidden) _toolPanel.Top = -_toolPanel.Height;
        }
        finally
        {
            _layingOutToolbar = false;
        }
    }

    private void MinimizeToTray()
    {
        if (_trayIcon != null) _trayIcon.Visible = true;
        if (!_coreReady && !_exitRequested)
        {
            _trayHidePending = true;
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            return;
        }
        _trayHidePending = false;
        ShowInTaskbar = false;
        Hide();
    }

    private void RestoreFromTray()
    {
        if (_exitRequested || IsDisposed) return;
        _trayHidePending = false;
        EnsureTaskbarPresence();
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        EnsureTaskbarPresence();
        ForceForegroundWindow();
        if (!_coreReady && !_webViewInitializing)
        {
            BeginInvoke((MethodInvoker)InitWebView);
        }
    }

    private void RegisterActivationSignals()
    {
        if (_activationRegistration == null)
            _activationRegistration = RegisterActivationSignal(_activationEvent, true);
        if (_silentActivationRegistration == null)
            _silentActivationRegistration = RegisterActivationSignal(_silentActivationEvent, false);
        if (_reloadActivationRegistration == null)
            _reloadActivationRegistration = RegisterReloadActivationSignal(_reloadActivationEvent);
    }

    private RegisteredWaitHandle RegisterActivationSignal(EventWaitHandle activationEvent, bool showNotice)
    {
        if (activationEvent == null) return null;
        return ThreadPool.RegisterWaitForSingleObject(
            activationEvent,
            delegate
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        RestoreFromTray();
                        if (!showNotice) return;
                        string message = _cfg.Language == "zh-CN"
                            ? ProductDisplayName + " 已经在运行，现有窗口已被唤醒。"
                            : ProductDisplayName + " is already running. Its existing window has been restored.";
                        MessageBox.Show(this, message, ProductDisplayName,
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                    });
                }
                catch
                {
                }
            },
            null, Timeout.Infinite, false);
    }

    private RegisteredWaitHandle RegisterReloadActivationSignal(EventWaitHandle activationEvent)
    {
        if (activationEvent == null) return null;
        return ThreadPool.RegisterWaitForSingleObject(
            activationEvent,
            delegate
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        RestoreFromTray();
                        RestartDesktopServiceAfterSetup();
                    });
                }
                catch
                {
                }
            },
            null, Timeout.Infinite, false);
    }

    private void ForceForegroundWindow()
    {
        if (_exitRequested || IsDisposed || !IsHandleCreated) return;
        Show();
        EnsureTaskbarPresence();
        RaiseWindowToForeground(Handle);
        Activate();
        BringToFront();
    }

    private static void RaiseWindowToForeground(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        IntPtr foregroundWindow = GetForegroundWindow();
        uint ignoredProcessId;
        uint foregroundThreadId = foregroundWindow == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foregroundWindow, out ignoredProcessId);
        uint targetThreadId = GetWindowThreadProcessId(window, out ignoredProcessId);
        uint currentThreadId = GetCurrentThreadId();
        bool attachedForeground = foregroundThreadId != 0 && foregroundThreadId != currentThreadId
            && AttachThreadInput(currentThreadId, foregroundThreadId, true);
        bool attachedTarget = targetThreadId != 0 && targetThreadId != currentThreadId && targetThreadId != foregroundThreadId
            && AttachThreadInput(currentThreadId, targetThreadId, true);
        try
        {
            bool wasTopMost = (GetWindowLongPtr(window, ExtendedWindowStyle).ToInt64() & TopMostWindowStyle) != 0;
            uint flags = SetWindowPositionNoMove | SetWindowPositionNoSize | SetWindowPositionShowWindow;
            ShowWindowAsync(window, ShowWindowRestore);
            SetWindowPos(window, WindowTopMost, 0, 0, 0, 0, flags);
            BringWindowToTop(window);
            SetForegroundWindow(window);
            if (!wasTopMost) SetWindowPos(window, WindowNoTopMost, 0, 0, 0, 0, flags);
        }
        finally
        {
            if (attachedTarget) AttachThreadInput(currentThreadId, targetThreadId, false);
            if (attachedForeground) AttachThreadInput(currentThreadId, foregroundThreadId, false);
        }
    }

    private void EnsureTaskbarPresence()
    {
        if (_exitRequested || IsDisposed) return;
        ShowInTaskbar = true;
        if (!IsHandleCreated) return;
        if (_hubMode) SetWindowLongPtr(Handle, WindowOwner, IntPtr.Zero);
        long current = GetWindowLongPtr(Handle, ExtendedWindowStyle).ToInt64();
        long desired = (current | AppWindowStyle) & ~ToolWindowStyle;
        if (desired != current) SetWindowLongPtr(Handle, ExtendedWindowStyle, new IntPtr(desired));
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0,
            SetWindowPositionNoMove | SetWindowPositionNoSize | SetWindowPositionNoZOrder | SetWindowPositionFrameChanged);
    }

    private void ApplyNativeTitleBarTheme()
    {
        if (!_hubMode || !IsHandleCreated) return;
        int dark = _hubConfig.Theme == "dark" ? 1 : 0;
        try
        {
            if (DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)) != 0)
                DwmSetWindowAttribute(Handle, 19, ref dark, sizeof(int));
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    private void CompletePendingTrayHide()
    {
        if (!_trayHidePending || _exitRequested || IsDisposed) return;
        _trayHidePending = false;
        ShowInTaskbar = false;
        Hide();
    }

    private void ExitApplication()
    {
        _exitRequested = true;
        Close();
    }

    private void RevealInterface()
    {
        if (_webView == null || _webView.IsDisposed) return;
        _webView.Visible = true;
        if (_logPanel.Visible) _logPanel.BringToFront();
        if (_toolbarTargetVisible || _toolPanel.Top > -_toolPanel.Height) _toolPanel.BringToFront();
    }

    private void SetLoadingStage(string stage, float progress)
    {
        if (_loadingOverlay != null) _loadingOverlay.SetStage(stage, progress);
    }

    private void UpdateToolbarReveal()
    {
        if (_toolbarSticky || _forceToolbarVisible)
        {
            _toolbarHideTicks = 0;
            RequestToolbar(true, false);
            return;
        }

        if (!_cfg.ToolbarEdgeReveal)
        {
            _toolbarHideTicks = 0;
            RequestToolbar(false, false);
            return;
        }

        try
        {
            Point p = PointToClient(Cursor.Position);
            bool insideWidth = p.X >= 0 && p.X < ClientSize.Width;
            bool edgeHit = insideWidth && p.Y >= 0 && p.Y <= 10;
            bool revealCorridor = insideWidth && _toolbarTargetVisible &&
                p.Y >= 0 && p.Y <= _toolPanel.Height + 18;
            if (edgeHit || revealCorridor)
            {
                _toolbarHideTicks = 0;
                RequestToolbar(true, false);
            }
            else if (_toolbarTargetVisible)
            {
                _toolbarHideTicks++;
                if (_toolbarHideTicks >= 18) RequestToolbar(false, false);
            }
        }
        catch
        {
        }
    }

    private void RequestToolbar(bool visible, bool immediate)
    {
        _toolbarTargetVisible = visible;
        _toolbarTargetTop = visible ? 0 : -_toolPanel.Height;
        if (visible) _toolPanel.BringToFront();
        if (immediate) _toolPanel.Top = _toolbarTargetTop;
    }

    private void AnimateToolbar()
    {
        if (_toolPanel.Top == _toolbarTargetTop) return;
        int distance = _toolbarTargetTop - _toolPanel.Top;
        int step = Math.Max(2, (int)Math.Ceiling(Math.Abs(distance) * 0.28));
        if (Math.Abs(distance) <= step)
        {
            _toolPanel.Top = _toolbarTargetTop;
            return;
        }
        _toolPanel.Top += Math.Sign(distance) * step;
        if (_toolbarTargetVisible) _toolPanel.BringToFront();
    }

    private void ToggleToolbarSticky()
    {
        _toolbarSticky = !_toolbarSticky;
        _toolbarHideTicks = 0;
        RequestToolbar(_toolbarSticky || _forceToolbarVisible, false);
        if (_toolbarSticky) AppendLog("Toolbar pinned (hotkey toggles)");
    }
    private void ApplyLaunchMode(string mode)
    {
        Screen scr = Screen.FromControl(this);
        _fullscreen = (mode == "bordered" || mode == "borderless" || mode == "exclusive");
        _forceToolbarVisible = _fullscreen && _cfg.FullscreenShowToolbar;
        if (mode == "bordered")
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            TopMost = !_cfg.FullscreenShowTaskbar;
            WindowState = FormWindowState.Normal;
            StartPosition = FormStartPosition.Manual;
            Bounds = _cfg.FullscreenShowTaskbar ? scr.WorkingArea : scr.Bounds;
            if (_cfg.FullscreenShowTaskbar) WindowState = FormWindowState.Maximized;
        }
        else if (mode == "borderless")
        {
            FormBorderStyle = FormBorderStyle.None;
            TopMost = false;
            WindowState = FormWindowState.Normal;
            StartPosition = FormStartPosition.Manual;
            Bounds = _cfg.FullscreenShowTaskbar ? scr.WorkingArea : scr.Bounds;
        }
        else if (mode == "exclusive")
        {
            FormBorderStyle = FormBorderStyle.None;
            TopMost = !_cfg.FullscreenShowTaskbar;
            WindowState = FormWindowState.Normal;
            Bounds = _cfg.FullscreenShowTaskbar ? scr.WorkingArea : scr.Bounds;
        }
        else
        {
            ApplyWindowMode(scr);
        }
        if (_toolPanel != null)
        {
            _toolbarHideTicks = 0;
            RequestToolbar(_forceToolbarVisible || _toolbarSticky, false);
        }
        AppendLog("Launch mode: " + mode);
    }

    private void ApplyWindowMode(Screen screen)
    {
        FormBorderStyle = FormBorderStyle.Sizable;
        TopMost = false;
        WindowState = FormWindowState.Normal;
        StartPosition = FormStartPosition.Manual;

        Size requested = new Size(Math.Max(_cfg.ResolutionWidth, 400), Math.Max(_cfg.ResolutionHeight, 300));
        Rectangle workArea = screen.WorkingArea;
        Size requestedOuter = SizeFromClientSize(requested);
        int frameWidth = Math.Max(0, requestedOuter.Width - requested.Width);
        int frameHeight = Math.Max(0, requestedOuter.Height - requested.Height);
        const int margin = 24;
        int availableClientWidth = Math.Max(400, workArea.Width - frameWidth - margin * 2);
        int availableClientHeight = Math.Max(300, workArea.Height - frameHeight - margin * 2);

        double scale = Math.Min(1.0, Math.Min(
            availableClientWidth / (double)requested.Width,
            availableClientHeight / (double)requested.Height));
        Size fitted = new Size(
            Math.Max(400, (int)Math.Floor(requested.Width * scale)),
            Math.Max(300, (int)Math.Floor(requested.Height * scale)));

        ClientSize = fitted;
        Location = new Point(
            workArea.Left + Math.Max(0, (workArea.Width - Width) / 2),
            workArea.Top + Math.Max(0, (workArea.Height - Height) / 2));

        AppendLog("Window client size: requested " + requested.Width + "x" + requested.Height +
            ", fitted " + fitted.Width + "x" + fitted.Height);
    }

    private void ToggleFullscreen()
    {
        if (_fullscreen)
        {
            _fullscreen = false;
            ApplyLaunchMode("window");
        }
        else
        {
            string mode = _cfg.LaunchMode;
            if (mode == "window") mode = "borderless";
            _fullscreen = true;
            ApplyLaunchMode(mode);
        }
    }

    private async void InitWebView()
    {
        if (_coreReady || _webViewInitializing || _exitRequested || _shuttingDown || IsDisposed || Disposing) return;
        _webViewInitializing = true;
        SetLoadingStage("Initializing browser engine", 38F);
        try
        {
            EventHandler<CoreWebView2InitializationCompletedEventArgs> initializationHandler = null;
            initializationHandler = delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
            {
                _webView.CoreWebView2InitializationCompleted -= initializationHandler;
                _webViewInitializing = false;
                if (!e.IsSuccess)
                {
                    _coreReady = false;
                    if (_exitRequested || _shuttingDown || IsDisposed || Disposing)
                    {
                        return;
                    }
                    if (IsOperationAborted(e.InitializationException))
                    {
                        AppendLog("WebView2 initialization paused while the window entered the system tray");
                        SetStatus("Interface initialization paused", Color.FromArgb(180, 130, 20));
                        SetButtons();
                        return;
                    }
                    AppendLog("WebView2 init failed: " + (e.InitializationException == null ? "unknown" : e.InitializationException.Message));
                    SetStatus("Interface engine init failed", Color.FromArgb(190, 60, 60));
                    if (_loadingOverlay != null) _loadingOverlay.ShowError("Browser engine initialization failed");
                    ShowRuntimeError();
                    SetButtons();
                    return;
                }
                _coreReady = true;
                SetLoadingStage("Browser engine ready", 58F);
                PrepareWebViewBehindLoadingOverlay();
                _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                _webView.KeyDown += delegate(object s2, KeyEventArgs e2)
                {
                    OnWebKeyDown(e2);
                };
                _webView.CoreWebView2.NewWindowRequested += delegate(object s3, CoreWebView2NewWindowRequestedEventArgs e3)
                {
                    e3.Handled = true;
                    if (_cfg.ExternalLinksInBrowser)
                    {
                        try { Process.Start(e3.Uri); }
                        catch { }
                    }
                    else
                    {
                        _webView.CoreWebView2.Navigate(e3.Uri);
                    }
                };
                _webView.CoreWebView2.ContextMenuRequested += delegate(object s4, CoreWebView2ContextMenuRequestedEventArgs e4)
                {
                    try
                    {
                        if (e4.MenuItems.Count > 0)
                        {
                            e4.MenuItems.Add(_webView.CoreWebView2.Environment.CreateContextMenuItem(
                                "", null, CoreWebView2ContextMenuItemKind.Separator));
                        }
                        bool chinese = _cfg.Language == "zh-CN";
                        CoreWebView2ContextMenuItem configMenuItem = _webView.CoreWebView2.Environment.CreateContextMenuItem(
                            chinese ? "打开 CONFIG" : "Open CONFIG", null, CoreWebView2ContextMenuItemKind.Command);
                        configMenuItem.CustomItemSelected += delegate
                        {
                            try { BeginInvoke((MethodInvoker)OpenConfigApp); }
                            catch { }
                        };
                        e4.MenuItems.Add(configMenuItem);
                        CoreWebView2ContextMenuItem companionMenuItem = _webView.CoreWebView2.Environment.CreateContextMenuItem(
                            chinese ? (_hubMode ? "打开 DSH" : "打开 HUB") : (_hubMode ? "Open DSH" : "Open HUB"),
                            null, CoreWebView2ContextMenuItemKind.Command);
                        companionMenuItem.CustomItemSelected += delegate
                        {
                            try { BeginInvoke((MethodInvoker)OpenCompanionApp); }
                            catch { }
                        };
                        e4.MenuItems.Add(companionMenuItem);
                    }
                    catch (Exception ex)
                    {
                        AppendLog("Add desktop context commands failed: " + ex.Message);
                    }
                };
                _webView.CoreWebView2.NavigationStarting += delegate(object s5, CoreWebView2NavigationStartingEventArgs e5)
                {
                    if (string.Equals(e5.Uri, _navigationUrl, StringComparison.OrdinalIgnoreCase))
                    {
                        _activeNavigationId = e5.NavigationId;
                        _webUiBootStartedUtc = DateTime.UtcNow;
                        _webUiBootLastActivityUtc = _webUiBootStartedUtc;
                        _webUiBootStage = "navigation started";
                    }
                };
                _webView.NavigationCompleted += delegate(object s6, CoreWebView2NavigationCompletedEventArgs e6)
                {
                    if (_activeNavigationId != 0 && e6.NavigationId != _activeNavigationId) return;
                    if (e6.IsSuccess)
                    {
                        if (!_webUiVerified)
                        {
                            SetStatus("Page loaded - waiting for plugin confirmation", Color.FromArgb(180, 130, 20));
                            WaitForWebUiBootStatus(_desktopBootId);
                        }
                        AppendLog("Page loaded: " + _activeUrl);
                    }
                    else
                    {
                        _webUiBootTerminal = true;
                        SetStatus("Page load failed", Color.FromArgb(190, 60, 60));
                        AppendLog("Page load failed: " + e6.WebErrorStatus);
                        if (_loadingOverlay != null) _loadingOverlay.ShowError("Web interface did not respond");
                        CompleteHostedServiceRestart();
                    }
                };
                InjectHooks();
                MaybeNavigate();
                if (_trayHidePending) CompletePendingTrayHide();
                SetButtons();
            };
            _webView.CoreWebView2InitializationCompleted += initializationHandler;
            CoreWebView2Environment env = null;
            string extraArgs = BuildBrowserArgs();
            try
            {
                CoreWebView2EnvironmentOptions opts = new CoreWebView2EnvironmentOptions();
                opts.AdditionalBrowserArguments = extraArgs;
                env = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebView2Dir, opts);
                SetLoadingStage("Preparing embedded browser", 48F);
            }
            catch (Exception ex)
            {
                AppendLog("WebView2 env with options failed: " + ex.Message + " - using defaults");
                env = null;
            }
            if (env == null)
            {
                await _webView.EnsureCoreWebView2Async();
            }
            else
            {
                await _webView.EnsureCoreWebView2Async(env);
            }
        }
        catch (Exception ex)
        {
            _webViewInitializing = false;
            if (_exitRequested || _shuttingDown || IsDisposed || Disposing) return;
            if (IsOperationAborted(ex))
            {
                AppendLog("WebView2 startup paused while the window entered the system tray");
                SetStatus("Interface initialization paused", Color.FromArgb(180, 130, 20));
                return;
            }
            AppendLog("WebView2 start failed: " + ex.Message);
            if (_loadingOverlay != null) _loadingOverlay.ShowError("Embedded browser could not start");
            if (!_coreReady) ShowRuntimeError();
        }
    }

    private static bool IsOperationAborted(Exception exception)
    {
        return exception != null && exception.HResult == unchecked((int)0x80004004);
    }

    private string BuildBrowserArgs()
    {
        StringBuilder sb = new StringBuilder();
        if (_cfg.EnableExtensions && _cfg.Extensions.Count > 0)
        {
            sb.Append("--enable-features=msExtensions ");
            sb.Append("--load-extension=");
            for (int i = 0; i < _cfg.Extensions.Count; i++)
            {
                sb.Append("\"");
                sb.Append(_cfg.Extensions[i]);
                sb.Append("\"");
                if (i < _cfg.Extensions.Count - 1) sb.Append(",");
            }
        }
        return sb.ToString();
    }

    private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string json;
        try
        {
            if (!IsAllowedApplicationMessageSource(e.Source))
            {
                AppendLog("Ignored WebView message from non-application source: " + e.Source);
                return;
            }
            json = e.WebMessageAsJson;
        }
        catch (Exception ex)
        {
            AppendLog("Read WebView message failed: " + ex.Message);
            return;
        }
        if (string.IsNullOrEmpty(json) || json.Length > MaxWebMessageCharacters)
        {
            AppendLog("Ignored oversized or empty WebView message");
            return;
        }

        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaxWebMessageCharacters;
        Dictionary<string, object> envelope;
        try
        {
            envelope = serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (envelope == null) throw new InvalidOperationException("message must be a JSON object");
        }
        catch (Exception ex)
        {
            AppendLog("Rejected malformed WebView message: " + ex.Message);
            return;
        }

        string messageType = GetString(envelope, "type");
        if (messageType == "dsh-web-boot-status")
        {
            HandleWebUiBootStatus(envelope);
            return;
        }
        if (messageType == "dsh-desktop-command")
        {
            HandleDesktopCommand(envelope);
            return;
        }
        if (messageType == "dsh-hub-request")
        {
            await HandleHubRequestAsync(envelope, serializer);
            return;
        }
        if (messageType != "dsh-setup-install") return;

        string requestId;
        Dictionary<string, object> manifest;
        try
        {
            requestId = GetString(envelope, "requestId");
            Guid parsedRequestId;
            if (!Guid.TryParseExact(requestId, "D", out parsedRequestId))
                throw new InvalidOperationException("invalid Setup request id");
            manifest = GetDictionary(envelope, "manifest");
            if (manifest == null) throw new InvalidOperationException("Setup manifest is missing");
        }
        catch (Exception ex)
        {
            AppendLog("Rejected malformed Setup bridge request: " + ex.Message);
            return;
        }

        if (_setupInstallRunning)
        {
            PostSetupResult(requestId, false, "另一个 Setup 正在运行，请等待它完成。\nAnother Setup installation is already running.");
            return;
        }

        string trust = ClassifySetupTrust(manifest);
        string requestedTrust = GetString(envelope, "trust");
        if (!string.Equals(requestedTrust, trust, StringComparison.Ordinal))
        {
            PostSetupResult(requestId, false, "Setup trust evidence changed before installation. Reopen the Setup surface and review it again.");
            return;
        }

        _setupInstallRunning = true;
        _setupCancellationRequested = false;
        SetStatus("Installing Setup...", Color.FromArgb(47, 94, 170));
        try
        {
            PostSetupProgress(requestId, "preflight", 10, "Setup 清单与来源声明已核对。", trust);
            HashSet<string> dependenciesBefore = SnapshotSetupDependencies(manifest);
            string result = await InstallSetupManifestAsync(serializer.Serialize(manifest), trust, requestId, false);
            string recordWarning = "";
            try
            {
                RecordInstalledSetup(manifest, dependenciesBefore, null);
            }
            catch (Exception recordException)
            {
                AppendLog("Setup installed but HUB record update failed: " + recordException.Message);
                recordWarning = _cfg.Language == "zh-CN"
                    ? "\n\n安装已经完成，但 HUB 无法写入安装记录。请查看日志。"
                    : "\n\nInstallation completed, but HUB could not update its install record. Check the log.";
            }
            PostSetupProgress(requestId, "verify", 100, "安装完成并已写入 HUB 安装记录。", ResolveSetupName(manifest));
            PostSetupResult(requestId, true, result + recordWarning);
            SetStatus(string.IsNullOrEmpty(recordWarning) ? "Setup installed" : "Setup installed - record warning", string.IsNullOrEmpty(recordWarning) ? Color.FromArgb(34, 139, 74) : Color.FromArgb(180, 130, 20));
        }
        catch (Exception ex)
        {
            AppendLog("Setup installation failed: " + ex.Message);
            PostSetupResult(requestId, false, ex.Message);
            SetStatus("Setup installation failed", Color.FromArgb(190, 60, 60));
        }
        finally
        {
            _setupInstallRunning = false;
            _setupCancellationRequested = false;
            SetButtons();
        }
    }

    private bool IsAllowedApplicationMessageSource(string source)
    {
        Uri sourceUri;
        Uri applicationUri;
        if (!Uri.TryCreate(source, UriKind.Absolute, out sourceUri)) return false;
        if (!Uri.TryCreate(_activeUrl, UriKind.Absolute, out applicationUri)) return false;
        if (!sourceUri.IsLoopback || !applicationUri.IsLoopback) return false;
        return string.Equals(sourceUri.Scheme, applicationUri.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(sourceUri.Host, applicationUri.Host, StringComparison.OrdinalIgnoreCase)
            && sourceUri.Port == applicationUri.Port;
    }

    private void HandleWebUiBootStatus(Dictionary<string, object> envelope)
    {
        string bootId = GetString(envelope, "bootId");
        if (!IsHexDigest(bootId, 32))
        {
            AppendLog("Ignored malformed Web UI boot status: invalid bootId");
            return;
        }
        if (!string.Equals(bootId, _desktopBootId, StringComparison.Ordinal))
        {
            AppendLog("Ignored stale Web UI boot status for " + bootId);
            return;
        }

        string state = GetString(envelope, "state");
        if (state == "loading")
        {
            _webUiBootLastActivityUtc = DateTime.UtcNow;
            string stage = LimitDiagnosticText(GetString(envelope, "message"), "activating Web UI plugins");
            if (!string.Equals(stage, _webUiBootStage, StringComparison.Ordinal))
            {
                _webUiBootStage = stage;
                AppendLog("Web UI boot progress: " + stage);
            }
            if (!_webUiVerified && !_webUiBootTerminal)
            {
                SetLoadingStage(stage, 92F);
                SetStatus(stage, Color.FromArgb(180, 130, 20));
            }
            return;
        }
        if (state == "ready")
        {
            _webUiVerified = true;
            _webUiBootTerminal = true;
            _webUiServiceRecoveryCount = 0;
            _preserveWebUiServiceRecoveryCount = false;
            AppendLog("Web UI boot verified by structured ready status");
            SetStatus("Service running - interface ready", Color.FromArgb(34, 139, 74));
            if (_loadingOverlay != null) _loadingOverlay.Complete("Interface ready");
            CompleteHostedServiceRestart();
            return;
        }
        if (state != "failed")
        {
            AppendLog("Ignored malformed Web UI boot status: invalid state");
            return;
        }

        string report = LimitDiagnosticText(GetString(envelope, "message"), "plugin activation failed");
        AppendLog("Web UI boot failed: " + report);
        object[] failures = GetArray(envelope, "failures");
        if (failures != null)
        {
            foreach (object failureValue in failures)
            {
                Dictionary<string, object> failure = failureValue as Dictionary<string, object>;
                if (failure == null) continue;
                string name = LimitDiagnosticText(GetString(failure, "name"), "unknown entry");
                string failureState = LimitDiagnosticText(GetString(failure, "state"), "unknown");
                string[] missing = GetStringArray(failure, "missingServices");
                string suffix = missing.Length == 0 ? "" : "; missing services: " + string.Join(", ", missing);
                AppendLog("Web UI entry " + name + ": " + failureState + suffix);
            }
        }

        bool retryable = GetBoolean(envelope, "retryable") && FailuresArePendingOnly(failures);
        if (retryable && _webUiRetryCount < MaxWebUiRetries)
        {
            _webUiRetryCount++;
            _webUiVerified = false;
            _webUiBootTerminal = false;
            _activeNavigationId = 0;
            _navigationUrl = BuildNavigationUrl(_activeUrl, _hubMode, _hubConfig, out _desktopBootId);
            _webUiBootStartedUtc = DateTime.UtcNow;
            _webUiBootLastActivityUtc = _webUiBootStartedUtc;
            _webUiBootStage = "retry navigation queued";
            SetLoadingStage("Retrying Web UI plugin activation", 94F);
            SetStatus("Retrying Web UI startup", Color.FromArgb(180, 130, 20));
            AppendLog("Retrying Web UI boot once with a fresh navigation token");
            try
            {
                _webView.CoreWebView2.Navigate(_navigationUrl);
            }
            catch (Exception ex)
            {
                _webUiBootTerminal = true;
                AppendLog("Web UI retry navigation failed: " + ex.Message);
                SetStatus("Plugin startup failed - check log", Color.FromArgb(190, 60, 60));
                if (_loadingOverlay != null) _loadingOverlay.ShowError("Plugin startup failed — open the toolbar log");
                CompleteHostedServiceRestart();
            }
            return;
        }

        if (retryable && TryRecoverWebUiService(report)) return;
        if (IsRecoverableWebUiAssetFailure(report) && TryRecoverWebUiAssetFailure(report)) return;

        _webUiBootTerminal = true;
        SetStatus("Plugin startup failed - check log", Color.FromArgb(190, 60, 60));
        if (_loadingOverlay != null) _loadingOverlay.ShowError("Plugin startup failed — open the toolbar log");
        CompleteHostedServiceRestart();
    }

    private void HandleDesktopCommand(Dictionary<string, object> envelope)
    {
        string command = GetString(envelope, "command");
        if (command == "open-config")
        {
            OpenConfigApp();
            return;
        }
        if (command == "open-hub")
        {
            if (!_hubMode) OpenHubApp();
            return;
        }
        if (command != "open-main")
        {
            AppendLog("Ignored unknown desktop command: " + LimitDiagnosticText(command, "empty"));
            return;
        }
        if (!_hubMode) return;
        OpenMainApp();
    }

    private async Task HandleHubRequestAsync(Dictionary<string, object> envelope, JavaScriptSerializer serializer)
    {
        string requestId = GetString(envelope, "requestId");
        Guid parsedRequestId;
        if (!Guid.TryParseExact(requestId, "D", out parsedRequestId))
        {
            AppendLog("Rejected malformed HUB request id");
            return;
        }
        string operation = GetString(envelope, "operation");
        if (!_hubMode && operation != "hub-snapshot" && operation != "hub-open-path"
            && operation != "hub-uninstall" && operation != "desktop-reload" && operation != "app-reload")
        {
            PostHubResult(requestId, false, null, "This HUB operation is available only in dsh-hub.exe.");
            return;
        }
        Dictionary<string, object> payload = GetDictionary(envelope, "payload") ?? new Dictionary<string, object>();
        try
        {
            if (operation == "app-reload")
            {
                if (_restartInProgress) throw new InvalidOperationException("Application restart is already in progress.");
                PostHubResult(requestId, true, new Dictionary<string, object> { { "requested", true } }, "");
                BeginInvoke((MethodInvoker)delegate
                {
                    RestartHostedService(
                        "Restart requested after plugin changes; restarting the local service",
                        "Restarting after plugin changes",
                        true);
                });
                return;
            }
            object data;
            if (operation == "hub-snapshot") data = BuildHubSnapshot();
            else if (operation == "dshmk-catalog") data = await QueryDshmkCatalogAsync(payload);
            else if (operation == "dshmk-detail") data = await LoadDshmkDetailAsync(GetInteger(payload, "repositoryId"));
            else if (operation == "dshmk-install") data = await InstallDshmkSetupAsync(requestId, GetInteger(payload, "repositoryId"));
            else if (operation == "setup-cancel") data = CancelActiveSetup();
            else if (operation == "setup-manual-import") data = await ImportManualDownloadAsync(GetString(payload, "downloadId"));
            else if (operation == "setup-open-manual-url") { OpenManualDownloadUrl(GetString(payload, "downloadId"), GetString(payload, "target")); data = new Dictionary<string, object>(); }
            else if (operation == "desktop-reload")
            {
                if (!RequestDesktopReload()) throw new InvalidOperationException("DeepSeek Harness Desktop could not be started or signalled for reload.");
                data = new Dictionary<string, object> { { "requested", true } };
            }
            else if (operation == "hub-save-preferences") data = SaveHubPreferences(payload);
            else if (operation == "community-registry") data = await LoadCommunityRegistryAsync();
            else if (operation == "community-prepare-setup") data = await PrepareCommunitySetupAsync(requestId, GetString(payload, "url"));
            else if (operation == "github-search") data = await SearchGitHubAsync(GetString(payload, "query"));
            else if (operation == "github-starred") data = await LoadGitHubStarredAsync();
            else if (operation == "github-login-token") data = await LoginGitHubAsync(GetString(payload, "token"));
            else if (operation == "github-logout") { LogoutGitHub(); data = new Dictionary<string, object>(); }
            else if (operation == "hub-open-path") { OpenHubPath(GetString(payload, "path")); data = new Dictionary<string, object>(); }
            else if (operation == "hub-create-draft") data = CreateSetupDraft(GetDictionary(payload, "repository"), serializer);
            else if (operation == "hub-delete-draft") { DeleteSetupDraft(GetString(payload, "id")); data = new Dictionary<string, object>(); }
            else if (operation == "hub-uninstall") { await UninstallHubSetupAsync(requestId, GetString(payload, "id")); data = new Dictionary<string, object>(); }
            else throw new InvalidOperationException("Unknown HUB operation: " + LimitDiagnosticText(operation, "empty"));
            PostHubResult(requestId, true, data, "");
        }
        catch (Exception ex)
        {
            AppendLog("HUB operation " + operation + " failed: " + ex.Message);
            PostHubResult(requestId, false, null, ex.Message);
        }
    }

    private void PostHubResult(string requestId, bool ok, object data, string message)
    {
        if (InvokeRequired)
        {
            try { BeginInvoke((MethodInvoker)delegate { PostHubResult(requestId, ok, data, message); }); }
            catch { }
            return;
        }
        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaxWebMessageCharacters;
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["type"] = "dsh-hub-result";
        result["requestId"] = requestId;
        result["ok"] = ok;
        if (ok) result["data"] = data ?? new Dictionary<string, object>();
        else result["message"] = message;
        _webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(result));
    }

    private static string HubRoot { get { return Path.Combine(AppPaths.DataDir, "hub"); } }
    private static string HubLibraryRoot { get { return Path.Combine(HubRoot, "library"); } }
    private static string HubOfflineRoot { get { return Path.Combine(HubRoot, "offline"); } }
    private static string HubInstalledFile { get { return Path.Combine(HubRoot, "installed.json"); } }
    private static string HubCommunityRegistryFile { get { return Path.Combine(HubRoot, "community-registry.json"); } }
    private static string BundledCommunityRegistryFile { get { return Path.Combine(AppPaths.ExeDir, "community-registry.json"); } }
    private static string HubDshmkCatalogFile { get { return Path.Combine(HubRoot, "dshmk-catalog.json"); } }
    private static string BundledDshmkCatalogFile { get { return Path.Combine(AppPaths.ExeDir, "dshmk-catalog.json"); } }
    private static string HubGitHubTokenFile { get { return Path.Combine(HubRoot, "github-token.bin"); } }
    private static string HubGitHubAccountFile { get { return Path.Combine(HubRoot, "github-account.json"); } }

    private static void EnsureHubDirectories()
    {
        AppPaths.Ensure();
        Directory.CreateDirectory(HubRoot);
        Directory.CreateDirectory(HubLibraryRoot);
        Directory.CreateDirectory(HubOfflineRoot);
    }

    private Dictionary<string, object> BuildHubSnapshot()
    {
        EnsureHubDirectories();
        return new Dictionary<string, object>
        {
            { "account", ReadStoredGitHubAccount() },
            { "library", ScanSetupLibrary() },
            { "offline", ScanOfflineInbox() },
            { "installed", ReadInstalledRecords() },
            { "libraryPath", HubLibraryRoot },
            { "offlinePath", HubOfflineRoot }
        };
    }

    private static Dictionary<string, object> ReadStoredGitHubAccount()
    {
        Dictionary<string, object> empty = new Dictionary<string, object> { { "authenticated", false } };
        if (!File.Exists(HubGitHubTokenFile) || !File.Exists(HubGitHubAccountFile)) return empty;
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> account = serializer.DeserializeObject(File.ReadAllText(HubGitHubAccountFile, Encoding.UTF8)) as Dictionary<string, object>;
            if (account == null) return empty;
            account["authenticated"] = true;
            return account;
        }
        catch
        {
            return empty;
        }
    }

    private async Task<Dictionary<string, object>> LoginGitHubAsync(string token)
    {
        token = string.IsNullOrWhiteSpace(token) ? "" : token.Trim();
        if (token.Length < 12 || token.Length > 512) throw new InvalidOperationException("GitHub token is missing or malformed.");
        object response = await GitHubApiAsync("/user", token, true);
        Dictionary<string, object> user = response as Dictionary<string, object>;
        if (user == null || string.IsNullOrEmpty(GetString(user, "login"))) throw new InvalidOperationException("GitHub did not return a valid user account.");
        Dictionary<string, object> account = new Dictionary<string, object>
        {
            { "authenticated", true },
            { "login", GetString(user, "login") },
            { "name", GetString(user, "name") },
            { "avatarUrl", GetString(user, "avatar_url") },
            { "profileUrl", GetString(user, "html_url") }
        };
        EnsureHubDirectories();
        byte[] clear = Encoding.UTF8.GetBytes(token);
        byte[] encrypted = ProtectedData.Protect(clear, Encoding.UTF8.GetBytes("DeepSeekHarness.Hub.GitHub"), DataProtectionScope.CurrentUser);
        File.WriteAllBytes(HubGitHubTokenFile, encrypted);
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        WriteTextAtomic(HubGitHubAccountFile, FormatJson(serializer.Serialize(account)));
        Array.Clear(clear, 0, clear.Length);
        return account;
    }

    private static void LogoutGitHub()
    {
        EnsureHubDirectories();
        if (File.Exists(HubGitHubTokenFile)) File.Delete(HubGitHubTokenFile);
        if (File.Exists(HubGitHubAccountFile)) File.Delete(HubGitHubAccountFile);
    }

    private static string ReadGitHubToken(bool required)
    {
        if (!File.Exists(HubGitHubTokenFile))
        {
            if (required) throw new InvalidOperationException("Sign in to GitHub before using this feature.");
            return "";
        }
        try
        {
            byte[] encrypted = File.ReadAllBytes(HubGitHubTokenFile);
            byte[] clear = ProtectedData.Unprotect(encrypted, Encoding.UTF8.GetBytes("DeepSeekHarness.Hub.GitHub"), DataProtectionScope.CurrentUser);
            string token = Encoding.UTF8.GetString(clear);
            Array.Clear(clear, 0, clear.Length);
            return token;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("The stored GitHub credential cannot be decrypted for this Windows user.", ex);
        }
    }

    private async Task<List<Dictionary<string, object>>> SearchGitHubAsync(string query)
    {
        string token = ReadGitHubToken(false);
        List<string> queries = new List<string>();
        bool defaultDiscovery = string.IsNullOrWhiteSpace(query);
        if (defaultDiscovery)
        {
            queries.Add("deepseek-harness in:name,description,readme");
            queries.Add("\"deepseek harness\" in:name,description,readme");
            queries.Add("topic:deepseek-harness");
        }
        else
        {
            string safe = query.Trim();
            if (safe.Length > 160) safe = safe.Substring(0, 160);
            queries.Add(safe + " in:name,description,readme");
        }

        List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string search in queries)
        {
            object response = await GitHubApiAsync("/search/repositories?q=" + Uri.EscapeDataString(search) + "&sort=stars&order=desc&per_page=30", token, false);
            Dictionary<string, object> root = response as Dictionary<string, object>;
            object[] items = root == null ? null : GetArray(root, "items");
            if (items == null) continue;
            foreach (object value in items)
            {
                Dictionary<string, object> repository = value as Dictionary<string, object>;
                if (repository == null) continue;
                string fullName = GetString(repository, "full_name");
                if (string.IsNullOrEmpty(fullName) || !seen.Add(fullName)) continue;
                Dictionary<string, object> converted = ConvertGitHubRepository(repository);
                if (defaultDiscovery && !IsDshRelatedRepository(converted)) continue;
                results.Add(converted);
                if (results.Count >= 60) return results;
            }
        }
        return results;
    }

    private static bool IsDshRelatedRepository(Dictionary<string, object> repository)
    {
        StringBuilder evidence = new StringBuilder();
        foreach (string key in new string[] { "name", "fullName", "description", "homepage" })
            evidence.Append(' ').Append(GetString(repository, key));
        foreach (string topic in GetRawStringArray(repository, "topics")) evidence.Append(' ').Append(topic);
        string text = evidence.ToString().ToLowerInvariant();
        foreach (string marker in new string[]
        {
            "deepseek-harness", "deepseek harness", "dsh-plugin", "dsh plugin", "dsh-setup", "dsh setup",
            "harness-pet", "everything is a plugin", "deepseek-ai/deepseek-harness"
        })
        {
            if (text.Contains(marker)) return true;
        }
        return false;
    }

    private async Task<List<Dictionary<string, object>>> LoadGitHubStarredAsync()
    {
        string token = ReadGitHubToken(true);
        List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int page = 1; page <= 10; page++)
        {
            object response = await GitHubApiAsync("/user/starred?per_page=100&page=" + page, token, true);
            object[] items = response as object[];
            if (items == null) throw new InvalidOperationException("GitHub returned an unexpected starred-repository response.");
            foreach (object value in items)
            {
                Dictionary<string, object> repository = value as Dictionary<string, object>;
                if (repository == null) continue;
                string fullName = GetString(repository, "full_name");
                if (string.IsNullOrEmpty(fullName) || !seen.Add(fullName)) continue;
                results.Add(ConvertGitHubRepository(repository));
            }
            if (items.Length < 100) break;
        }
        return results;
    }

    private async Task<object> GitHubApiAsync(string path, string token, bool authenticationRequired)
    {
        if (authenticationRequired && string.IsNullOrEmpty(token)) throw new InvalidOperationException("GitHub authentication is required.");
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (HttpClient client = new HttpClient())
        {
            client.BaseAddress = new Uri("https://api.github.com");
            client.Timeout = TimeSpan.FromSeconds(35);
            client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DeepSeekHarnessDesktop", "0.1"));
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            client.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            if (!string.IsNullOrEmpty(token)) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using (HttpResponseMessage response = await client.GetAsync(path))
            {
                string json = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    string detail = "";
                    try
                    {
                        JavaScriptSerializer errorSerializer = new JavaScriptSerializer();
                        Dictionary<string, object> error = errorSerializer.DeserializeObject(json) as Dictionary<string, object>;
                        detail = error == null ? "" : GetString(error, "message");
                    }
                    catch { }
                    if (response.StatusCode == HttpStatusCode.Unauthorized) throw new InvalidOperationException("GitHub rejected the credential. Create a valid read-only token and sign in again.");
                    if ((int)response.StatusCode == 403) throw new InvalidOperationException("GitHub rate limit or permission check blocked the request" + (string.IsNullOrEmpty(detail) ? "." : ": " + detail));
                    throw new InvalidOperationException("GitHub request failed with HTTP " + (int)response.StatusCode + (string.IsNullOrEmpty(detail) ? "." : ": " + detail));
                }
                if (json.Length > 8 * 1024 * 1024) throw new InvalidOperationException("GitHub response exceeded the HUB safety limit.");
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = 8 * 1024 * 1024;
                return serializer.DeserializeObject(json);
            }
        }
    }

    private static Dictionary<string, object> ConvertGitHubRepository(Dictionary<string, object> repository)
    {
        Dictionary<string, object> owner = GetDictionary(repository, "owner");
        Dictionary<string, object> license = GetDictionary(repository, "license");
        string fullName = GetString(repository, "full_name");
        string repositoryUrl = GetString(repository, "html_url");
        if (string.IsNullOrEmpty(repositoryUrl) && !string.IsNullOrEmpty(fullName)) repositoryUrl = "https://github.com/" + fullName;
        return new Dictionary<string, object>
        {
            { "name", GetString(repository, "name") },
            { "fullName", fullName },
            { "owner", owner == null ? "" : GetString(owner, "login") },
            { "ownerAvatarUrl", owner == null ? "" : GetString(owner, "avatar_url") },
            { "description", GetString(repository, "description") },
            { "repositoryUrl", repositoryUrl },
            { "homepage", GetString(repository, "homepage") },
            { "defaultBranch", GetString(repository, "default_branch") },
            { "language", GetString(repository, "language") },
            { "license", license == null ? "" : GetString(license, "spdx_id") },
            { "stars", GetInteger(repository, "stargazers_count") },
            { "updatedAt", GetString(repository, "updated_at") },
            { "pushedAt", GetString(repository, "pushed_at") },
            { "topics", GetRawStringArray(repository, "topics") },
            { "private", GetBoolean(repository, "private") },
            { "fork", GetBoolean(repository, "fork") },
            { "archived", GetBoolean(repository, "archived") },
            { "disabled", GetBoolean(repository, "disabled") }
        };
    }

    private async Task<Dictionary<string, object>> LoadDshmkCatalogAsync()
    {
        if (_dshmkCatalogCache != null && DateTime.UtcNow < _dshmkCatalogCacheUntilUtc)
            return _dshmkCatalogCache;

        List<DshmkCatalogSnapshot> localSnapshots = new List<DshmkCatalogSnapshot>();
        foreach (KeyValuePair<string, string> candidate in new KeyValuePair<string, string>[]
        {
            new KeyValuePair<string, string>(HubDshmkCatalogFile, "cache"),
            new KeyValuePair<string, string>(BundledDshmkCatalogFile, "bundled")
        })
        {
            if (!File.Exists(candidate.Key)) continue;
            try
            {
                localSnapshots.Add(CreateDshmkCatalogSnapshot(
                    ParseDshmkCatalog(File.ReadAllText(candidate.Key, Encoding.UTF8)), candidate.Value, candidate.Key));
            }
            catch (Exception ex)
            {
                AppendLog("DSHMK " + candidate.Value + " catalog failed: " + ex.Message);
            }
        }

        if (localSnapshots.Count > 0)
        {
            localSnapshots.Sort(delegate(DshmkCatalogSnapshot left, DshmkCatalogSnapshot right)
            {
                int installable = right.InstallableCount.CompareTo(left.InstallableCount);
                if (installable != 0) return installable;
                int repositories = right.RepositoryCount.CompareTo(left.RepositoryCount);
                if (repositories != 0) return repositories;
                return right.GeneratedAtUtc.CompareTo(left.GeneratedAtUtc);
            });
            DshmkCatalogSnapshot selected = localSnapshots[0];
            _dshmkCatalogCache = selected.Catalog;
            _dshmkCatalogCacheUntilUtc = DateTime.UtcNow.AddMinutes(10);
            _dshmkCatalogSourceMode = selected.Mode;
            _dshmkCatalogSourceUrl = selected.Path;
            AppendLog("DSHMK selected " + selected.Mode + " catalog with " + selected.RepositoryCount
                + " repositories and " + selected.InstallableCount + " one-click candidates");
            BeginDshmkCatalogRefresh();
            return selected.Catalog;
        }

        return await DownloadDshmkCatalogAsync();
    }

    private async Task<Dictionary<string, object>> DownloadDshmkCatalogAsync()
    {
        Exception liveFailure = null;
        foreach (string url in new string[] { DshmkCatalogUrl, DshmkCatalogRawUrl })
        {
            try
            {
                string json = await DownloadCommunityTextAsync(url, MaxDshmkCatalogCharacters, TimeSpan.FromSeconds(16));
                Dictionary<string, object> live = ParseDshmkCatalog(json);
                if (_dshmkCatalogCache != null && DshmkCatalogCapabilitiesRegressed(_dshmkCatalogCache, live))
                    throw new InvalidOperationException("DSHMK live catalog was rejected because its repository or one-click candidate coverage regressed unexpectedly.");
                EnsureHubDirectories();
                WriteTextAtomic(HubDshmkCatalogFile, json);
                _dshmkCatalogCache = live;
                _dshmkCatalogCacheUntilUtc = DateTime.UtcNow.AddMinutes(30);
                _dshmkCatalogSourceMode = "live";
                _dshmkCatalogSourceUrl = url;
                return live;
            }
            catch (Exception ex)
            {
                liveFailure = ex;
                AppendLog("DSHMK catalog request failed for " + url + ": " + ex.Message);
            }
        }
        throw new InvalidOperationException("DSHMK is unavailable online and no valid local catalog snapshot exists.", liveFailure);
    }

    private static DshmkCatalogSnapshot CreateDshmkCatalogSnapshot(Dictionary<string, object> catalog, string mode, string path)
    {
        DateTime generated;
        if (!DateTime.TryParse(GetString(catalog, "generatedAt"), CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out generated)) generated = DateTime.MinValue;
        int repositories = 0;
        int installable = 0;
        foreach (object value in GetArray(catalog, "repositories") ?? new object[0])
        {
            Dictionary<string, object> repository = value as Dictionary<string, object>;
            if (repository == null || GetInteger(repository, "repositoryId") <= 0) continue;
            repositories++;
            if (DshmkIsInstallable(repository)) installable++;
        }
        return new DshmkCatalogSnapshot
        {
            Catalog = catalog,
            Mode = mode,
            Path = path,
            GeneratedAtUtc = generated,
            RepositoryCount = repositories,
            InstallableCount = installable
        };
    }

    private static bool DshmkCatalogCapabilitiesRegressed(Dictionary<string, object> baseline, Dictionary<string, object> candidate)
    {
        DshmkCatalogSnapshot before = CreateDshmkCatalogSnapshot(baseline, "baseline", "");
        DshmkCatalogSnapshot after = CreateDshmkCatalogSnapshot(candidate, "candidate", "");
        if (before.RepositoryCount >= 100 && after.RepositoryCount * 100 < before.RepositoryCount * 65) return true;
        return before.InstallableCount >= 50 && after.InstallableCount * 100 < before.InstallableCount * 25;
    }

    private async void BeginDshmkCatalogRefresh()
    {
        if (string.Equals(Environment.GetEnvironmentVariable("DEEPSEEK_HARNESS_OFFLINE"), "1", StringComparison.Ordinal)) return;
        if (_dshmkCatalogRefreshRunning) return;
        _dshmkCatalogRefreshRunning = true;
        try { await DownloadDshmkCatalogAsync(); }
        catch (Exception ex) { AppendLog("DSHMK background refresh retained the local snapshot: " + ex.Message); }
        finally { _dshmkCatalogRefreshRunning = false; }
    }

    private static Dictionary<string, object> ParseDshmkCatalog(string json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxDshmkCatalogCharacters)
            throw new InvalidOperationException("DSHMK catalog response is empty or oversized.");
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaxDshmkCatalogCharacters;
        Dictionary<string, object> root = serializer.DeserializeObject(json) as Dictionary<string, object>;
        if (root == null || GetInteger(root, "schemaVersion") < 1) throw new InvalidOperationException("DSHMK catalog root is invalid.");
        object[] repositories = GetArray(root, "repositories");
        if (repositories == null || repositories.Length == 0 || repositories.Length > 10000)
            throw new InvalidOperationException("DSHMK catalog repository count is invalid.");
        int valid = 0;
        foreach (object value in repositories)
        {
            Dictionary<string, object> repository = value as Dictionary<string, object>;
            Uri source;
            if (repository != null && GetInteger(repository, "repositoryId") > 0
                && Uri.TryCreate(GetString(repository, "url"), UriKind.Absolute, out source)
                && source.Scheme == Uri.UriSchemeHttps
                && string.Equals(source.Host, "github.com", StringComparison.OrdinalIgnoreCase)) valid++;
        }
        if (valid == 0) throw new InvalidOperationException("DSHMK catalog contains no valid GitHub repositories.");
        return root;
    }

    private async Task<Dictionary<string, object>> QueryDshmkCatalogAsync(Dictionary<string, object> payload)
    {
        Dictionary<string, object> catalog = await LoadDshmkCatalogAsync();
        int requestedPage = Math.Max(1, GetInteger(payload, "page"));
        int pageSize = NormalizeDshmkPageSize(GetInteger(payload, "pageSize"));
        string query = GetString(payload, "query").Trim();
        string searchScope = GetString(payload, "searchScope").Trim();
        string category = GetString(payload, "category").Trim();
        string projectType = GetString(payload, "projectType").Trim();
        string validation = GetString(payload, "validation").Trim();
        string sort = GetString(payload, "sort").Trim();
        if (string.IsNullOrEmpty(category)) category = "all";
        if (searchScope != "name" && searchScope != "owner" && searchScope != "description"
            && searchScope != "language" && searchScope != "topics") searchScope = "all";
        if (string.IsNullOrEmpty(projectType)) projectType = "all";
        if (string.IsNullOrEmpty(validation)) validation = "all";
        if (sort != "stars" && sort != "updated" && sort != "newest" && sort != "name") sort = "recommended";

        List<Dictionary<string, object>> eligible = new List<Dictionary<string, object>>();
        foreach (object value in GetArray(catalog, "repositories") ?? new object[0])
        {
            Dictionary<string, object> repository = value as Dictionary<string, object>;
            if (repository == null || GetInteger(repository, "repositoryId") <= 0 || GetBoolean(repository, "archived")) continue;
            if (!DshmkMatchesQuery(repository, query, searchScope)) continue;
            if (projectType != "all" && !string.Equals(GetString(repository, "projectType"), projectType, StringComparison.OrdinalIgnoreCase)) continue;
            if (validation == "verified" && !DshmkIsVerified(repository)) continue;
            if (validation == "installable" && !DshmkIsInstallable(repository)) continue;
            if (validation == "local" && DshmkIsInstallable(repository)) continue;
            eligible.Add(repository);
        }

        Dictionary<string, int> categoryCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, int> typeCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> repository in eligible)
        {
            foreach (string id in GetRawStringArray(repository, "categories")) categoryCounts[id] = categoryCounts.ContainsKey(id) ? categoryCounts[id] + 1 : 1;
            string type = GetString(repository, "projectType");
            if (!string.IsNullOrEmpty(type)) typeCounts[type] = typeCounts.ContainsKey(type) ? typeCounts[type] + 1 : 1;
        }

        List<Dictionary<string, object>> filtered = category == "all"
            ? eligible
            : eligible.FindAll(delegate(Dictionary<string, object> repository) { return DshmkHasCategory(repository, category); });
        filtered.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
        {
            if (sort == "stars") return CompareDshmkInteger(right, left, "stars", "name");
            if (sort == "updated") return CompareDshmkDate(right, left, "updatedAt");
            if (sort == "newest") return CompareDshmkDate(right, left, "createdAt");
            if (sort == "name") return string.Compare(GetString(left, "name"), GetString(right, "name"), StringComparison.OrdinalIgnoreCase);
            int verified = DshmkIsVerified(right).CompareTo(DshmkIsVerified(left));
            if (verified != 0) return verified;
            int installable = DshmkIsInstallable(right).CompareTo(DshmkIsInstallable(left));
            if (installable != 0) return installable;
            return CompareDshmkInteger(right, left, "stars", "name");
        });

        int total = filtered.Count;
        int totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        int page = Math.Min(requestedPage, totalPages);
        int start = (page - 1) * pageSize;
        int count = Math.Min(pageSize, Math.Max(0, total - start));
        List<object> items = new List<object>();
        for (int index = 0; index < count; index++) items.Add(BuildDshmkRepository(filtered[start + index], false));

        return new Dictionary<string, object>
        {
            { "sourceMode", string.IsNullOrEmpty(_dshmkCatalogSourceMode) ? "live" : _dshmkCatalogSourceMode },
            { "sourceUrl", string.IsNullOrEmpty(_dshmkCatalogSourceUrl) ? DshmkCatalogUrl : _dshmkCatalogSourceUrl },
            { "generatedAt", GetString(catalog, "generatedAt") },
            { "total", total }, { "page", page }, { "pageSize", pageSize }, { "totalPages", totalPages },
            { "categories", BuildDshmkCountList(categoryCounts) }, { "projectTypes", BuildDshmkCountList(typeCounts) },
            { "items", items.ToArray() }
        };
    }

    private async Task<Dictionary<string, object>> LoadDshmkDetailAsync(int repositoryId)
    {
        if (repositoryId <= 0) throw new InvalidOperationException("DSHMK repository id is missing or invalid.");
        Dictionary<string, object> catalog = await LoadDshmkCatalogAsync();
        Dictionary<string, object> selected = FindDshmkRepository(catalog, repositoryId);
        if (selected == null) throw new InvalidOperationException("The DSHMK project is not present in the current catalog snapshot.");
        string category = GetString(selected, "category");
        List<Dictionary<string, object>> related = new List<Dictionary<string, object>>();
        foreach (object value in GetArray(catalog, "repositories") ?? new object[0])
        {
            Dictionary<string, object> repository = value as Dictionary<string, object>;
            if (repository == null || GetInteger(repository, "repositoryId") == repositoryId || GetBoolean(repository, "archived")) continue;
            if (DshmkHasCategory(repository, category)) related.Add(repository);
        }
        related.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right) { return CompareDshmkInteger(right, left, "stars", "name"); });
        List<object> relatedItems = new List<object>();
        for (int index = 0; index < Math.Min(4, related.Count); index++) relatedItems.Add(BuildDshmkRepository(related[index], false));
        return new Dictionary<string, object>
        {
            { "project", BuildDshmkRepository(selected, true) },
            { "related", relatedItems.ToArray() },
            { "sourceMode", string.IsNullOrEmpty(_dshmkCatalogSourceMode) ? "live" : _dshmkCatalogSourceMode },
            { "sourceUrl", string.IsNullOrEmpty(_dshmkCatalogSourceUrl) ? DshmkCatalogUrl : _dshmkCatalogSourceUrl }
        };
    }

    private static Dictionary<string, object> FindDshmkRepository(Dictionary<string, object> catalog, int repositoryId)
    {
        foreach (object value in GetArray(catalog, "repositories") ?? new object[0])
        {
            Dictionary<string, object> repository = value as Dictionary<string, object>;
            if (repository != null && GetInteger(repository, "repositoryId") == repositoryId) return repository;
        }
        return null;
    }

    private static Dictionary<string, object> BuildDshmkRepository(Dictionary<string, object> repository, bool detailed)
    {
        Dictionary<string, object> owner = GetDictionary(repository, "owner") ?? new Dictionary<string, object>();
        Dictionary<string, object> validation = GetDictionary(repository, "validation") ?? new Dictionary<string, object>();
        Dictionary<string, object> install = GetDictionary(repository, "install") ?? new Dictionary<string, object>();
        Dictionary<string, object> candidate = GetDictionary(install, "candidate");
        Dictionary<string, object> result = new Dictionary<string, object>
        {
            { "id", GetString(repository, "id") }, { "repositoryId", GetInteger(repository, "repositoryId") },
            { "name", GetString(repository, "name") }, { "fullName", GetString(repository, "fullName") },
            { "description", GetString(repository, "description") }, { "url", GetString(repository, "url") },
            { "homepage", GetString(repository, "homepage") },
            { "owner", new Dictionary<string, object> { { "login", GetString(owner, "login") }, { "avatarUrl", GetString(owner, "avatarUrl") } } },
            { "topics", GetRawStringArray(repository, "topics") }, { "language", GetString(repository, "language") },
            { "license", GetString(repository, "license") }, { "stars", GetInteger(repository, "stars") },
            { "forks", GetInteger(repository, "forks") }, { "openIssues", GetInteger(repository, "openIssues") },
            { "createdAt", GetString(repository, "createdAt") }, { "updatedAt", GetString(repository, "updatedAt") }, { "pushedAt", GetString(repository, "pushedAt") },
            { "projectType", GetString(repository, "projectType") }, { "category", GetString(repository, "category") },
            { "categories", GetRawStringArray(repository, "categories") }, { "defaultBranch", GetString(repository, "defaultBranch") },
            { "verified", DshmkIsVerified(repository) }, { "installable", DshmkIsInstallable(repository) },
            { "validation", new Dictionary<string, object>
                {
                    { "overall", GetString(validation, "overall") }, { "label", GetString(validation, "label") },
                    { "tone", GetString(validation, "tone") }, { "level", GetInteger(validation, "level") },
                    { "eligible", GetBoolean(validation, "eligible") }, { "verified", GetBoolean(validation, "verified") },
                    { "updatedAt", GetString(validation, "updatedAt") }, { "sourceSha", GetString(validation, "sourceSha") },
                    { "dshVersion", GetString(validation, "dshVersion") }, { "platform", GetString(validation, "platform") },
                    { "validatorVersion", GetString(validation, "validatorVersion") }, { "reason", GetString(validation, "reason") },
                    { "stages", GetDictionary(validation, "stages") ?? new Dictionary<string, object>() }
                } },
            { "install", new Dictionary<string, object>
                {
                    { "status", GetString(install, "status") },
                    { "candidate", candidate ?? new Dictionary<string, object>() },
                    { "candidates", GetArray(install, "candidates") ?? new object[0] }
                } }
        };
        if (detailed)
        {
            result["size"] = GetInteger(repository, "size");
            result["matchedTopics"] = GetRawStringArray(repository, "matchedTopics");
            result["classificationConfidence"] = GetString(repository, "classificationConfidence");
            result["classificationSource"] = GetString(repository, "classificationSource");
            result["classificationSignals"] = GetRawStringArray(repository, "classificationSignals");
            result["status"] = GetDictionary(repository, "status") ?? new Dictionary<string, object>();
        }
        return result;
    }

    private static object[] BuildDshmkCountList(Dictionary<string, int> counts)
    {
        List<KeyValuePair<string, int>> values = new List<KeyValuePair<string, int>>(counts);
        values.Sort(delegate(KeyValuePair<string, int> left, KeyValuePair<string, int> right)
        {
            int count = right.Value.CompareTo(left.Value);
            return count != 0 ? count : string.Compare(left.Key, right.Key, StringComparison.OrdinalIgnoreCase);
        });
        List<object> result = new List<object>();
        foreach (KeyValuePair<string, int> value in values) result.Add(new Dictionary<string, object> { { "id", value.Key }, { "count", value.Value } });
        return result.ToArray();
    }

    private static int NormalizeDshmkPageSize(int value)
    {
        return value == 12 || value == 24 || value == 48 || value == 96 || value == 200 ? value : 24;
    }

    private static bool DshmkMatchesQuery(Dictionary<string, object> repository, string query, string searchScope)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        string normalized = query.Trim().ToLowerInvariant();
        Dictionary<string, object> owner = GetDictionary(repository, "owner");
        if (searchScope == "name") return DshmkTextMatches(GetString(repository, "name"), normalized)
            || DshmkTextMatches(GetString(repository, "fullName"), normalized);
        if (searchScope == "owner") return owner != null && DshmkTextMatches(GetString(owner, "login"), normalized);
        if (searchScope == "description") return DshmkTextMatches(GetString(repository, "description"), normalized);
        if (searchScope == "language") return DshmkTextMatches(GetString(repository, "language"), normalized);
        if (searchScope == "topics")
        {
            foreach (string topic in GetRawStringArray(repository, "topics")) if (DshmkTextMatches(topic, normalized)) return true;
            foreach (string category in GetRawStringArray(repository, "categories")) if (DshmkTextMatches(category, normalized)) return true;
            return DshmkTextMatches(GetString(repository, "category"), normalized);
        }
        foreach (string value in new string[] { GetString(repository, "name"), GetString(repository, "fullName"), GetString(repository, "description"), GetString(repository, "language"), owner == null ? "" : GetString(owner, "login") })
            if (!string.IsNullOrEmpty(value) && value.ToLowerInvariant().Contains(normalized)) return true;
        foreach (string value in GetRawStringArray(repository, "topics")) if (value.ToLowerInvariant().Contains(normalized)) return true;
        foreach (string value in GetRawStringArray(repository, "categories")) if (value.ToLowerInvariant().Contains(normalized)) return true;
        return false;
    }

    private static bool DshmkTextMatches(string value, string normalizedQuery)
    {
        return !string.IsNullOrEmpty(value) && value.ToLowerInvariant().Contains(normalizedQuery);
    }

    private static bool DshmkHasCategory(Dictionary<string, object> repository, string category)
    {
        if (string.IsNullOrEmpty(category) || category == "all") return true;
        if (string.Equals(GetString(repository, "category"), category, StringComparison.OrdinalIgnoreCase)) return true;
        foreach (string value in GetRawStringArray(repository, "categories")) if (string.Equals(value, category, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static bool DshmkIsVerified(Dictionary<string, object> repository)
    {
        Dictionary<string, object> validation = GetDictionary(repository, "validation");
        return validation != null && string.Equals(GetString(validation, "overall"), "verified", StringComparison.OrdinalIgnoreCase);
    }

    private static bool DshmkIsInstallable(Dictionary<string, object> repository)
    {
        Dictionary<string, object> install = GetDictionary(repository, "install");
        Dictionary<string, object> candidate = GetDictionary(install, "candidate");
        return candidate != null && GetBoolean(candidate, "executable") && GetRawStringArray(candidate, "args").Length >= 5;
    }

    private static int CompareDshmkInteger(Dictionary<string, object> left, Dictionary<string, object> right, string field, string tieField)
    {
        int comparison = GetInteger(left, field).CompareTo(GetInteger(right, field));
        return comparison != 0 ? comparison : string.Compare(GetString(left, tieField), GetString(right, tieField), StringComparison.OrdinalIgnoreCase);
    }

    private static int CompareDshmkDate(Dictionary<string, object> left, Dictionary<string, object> right, string field)
    {
        int comparison = string.Compare(GetString(left, field), GetString(right, field), StringComparison.OrdinalIgnoreCase);
        return comparison != 0 ? comparison : CompareDshmkInteger(left, right, "stars", "name");
    }

    private async Task<Dictionary<string, object>> InstallDshmkSetupAsync(string requestId, int repositoryId)
    {
        if (repositoryId <= 0) throw new InvalidOperationException("DSHMK repository id is missing or invalid.");
        if (_setupInstallRunning) throw new InvalidOperationException("Another Setup installation is already running.");
        Dictionary<string, object> catalog = await LoadDshmkCatalogAsync();
        Dictionary<string, object> repository = FindDshmkRepository(catalog, repositoryId);
        if (repository == null) throw new InvalidOperationException("The DSHMK project is not present in the current catalog snapshot.");
        Dictionary<string, object> install = GetDictionary(repository, "install");
        Dictionary<string, object> candidate = GetDictionary(install, "candidate");
        string[] candidateArgs = ValidateDshmkInstallCandidate(repository, candidate);
        string profile = candidateArgs[2];
        string packageSpec = candidateArgs[4];
        HashSet<string> dependenciesBefore = ReadProfileDependencies(profile);

        _setupInstallRunning = true;
        _setupCancellationRequested = false;
        SetStatus("Installing DSHMK Setup...", Color.FromArgb(47, 94, 170));
        try
        {
            PostHubProgress(requestId, "preflight", 8, "已确认 DSHMK 身份、验证记录与安装候选。", GetString(candidate, "command"));
            Dictionary<string, object> manifest = await PrepareDshmkSetupManifestAsync(repository, candidate, profile, packageSpec, requestId);
            string trust = ClassifySetupTrust(manifest);
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            await InstallSetupManifestAsync(serializer.Serialize(manifest), trust, requestId, true);
            if (_setupCancellationRequested) throw new OperationCanceledException("Installation was cancelled.");

            PostHubProgress(requestId, "profile", 82, "依赖安装完成，正在核对 Web Profile。", ResolveProfileDirectory(profile));
            PostHubProgress(requestId, "activation", 90, "正在确认插件已加入 Web Profile 的 Bundle 层。", packageSpec);
            Dictionary<string, object> verification = VerifyDshmkProfileActivation(repository, profile, packageSpec, dependenciesBefore);
            string[] packageNames = GetRawStringArray(verification, "packageNames");
            RecordInstalledSetup(manifest, dependenciesBefore, packageNames);
            WriteDshmkInstallReceipt(manifest, repository, candidate, verification);

            PostHubProgress(requestId, "verify", 100, "安装与 Profile 激活核验完成。", string.Join(", ", GetRawStringArray(verification, "activeBundles")));
            SetStatus("DSHMK Setup installed", Color.FromArgb(34, 139, 74));
            verification["message"] = _cfg.Language == "zh-CN"
                ? "安装完成，插件已写入并激活于 DSH Web Profile。已经运行的主程序需要刷新或重启服务以加载新插件。"
                : "Installation completed and the plugin is active in the DSH Web Profile. Refresh or restart an already running Desktop service to load it.";
            verification["repositoryId"] = repositoryId;
            return verification;
        }
        catch (OperationCanceledException)
        {
            PostHubProgress(requestId, "cancelled", 100, "安装已取消。", "");
            SetStatus("Setup cancelled", Color.FromArgb(150, 105, 35));
            throw;
        }
        catch
        {
            SetStatus("DSHMK Setup failed", Color.FromArgb(190, 60, 60));
            throw;
        }
        finally
        {
            _setupInstallRunning = false;
            _setupCancellationRequested = false;
            SetButtons();
        }
    }

    private static string[] ValidateDshmkInstallCandidate(Dictionary<string, object> repository, Dictionary<string, object> candidate)
    {
        if (candidate == null || !GetBoolean(candidate, "executable")) throw new InvalidOperationException("DSHMK does not declare an executable install candidate for this project.");
        string[] args = GetRawStringArray(candidate, "args");
        if (args.Length != 5 || args[0] != "plugin" || args[1] != "--profile" || args[2] != "web" || args[3] != "add")
            throw new InvalidOperationException("The DSHMK install candidate does not match the supported profile-plugin command format.");
        string packageSpec = args[4];
        if (string.IsNullOrWhiteSpace(packageSpec) || packageSpec.Length > 500 || packageSpec.StartsWith("-", StringComparison.Ordinal))
            throw new InvalidOperationException("The DSHMK package target is missing or malformed.");
        string source = GetString(candidate, "source");
        string fullName = GetString(repository, "fullName");
        Dictionary<string, object> validation = GetDictionary(repository, "validation");
        string sourceSha = GetString(validation, "sourceSha");
        if (source == "github")
        {
            string expected = "github:" + fullName + "#" + sourceSha;
            if (!IsHexDigest(sourceSha, 40) || !string.Equals(packageSpec, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The DSHMK GitHub candidate is not pinned to the validated source revision.");
        }
        else if (source == "npm")
        {
            if (!Regex.IsMatch(packageSpec, @"^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*(?:@[A-Za-z0-9*._~^<>=|+-]+)?$", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("The DSHMK npm candidate is malformed.");
        }
        else throw new InvalidOperationException("The DSHMK candidate source is not supported by this HUB build.");
        return args;
    }

    private async Task<Dictionary<string, object>> PrepareDshmkSetupManifestAsync(
        Dictionary<string, object> repository,
        Dictionary<string, object> candidate,
        string profile,
        string packageSpec,
        string requestId)
    {
        Dictionary<string, object> validation = GetDictionary(repository, "validation") ?? new Dictionary<string, object>();
        string source = GetString(candidate, "source");
        string fullName = GetString(repository, "fullName");
        string repositoryUrl = GetString(repository, "url");
        string sourceSha = GetString(validation, "sourceSha");
        string version;
        string sourceRef;
        string artifactKind;
        string artifactUrl;
        string artifactFileName;
        bool allowInstallScripts;
        string licenseIdentifier = GetString(repository, "license");
        List<object> auditChecks = new List<object>
        {
            "DSHMK repository identity",
            "DSHMK install candidate",
            "immutable package artifact",
            "artifact SHA-256"
        };
        if (string.IsNullOrWhiteSpace(licenseIdentifier)) licenseIdentifier = "NOASSERTION";

        if (source == "npm")
        {
            string npmName = ResolveNpmPackageName(packageSpec);
            string selector = ResolveNpmPackageSelector(packageSpec, npmName);
            if (string.IsNullOrEmpty(selector)) selector = "latest";
            if (!Regex.IsMatch(selector, @"^(?:[A-Za-z][A-Za-z0-9._-]*|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$"))
                throw new InvalidOperationException("The DSHMK npm candidate uses a version range that cannot be frozen into a deterministic Setup. Choose an exact version or registry tag.");
            PostHubProgress(requestId, "download", 18, "正在解析 npm 候选并固定精确版本。", npmName + "@" + selector);
            Dictionary<string, object> npm = await DownloadCommunityJsonAsync(
                "https://registry.npmjs.org/" + Uri.EscapeDataString(npmName) + "/" + Uri.EscapeDataString(selector),
                4 * 1024 * 1024);
            if (!string.Equals(GetString(npm, "name"), npmName, StringComparison.Ordinal))
                throw new InvalidOperationException("npm returned metadata for a different DSHMK package identity.");
            EnsureNpmRepositoryMatchesDshmk(npm, fullName);
            version = GetString(npm, "version");
            Dictionary<string, object> dist = GetDictionary(npm, "dist");
            artifactUrl = dist == null ? "" : GetString(dist, "tarball");
            if (string.IsNullOrEmpty(version) || string.IsNullOrEmpty(artifactUrl))
                throw new InvalidOperationException("npm did not return a versioned package artifact for this DSHMK candidate.");
            artifactKind = "package";
            artifactFileName = SafeCommunityFileName(npmName.Replace('/', '-') + "-" + version + ".tgz");
            sourceRef = "npm:" + npmName + "@" + version;
            allowInstallScripts = HasLifecycleScripts(GetDictionary(npm, "scripts"));
            string npmLicense = ResolveNpmLicense(GetValue(npm, "license"));
            if (!string.IsNullOrWhiteSpace(npmLicense)) licenseIdentifier = npmLicense;
            auditChecks.Add("npm package identity");
            auditChecks.Add("npm repository provenance");
            auditChecks.Add("immutable npm version");
        }
        else
        {
            if (!IsHexDigest(sourceSha, 40)) throw new InvalidOperationException("The DSHMK GitHub candidate has no valid pinned source revision.");
            version = "0.0.0-" + sourceSha.Substring(0, 12);
            sourceRef = sourceSha;
            artifactKind = "archive";
            artifactUrl = "https://codeload.github.com/" + fullName + "/tar.gz/" + sourceSha;
            artifactFileName = SafeCommunityFileName(fullName.Replace('/', '-') + "-" + sourceSha.Substring(0, 12) + ".tgz");
            allowInstallScripts = true;
            auditChecks.Add("immutable GitHub commit");
        }

        PostHubProgress(requestId, "download", 28, "正在下载并校验插件资产。", artifactFileName);
        CommunityArtifactInfo artifact = await CacheCommunityArtifactAsync(
            requestId, true, repositoryUrl, artifactKind, artifactUrl, artifactFileName, "", 0,
            delegate(long downloadedBytes, long totalBytes)
        {
            PostHubDownloadProgress(requestId, artifactFileName, downloadedBytes, totalBytes, 28, 46);
        });
        if (artifact.Manual) auditChecks.Add("user-selected manual artifact import");
        List<object> permissions = new List<object> { "modify the selected DSH web profile" };
        if (allowInstallScripts) permissions.Add("install-scripts");
        Dictionary<string, object> sourceEvidence = new Dictionary<string, object>
        {
            { "repository", repositoryUrl }, { "ref", sourceRef }
        };
        if (IsHexDigest(sourceSha, 40)) sourceEvidence["commit"] = sourceSha;
        string licenseUrl = IsHexDigest(sourceSha, 40) ? repositoryUrl.TrimEnd('/') + "/blob/" + sourceSha + "/LICENSE" : repositoryUrl;
        return new Dictionary<string, object>
        {
            { "schemaVersion", 1 }, { "id", "dshmk-" + GetInteger(repository, "repositoryId") },
            { "name", GetString(repository, "name") }, { "description", GetString(repository, "description") },
            { "version", version }, { "kind", "virtual" },
            { "categories", GetRawStringArray(repository, "categories") }, { "tags", GetRawStringArray(repository, "topics") },
            { "source", sourceEvidence },
            { "compatibility", new Dictionary<string, object>
                {
                    { "dsh", string.IsNullOrEmpty(GetString(validation, "dshVersion")) ? ">=0.1.0" : GetString(validation, "dshVersion") },
                    { "surfaces", new object[] { "web", "desktop" } }, { "platforms", new object[] { "any" } }
                } },
            { "license", new Dictionary<string, object>
                {
                    { "identifier", licenseIdentifier }, { "name", licenseIdentifier }, { "url", licenseUrl },
                    { "redistributable", IsRedistributableLicense(licenseIdentifier) },
                    { "notice", "License metadata comes from DSHMK and the resolved package source." }
                } },
            { "signature", new Dictionary<string, object>
                {
                    { "status", "unsigned" },
                    { "signer", source == "npm" ? "npm registry package; no artifact signature declared." : "Pinned GitHub source archive; no artifact signature declared." }
                } },
            { "audit", new Dictionary<string, object>
                {
                    { "status", DshmkIsVerified(repository) ? "reviewed" : "unreviewed" },
                    { "auditor", "DSHMK automated validation and DSH HUB artifact preflight" },
                    { "checkedAt", DateTime.UtcNow.ToString("o") }, { "report", DshmkCatalogUrl }, { "checks", auditChecks.ToArray() }
                } },
            { "artifacts", new object[] { new Dictionary<string, object>
                {
                    { "id", "dshmk-package" }, { "kind", artifactKind }, { "url", artifact.Url },
                    { "sha256", artifact.Sha256 }, { "fileName", artifact.FileName }, { "bytes", artifact.Bytes }, { "platform", "any" }
                } } },
            { "install", new Dictionary<string, object>
                {
                    { "mode", "profile" }, { "source", "package" }, { "artifactId", "dshmk-package" }, { "profile", profile }
                } },
            { "permissions", permissions.ToArray() }, { "network", new object[] { new Uri(artifact.Url).Host } }
        };
    }

    private static string ResolveNpmPackageSelector(string packageSpec, string packageName)
    {
        if (string.IsNullOrEmpty(packageSpec) || string.IsNullOrEmpty(packageName) || packageSpec.Length <= packageName.Length) return "";
        if (packageSpec[packageName.Length] != '@') return "";
        return packageSpec.Substring(packageName.Length + 1);
    }

    private static void EnsureNpmRepositoryMatchesDshmk(Dictionary<string, object> npm, string fullName)
    {
        object repositoryValue = GetValue(npm, "repository");
        string repositoryUrl = repositoryValue as string;
        Dictionary<string, object> repository = repositoryValue as Dictionary<string, object>;
        if (repository != null) repositoryUrl = GetString(repository, "url");
        if (string.IsNullOrWhiteSpace(repositoryUrl)) return;
        string normalized = repositoryUrl.Replace('\\', '/').ToLowerInvariant();
        string expected = (fullName ?? "").Trim('/').ToLowerInvariant();
        if (expected.Length == 0 || (normalized.IndexOf("github.com/" + expected, StringComparison.Ordinal) < 0
            && normalized.IndexOf("github.com:" + expected, StringComparison.Ordinal) < 0))
            throw new InvalidOperationException("The npm package repository does not match the DSHMK project identity.");
    }

    private Dictionary<string, object> VerifyDshmkProfileActivation(Dictionary<string, object> repository, string profile, string packageSpec, HashSet<string> dependenciesBefore)
    {
        string packageFile = Path.Combine(ResolveProfileDirectory(profile), "package.json");
        if (!File.Exists(packageFile)) throw new InvalidOperationException("The DSH Web Profile manifest was not created.");
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> package = serializer.DeserializeObject(File.ReadAllText(packageFile, Encoding.UTF8)) as Dictionary<string, object>;
        if (package == null) throw new InvalidOperationException("The DSH Web Profile manifest is malformed after installation.");
        Dictionary<string, object> dependencies = GetDictionary(package, "dependencies") ?? new Dictionary<string, object>();
        Dictionary<string, object> dsh = GetDictionary(package, "dsh") ?? new Dictionary<string, object>();
        Dictionary<string, object> profileConfig = GetDictionary(dsh, "profile") ?? new Dictionary<string, object>();
        HashSet<string> bundles = new HashSet<string>(GetRawStringArray(profileConfig, "bundles"), StringComparer.OrdinalIgnoreCase);
        Dictionary<string, object> validation = GetDictionary(repository, "validation") ?? new Dictionary<string, object>();
        string sourceSha = GetString(validation, "sourceSha");
        string fullName = GetString(repository, "fullName");
        string npmName = ResolveNpmPackageName(packageSpec);
        List<string> installedPackages = new List<string>();
        List<string> activeBundles = new List<string>();
        foreach (KeyValuePair<string, object> dependency in dependencies)
        {
            string spec = Convert.ToString(dependency.Value) ?? "";
            bool matches = !dependenciesBefore.Contains(dependency.Key)
                || (!string.IsNullOrEmpty(npmName) && string.Equals(dependency.Key, npmName, StringComparison.OrdinalIgnoreCase))
                || (!string.IsNullOrEmpty(fullName) && spec.IndexOf(fullName, StringComparison.OrdinalIgnoreCase) >= 0)
                || (IsHexDigest(sourceSha, 40) && spec.IndexOf(sourceSha, StringComparison.OrdinalIgnoreCase) >= 0);
            if (!matches) continue;
            installedPackages.Add(dependency.Key);
            if (bundles.Contains(dependency.Key)) activeBundles.Add(dependency.Key);
        }
        if (installedPackages.Count == 0) throw new InvalidOperationException("The package manager completed, but no matching dependency is present in the DSH Web Profile.");
        if (activeBundles.Count == 0) throw new InvalidOperationException("The dependency exists, but it did not activate as a DSH bundle. Review the package build output and manifest.");
        return new Dictionary<string, object>
        {
            { "status", "activated" }, { "profile", profile },
            { "packageNames", installedPackages.ToArray() }, { "activeBundles", activeBundles.ToArray() },
            { "verifiedAt", DateTime.UtcNow.ToString("o") }, { "profilePath", ResolveProfileDirectory(profile) }
        };
    }

    private static string ResolveNpmPackageName(string packageSpec)
    {
        if (string.IsNullOrEmpty(packageSpec) || packageSpec.StartsWith("github:", StringComparison.OrdinalIgnoreCase)) return "";
        if (packageSpec[0] == '@')
        {
            int separator = packageSpec.IndexOf('/', 1);
            if (separator < 0) return packageSpec;
            int version = packageSpec.IndexOf('@', separator + 1);
            return version < 0 ? packageSpec : packageSpec.Substring(0, version);
        }
        int suffix = packageSpec.IndexOf('@');
        return suffix < 0 ? packageSpec : packageSpec.Substring(0, suffix);
    }

    private static void WriteDshmkInstallReceipt(Dictionary<string, object> manifest, Dictionary<string, object> repository, Dictionary<string, object> candidate, Dictionary<string, object> verification)
    {
        string workspace = Path.Combine(HubLibraryRoot, SafeHubId(GetString(manifest, "id")));
        Directory.CreateDirectory(workspace);
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> receipt = new Dictionary<string, object>
        {
            { "schemaVersion", 1 }, { "installedAt", DateTime.UtcNow.ToString("o") },
            { "source", "dshmk" }, { "catalog", DshmkCatalogUrl }, { "repositoryId", GetInteger(repository, "repositoryId") },
            { "repository", GetString(repository, "url") }, { "sourceRevision", GetString(GetDictionary(repository, "validation"), "sourceSha") },
            { "candidate", candidate }, { "verification", verification },
            { "uninstall", new Dictionary<string, object> { { "profile", GetString(verification, "profile") }, { "packageNames", GetRawStringArray(verification, "packageNames") } } }
        };
        WriteTextAtomic(Path.Combine(workspace, "install-receipt.json"), FormatJson(serializer.Serialize(receipt)));
    }

    private Dictionary<string, object> CancelActiveSetup()
    {
        ManualDownloadSession manual = GetActiveManualDownload();
        bool running = _setupInstallRunning || _setupProcess != null || manual != null;
        _setupCancellationRequested = true;
        if (manual != null)
        {
            try { manual.OnlineCancellation.Cancel(); } catch { }
            manual.Imported.TrySetCanceled();
        }
        try { if (_setupJob != null) _setupJob.Terminate(1223); } catch (Exception ex) { AppendLog("Setup cancellation failed: " + ex.Message); }
        return new Dictionary<string, object> { { "cancelled", running } };
    }

    private Dictionary<string, object> SaveHubPreferences(Dictionary<string, object> payload)
    {
        int pageSize = GetInteger(payload, "pageSize");
        if (pageSize != 0) _hubConfig.PageSize = NormalizeDshmkPageSize(pageSize);
        string detailEntry = GetString(payload, "detailEntry");
        if (detailEntry == "button" || detailEntry == "card") _hubConfig.DetailEntry = detailEntry;
        string detailMode = GetString(payload, "detailMode");
        if (detailMode == "side" || detailMode == "modal" || detailMode == "full") _hubConfig.DetailMode = detailMode;
        string detailContent = GetString(payload, "detailContent");
        if (detailContent == "native" || detailContent == "original") _hubConfig.DetailContent = detailContent;
        _hubConfig.Save();
        return new Dictionary<string, object>();
    }

    private void PostHubDownloadProgress(
        string requestId, string fileName, long downloadedBytes, long totalBytes, int startPercent, int endPercent)
    {
        int downloadPercent = totalBytes > 0
            ? (int)Math.Max(0, Math.Min(100, downloadedBytes * 100L / totalBytes))
            : 0;
        int overallPercent = startPercent + (endPercent - startPercent) * downloadPercent / 100;
        string detail = fileName + " · " + FormatByteCount(downloadedBytes)
            + (totalBytes > 0 ? " / " + FormatByteCount(totalBytes) : "");
        PostHubProgress(requestId, "download", overallPercent, "正在下载并校验插件资产。", detail,
            downloadedBytes, totalBytes);
    }

    private void PostHubProgress(string requestId, string stage, int percent, string message, string detail)
    {
        PostHubProgress(requestId, stage, percent, message, detail, -1, -1);
    }

    private void PostHubProgress(
        string requestId, string stage, int percent, string message, string detail,
        long downloadedBytes, long totalBytes)
    {
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    PostHubProgress(requestId, stage, percent, message, detail, downloadedBytes, totalBytes);
                });
            }
            catch { }
            return;
        }
        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> progress = new Dictionary<string, object>
        {
            { "type", "dsh-hub-progress" }, { "requestId", requestId }, { "stage", stage },
            { "percent", Math.Max(0, Math.Min(100, percent)) }, { "message", message }, { "detail", detail },
            { "timestamp", DateTime.UtcNow.ToString("o") }
        };
        if (downloadedBytes >= 0) progress["downloadedBytes"] = downloadedBytes;
        if (totalBytes >= 0) progress["totalBytes"] = totalBytes;
        object[] manualDownloads = BuildManualDownloadPayload(requestId);
        if (manualDownloads.Length > 0) progress["manualDownloads"] = manualDownloads;
        _webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(progress));
    }

    private sealed class CommunityArtifactInfo
    {
        public string Url;
        public string Sha256;
        public string FileName;
        public long Bytes;
        public bool Manual;
    }

    private ManualDownloadSession BeginManualDownload(
        string setupRequestId, bool hubProgress, string repositoryUrl, string kind,
        string downloadUrl, string fileName, string expectedSha256, long expectedBytes)
    {
        ManualDownloadSession session = new ManualDownloadSession
        {
            Id = Guid.NewGuid().ToString("D"),
            SetupRequestId = setupRequestId,
            FileName = SafeCommunityFileName(fileName),
            Kind = kind,
            DownloadUrl = downloadUrl,
            RepositoryUrl = repositoryUrl,
            ExpectedSha256 = string.IsNullOrEmpty(expectedSha256) ? "" : expectedSha256.ToLowerInvariant(),
            ExpectedBytes = expectedBytes,
            HubProgress = hubProgress,
            OnlineCancellation = new CancellationTokenSource(),
            Imported = new TaskCompletionSource<CommunityArtifactInfo>()
        };
        lock (_manualDownloadSync)
        {
            if (_activeManualDownload != null) throw new InvalidOperationException("Another manual Setup download is already active.");
            _activeManualDownload = session;
        }
        return session;
    }

    private ManualDownloadSession GetActiveManualDownload()
    {
        lock (_manualDownloadSync) return _activeManualDownload;
    }

    private void EndManualDownload(ManualDownloadSession session)
    {
        lock (_manualDownloadSync)
        {
            if (ReferenceEquals(_activeManualDownload, session)) _activeManualDownload = null;
        }
        session.OnlineCancellation.Dispose();
    }

    private object[] BuildManualDownloadPayload(string requestId)
    {
        ManualDownloadSession session;
        lock (_manualDownloadSync) session = _activeManualDownload;
        if (session == null || !string.Equals(session.SetupRequestId, requestId, StringComparison.Ordinal)) return new object[0];
        Dictionary<string, object> download = new Dictionary<string, object>
        {
            { "id", session.Id }, { "fileName", session.FileName }, { "kind", session.Kind },
            { "downloadUrl", session.DownloadUrl }, { "repositoryUrl", session.RepositoryUrl }
        };
        if (session.ExpectedBytes > 0) download["bytes"] = session.ExpectedBytes;
        if (!string.IsNullOrEmpty(session.ExpectedSha256)) download["sha256"] = session.ExpectedSha256;
        return new object[] { download };
    }

    private async Task<Dictionary<string, object>> ImportManualDownloadAsync(string downloadId)
    {
        ManualDownloadSession session = GetActiveManualDownload();
        if (session == null || !string.Equals(session.Id, downloadId, StringComparison.Ordinal))
            throw new InvalidOperationException("The manual download is no longer active. Return to the current download step and try again.");

        string selectedPath;
        using (OpenFileDialog dialog = new OpenFileDialog())
        {
            dialog.Title = _cfg.Language == "zh-CN" ? "选择已经下载的安装文件" : "Select the downloaded installation file";
            dialog.CheckFileExists = true;
            dialog.CheckPathExists = true;
            dialog.Multiselect = false;
            dialog.FileName = session.FileName;
            dialog.Filter = ManualDownloadFilter(session.FileName);
            if (dialog.ShowDialog(this) != DialogResult.OK)
                return new Dictionary<string, object> { { "cancelled", true }, { "imported", false } };
            selectedPath = dialog.FileName;
        }

        CommunityArtifactInfo imported = await Task.Run(delegate
        {
            return ImportManualArtifact(
                selectedPath, session.DownloadUrl, session.FileName, session.Kind,
                session.ExpectedSha256, session.ExpectedBytes);
        });

        lock (_manualDownloadSync)
        {
            if (!ReferenceEquals(_activeManualDownload, session))
                throw new InvalidOperationException("The online download completed before the selected file could be imported.");
        }
        session.ExpectedSha256 = imported.Sha256;
        session.ExpectedBytes = imported.Bytes;
        if (!session.Imported.TrySetResult(imported))
            throw new InvalidOperationException("The manual download could not take ownership of the current installation.");
        try { session.OnlineCancellation.Cancel(); } catch { }
        PostInstallProgress(session.SetupRequestId, session.HubProgress, "download", session.HubProgress ? 46 : 48,
            _cfg.Language == "zh-CN"
                ? "本地安装文件已完成格式、大小与 SHA-256 校验。"
                : "The local installation file passed format, size, and SHA-256 validation.",
            imported.FileName + " · " + FormatByteCount(imported.Bytes), imported.Bytes, imported.Bytes);
        return new Dictionary<string, object>
        {
            { "cancelled", false }, { "imported", true }, { "fileName", imported.FileName },
            { "bytes", imported.Bytes }, { "sha256", imported.Sha256 }
        };
    }

    private void OpenManualDownloadUrl(string downloadId, string target)
    {
        ManualDownloadSession session = GetActiveManualDownload();
        if (session == null || !string.Equals(session.Id, downloadId, StringComparison.Ordinal))
            throw new InvalidOperationException("The manual download is no longer active.");
        string url = target == "download" ? session.DownloadUrl
            : target == "repository" ? session.RepositoryUrl
            : "";
        Uri uri;
        if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("The requested manual-download URL is invalid.");
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = uri.AbsoluteUri;
        psi.UseShellExecute = true;
        Process.Start(psi);
    }

    private static CommunityArtifactInfo ImportManualArtifact(
        string selectedPath, string url, string fileName, string kind, string expectedSha256, long expectedBytes)
    {
        string resolved = Path.GetFullPath(selectedPath);
        if (!File.Exists(resolved)) throw new FileNotFoundException("The selected installation file no longer exists.", resolved);
        FileInfo selected = new FileInfo(resolved);
        if (selected.Length <= 0) throw new InvalidOperationException("The selected installation file is empty.");
        if (selected.Length > MaxCommunityArtifactBytes) throw new InvalidOperationException("The selected installation file exceeds the 256 MB limit.");
        if (expectedBytes > 0 && selected.Length != expectedBytes) throw new InvalidOperationException("The selected file size does not match the Setup declaration.");
        ValidateManualArtifactHeader(resolved, fileName, kind);

        string digest;
        using (SHA256 sha = SHA256.Create())
        using (FileStream input = new FileStream(resolved, FileMode.Open, FileAccess.Read, FileShare.Read))
            digest = HexDigest(sha.ComputeHash(input));
        if (!string.IsNullOrEmpty(expectedSha256) && !string.Equals(digest, expectedSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The selected file SHA-256 does not match the Setup declaration.");

        string safeName = SafeCommunityFileName(fileName);
        string destination = SetupArtifactCachePath(digest, safeName);
        string directory = Path.GetDirectoryName(destination);
        Directory.CreateDirectory(directory);
        if (!File.Exists(destination))
        {
            string temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".manual.part");
            try
            {
                File.Copy(resolved, temporary, false);
                File.Move(temporary, destination);
            }
            finally
            {
                try { if (File.Exists(temporary)) File.Delete(temporary); }
                catch { }
            }
        }
        else
        {
            string cachedDigest;
            using (SHA256 sha = SHA256.Create())
            using (FileStream input = new FileStream(destination, FileMode.Open, FileAccess.Read, FileShare.Read))
                cachedDigest = HexDigest(sha.ComputeHash(input));
            if (!string.Equals(cachedDigest, digest, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The destination Setup cache entry is corrupted.");
        }
        return new CommunityArtifactInfo { Url = url, Sha256 = digest, FileName = safeName, Bytes = selected.Length, Manual = true };
    }

    private static void ValidateManualArtifactHeader(string path, string fileName, string kind)
    {
        byte[] header = new byte[4];
        int read;
        using (FileStream input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            read = input.Read(header, 0, header.Length);
        string lower = fileName.ToLowerInvariant();
        bool gzip = read >= 2 && header[0] == 0x1f && header[1] == 0x8b;
        bool zip = read >= 4 && header[0] == 0x50 && header[1] == 0x4b && header[2] == 0x03 && header[3] == 0x04;
        bool executable = read >= 2 && header[0] == 0x4d && header[1] == 0x5a;
        if ((kind == "package" || kind == "archive") && (lower.EndsWith(".tgz") || lower.EndsWith(".tar.gz")) && !gzip)
            throw new InvalidOperationException("The selected file is not a valid gzip archive.");
        if ((kind == "package" || kind == "archive") && lower.EndsWith(".zip") && !zip)
            throw new InvalidOperationException("The selected file is not a valid ZIP archive.");
        if (kind == "installer" && lower.EndsWith(".exe") && !executable)
            throw new InvalidOperationException("The selected file is not a Windows executable.");
    }

    private static string ManualDownloadFilter(string fileName)
    {
        string lower = fileName.ToLowerInvariant();
        if (lower.EndsWith(".tgz") || lower.EndsWith(".tar.gz")) return "Tar gzip archives (*.tgz;*.tar.gz)|*.tgz;*.tar.gz|All files (*.*)|*.*";
        if (lower.EndsWith(".zip")) return "ZIP archives (*.zip)|*.zip|All files (*.*)|*.*";
        if (lower.EndsWith(".exe")) return "Windows installers (*.exe)|*.exe|All files (*.*)|*.*";
        return "All files (*.*)|*.*";
    }

    private static string SetupArtifactCachePath(string digest, string fileName)
    {
        return Path.Combine(AppPaths.DshHome, "setup-cache", "artifacts", digest.ToLowerInvariant(), SafeCommunityFileName(fileName));
    }

    private async Task<Dictionary<string, object>> LoadCommunityRegistryAsync()
    {
        if (_communityRegistryCache != null && DateTime.UtcNow < _communityRegistryCacheUntilUtc)
            return _communityRegistryCache;

        Exception liveFailure = null;
        try
        {
            string json = await DownloadCommunityTextAsync(CommunityRegistryUrl, MaxCommunityRegistryCharacters, TimeSpan.FromSeconds(20));
            Dictionary<string, object> live = ParseCommunityRegistry(json, "live");
            EnsureHubDirectories();
            WriteTextAtomic(HubCommunityRegistryFile, json);
            _communityRegistryCache = live;
            _communityRegistryCacheUntilUtc = DateTime.UtcNow.AddHours(1);
            return live;
        }
        catch (Exception ex)
        {
            liveFailure = ex;
            AppendLog("Community registry live request failed: " + ex.Message);
        }

        foreach (KeyValuePair<string, string> candidate in new KeyValuePair<string, string>[]
        {
            new KeyValuePair<string, string>(HubCommunityRegistryFile, "cache"),
            new KeyValuePair<string, string>(BundledCommunityRegistryFile, "bundled")
        })
        {
            if (!File.Exists(candidate.Key)) continue;
            try
            {
                string json = File.ReadAllText(candidate.Key, Encoding.UTF8);
                Dictionary<string, object> fallback = ParseCommunityRegistry(json, candidate.Value);
                _communityRegistryCache = fallback;
                _communityRegistryCacheUntilUtc = DateTime.UtcNow.AddMinutes(10);
                return fallback;
            }
            catch (Exception ex)
            {
                AppendLog("Community registry " + candidate.Value + " fallback failed: " + ex.Message);
            }
        }

        throw new InvalidOperationException("The curated DSH registry is unavailable online and no valid local snapshot exists.", liveFailure);
    }

    private static Dictionary<string, object> ParseCommunityRegistry(string json, string sourceMode)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxCommunityRegistryCharacters)
            throw new InvalidOperationException("Community registry response is empty or oversized.");
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = MaxCommunityRegistryCharacters;
        Dictionary<string, object> root = serializer.DeserializeObject(json) as Dictionary<string, object>;
        if (root == null) throw new InvalidOperationException("Community registry root must be an object.");
        Dictionary<string, object> categories = GetDictionary(root, "categories");
        object[] plugins = GetArray(root, "plugins");
        if (categories == null || categories.Count == 0) throw new InvalidOperationException("Community registry contains no categories.");
        if (plugins == null || plugins.Length == 0 || plugins.Length > 5000) throw new InvalidOperationException("Community registry plugin count is invalid.");

        List<object> safePlugins = new List<object>();
        foreach (object value in plugins)
        {
            Dictionary<string, object> plugin = value as Dictionary<string, object>;
            if (plugin == null) continue;
            string name = GetString(plugin, "name");
            string owner = GetString(plugin, "owner");
            string category = GetString(plugin, "category");
            string url = GetString(plugin, "url");
            Uri uri;
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(owner) || string.IsNullOrWhiteSpace(category)) continue;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps || !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase)) continue;
            if (!categories.ContainsKey(category)) continue;
            safePlugins.Add(plugin);
        }
        if (safePlugins.Count == 0) throw new InvalidOperationException("Community registry contains no valid GitHub entries.");
        root["plugins"] = safePlugins.ToArray();
        root["count"] = safePlugins.Count;
        root["sourceMode"] = sourceMode;
        root["sourceUrl"] = CommunityRegistryUrl;
        return root;
    }

    private async Task<Dictionary<string, object>> PrepareCommunitySetupAsync(string requestId, string requestedUrl)
    {
        requestedUrl = string.IsNullOrWhiteSpace(requestedUrl) ? "" : requestedUrl.Trim().TrimEnd('/');
        if (requestedUrl.Length == 0 || requestedUrl.Length > 500) throw new InvalidOperationException("Community Setup source URL is missing or malformed.");
        PostHubProgress(requestId, "preflight", 8, "正在核对精选目录与安装候选。", requestedUrl);
        Dictionary<string, object> registry = await LoadCommunityRegistryAsync();
        Dictionary<string, object> selected = null;
        foreach (object value in GetArray(registry, "plugins") ?? new object[0])
        {
            Dictionary<string, object> plugin = value as Dictionary<string, object>;
            if (plugin != null && string.Equals(GetString(plugin, "url").TrimEnd('/'), requestedUrl, StringComparison.OrdinalIgnoreCase))
            {
                selected = plugin;
                break;
            }
        }
        if (selected == null) throw new InvalidOperationException("The requested project is not present in the verified community registry snapshot.");

        Match source = Regex.Match(requestedUrl, @"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:/tree/[^/]+/(.+?))?$", RegexOptions.IgnoreCase);
        if (!source.Success) throw new InvalidOperationException("The curated entry does not use a supported GitHub source URL.");
        string repositoryName = source.Groups[1].Value + "/" + source.Groups[2].Value;
        string subpath = source.Groups[3].Success ? source.Groups[3].Value : "";
        string npmName = GetString(selected, "npm");
        if (!string.IsNullOrEmpty(subpath) && string.IsNullOrEmpty(npmName))
            throw new InvalidOperationException("This monorepo entry needs a local Setup workspace because its package subdirectory cannot be proven by the generic online installer.");

        string repositoryUrl = "https://github.com/" + repositoryName;
        string repositoryDescription = "";
        string sourceRef = "HEAD";
        string commit = "";
        string licenseIdentifier = "";
        string licenseName = "";
        List<object> auditChecks = new List<object> { "curated registry identity" };
        string version;
        bool allowInstallScripts;
        string artifactKind;
        string artifactUrl;
        string artifactFileName;
        if (!string.IsNullOrEmpty(npmName))
        {
            if (!Regex.IsMatch(npmName, @"^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$"))
                throw new InvalidOperationException("The curated npm package name is malformed.");
            Dictionary<string, object> npm = await DownloadCommunityJsonAsync("https://registry.npmjs.org/" + Uri.EscapeDataString(npmName) + "/latest", 4 * 1024 * 1024);
            string publishedName = GetString(npm, "name");
            if (!string.Equals(publishedName, npmName, StringComparison.Ordinal))
                throw new InvalidOperationException("npm returned metadata for a different package identity.");
            version = GetString(npm, "version");
            Dictionary<string, object> dist = GetDictionary(npm, "dist");
            artifactUrl = dist == null ? "" : GetString(dist, "tarball");
            if (string.IsNullOrEmpty(version) || string.IsNullOrEmpty(artifactUrl)) throw new InvalidOperationException("npm did not return a versioned tarball for this curated package.");
            Dictionary<string, object> scripts = GetDictionary(npm, "scripts");
            allowInstallScripts = HasLifecycleScripts(scripts);
            artifactKind = "package";
            artifactFileName = SafeCommunityFileName(npmName.Replace('/', '-') + "-" + version + ".tgz");
            sourceRef = "npm:" + npmName + "@" + version;
            commit = GetString(npm, "gitHead");
            if (!IsHexDigest(commit, 40)) commit = "";
            licenseIdentifier = ResolveNpmLicense(GetValue(npm, "license"));
            licenseName = licenseIdentifier;
            repositoryDescription = GetString(npm, "description");
            auditChecks.Add("npm package identity");
            auditChecks.Add("immutable npm version");
            if (!string.IsNullOrEmpty(commit)) auditChecks.Add("published package gitHead");
        }
        else
        {
            string token = ReadGitHubToken(false);
            Dictionary<string, object> repository = await GitHubApiAsync("/repos/" + repositoryName, token, false) as Dictionary<string, object>;
            if (repository == null || GetBoolean(repository, "private")) throw new InvalidOperationException("The curated GitHub repository is unavailable or private.");
            string defaultBranch = GetString(repository, "default_branch");
            if (string.IsNullOrEmpty(defaultBranch)) defaultBranch = "HEAD";
            Dictionary<string, object> commitResponse = await GitHubApiAsync("/repos/" + repositoryName + "/commits/" + Uri.EscapeDataString(defaultBranch), token, false) as Dictionary<string, object>;
            commit = commitResponse == null ? "" : GetString(commitResponse, "sha");
            if (!IsHexDigest(commit, 40)) throw new InvalidOperationException("GitHub did not return a valid immutable commit for this project.");
            Dictionary<string, object> githubLicense = GetDictionary(repository, "license");
            licenseIdentifier = githubLicense == null ? "" : GetString(githubLicense, "spdx_id");
            licenseName = githubLicense == null ? "" : GetString(githubLicense, "name");
            string githubRepositoryUrl = GetString(repository, "html_url");
            if (!string.IsNullOrEmpty(githubRepositoryUrl)) repositoryUrl = githubRepositoryUrl;
            repositoryDescription = GetString(repository, "description");
            sourceRef = defaultBranch;
            version = "0.0.0-" + commit.Substring(0, 12);
            allowInstallScripts = true;
            artifactKind = "archive";
            artifactUrl = "https://codeload.github.com/" + repositoryName + "/tar.gz/" + commit;
            artifactFileName = SafeCommunityFileName(repositoryName.Replace('/', '-') + "-" + commit.Substring(0, 12) + ".tgz");
            auditChecks.Add("GitHub repository metadata");
            auditChecks.Add("immutable commit pin");
        }

        CommunityArtifactInfo artifact = await CacheCommunityArtifactAsync(
            requestId, true, repositoryUrl, artifactKind, artifactUrl, artifactFileName, "", 0,
            delegate(long downloadedBytes, long totalBytes)
        {
            PostHubDownloadProgress(requestId, artifactFileName, downloadedBytes, totalBytes, 20, 48);
        });
        if (artifact.Manual) auditChecks.Add("user-selected manual artifact import");
        auditChecks.Add("download host allowlist");
        auditChecks.Add("artifact SHA-256");
        auditChecks.Add("license metadata");
        if (string.IsNullOrEmpty(licenseIdentifier) || licenseIdentifier == "NOASSERTION") licenseIdentifier = "NOASSERTION";
        if (string.IsNullOrEmpty(licenseName)) licenseName = licenseIdentifier == "NOASSERTION" ? "Unknown or not declared" : licenseIdentifier;
        string category = GetString(selected, "category");
        object description = NormalizeCommunityDescription(GetValue(selected, "description"), repositoryDescription);
        List<object> permissions = new List<object>();
        permissions.Add("modify the selected DSH web profile");
        if (allowInstallScripts) permissions.Add("install-scripts");
        string setupIdSeed = !string.IsNullOrEmpty(npmName) ? npmName : repositoryName;
        Dictionary<string, object> sourceEvidence = new Dictionary<string, object> { { "repository", repositoryUrl }, { "ref", sourceRef } };
        if (!string.IsNullOrEmpty(commit)) sourceEvidence["commit"] = commit;
        string licenseUrl = !string.IsNullOrEmpty(commit) ? repositoryUrl + "/blob/" + commit + "/LICENSE" : repositoryUrl;
        Dictionary<string, object> manifest = new Dictionary<string, object>
        {
            { "schemaVersion", 1 },
            { "id", "community-" + SafeHubId(setupIdSeed) },
            { "name", GetString(selected, "name") },
            { "description", description },
            { "version", version },
            { "kind", "virtual" },
            { "categories", new object[] { "community", category } },
            { "tags", new object[] { "dsh-plugin", "curated", GetString(selected, "owner") } },
            { "source", sourceEvidence },
            { "compatibility", new Dictionary<string, object> { { "dsh", ">=0.1.0" }, { "surfaces", new object[] { "web", "desktop" } }, { "platforms", new object[] { "any" } } } },
            { "license", new Dictionary<string, object>
                {
                    { "identifier", licenseIdentifier }, { "name", licenseName },
                    { "url", licenseUrl },
                    { "redistributable", IsRedistributableLicense(licenseIdentifier) },
                    { "notice", "License metadata comes from GitHub or npm and must still be checked against the pinned source." }
                } },
            { "signature", new Dictionary<string, object> { { "status", "unsigned" }, { "signer", "Community source archive; no artifact signature declared." } } },
            { "audit", new Dictionary<string, object>
                {
                    { "status", "unreviewed" }, { "auditor", "DSH HUB automated community preflight" },
                    { "checkedAt", DateTime.UtcNow.ToString("o") }, { "report", CommunityRegistryUrl },
                    { "checks", auditChecks.ToArray() }
                } },
            { "artifacts", new object[] { new Dictionary<string, object>
                {
                    { "id", "community-package" }, { "kind", artifactKind }, { "url", artifact.Url },
                    { "sha256", artifact.Sha256 }, { "fileName", artifact.FileName }, { "bytes", artifact.Bytes }, { "platform", "any" }
                } } },
            { "install", new Dictionary<string, object> { { "mode", "profile" }, { "source", "package" }, { "artifactId", "community-package" }, { "profile", "web" } } },
            { "permissions", permissions.ToArray() },
            { "network", new object[] { new Uri(artifact.Url).Host } }
        };
        return manifest;
    }

    private static async Task<string> DownloadCommunityTextAsync(string url, int maxCharacters, TimeSpan timeout)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (HttpClient client = new HttpClient())
        {
            client.Timeout = timeout;
            client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DeepSeekHarnessDesktop", "0.1"));
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using (HttpResponseMessage response = await client.GetAsync(url))
            {
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Request failed with HTTP " + (int)response.StatusCode + ": " + url);
                string text = await response.Content.ReadAsStringAsync();
                if (text.Length == 0 || text.Length > maxCharacters) throw new InvalidOperationException("Response was empty or exceeded the safety limit: " + url);
                return text;
            }
        }
    }

    private static async Task<Dictionary<string, object>> DownloadCommunityJsonAsync(string url, int maxCharacters)
    {
        string json = await DownloadCommunityTextAsync(url, maxCharacters, TimeSpan.FromSeconds(35));
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = maxCharacters;
        Dictionary<string, object> value = serializer.DeserializeObject(json) as Dictionary<string, object>;
        if (value == null) throw new InvalidOperationException("JSON response root must be an object: " + url);
        return value;
    }

    private async Task<CommunityArtifactInfo> CacheCommunityArtifactAsync(
        string setupRequestId, bool hubProgress, string repositoryUrl, string kind,
        string url, string fileName, string expectedSha256, long expectedBytes,
        Action<long, long> reportProgress)
    {
        Uri uri;
        if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Community artifact must use HTTPS.");
        if (!string.Equals(uri.Host, "registry.npmjs.org", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(uri.Host, "codeload.github.com", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Community artifact host is not allowlisted: " + uri.Host);

        ManualDownloadSession manual = BeginManualDownload(
            setupRequestId, hubProgress, repositoryUrl, kind, url, fileName, expectedSha256, expectedBytes);
        try
        {
            if (reportProgress != null) reportProgress(0, expectedBytes);
            Task<CommunityArtifactInfo> online = DownloadCommunityArtifactOnlineAsync(
                uri, url, fileName, expectedSha256, expectedBytes, reportProgress, manual.OnlineCancellation.Token);
            Task winner = await Task.WhenAny(online, manual.Imported.Task);
            if (ReferenceEquals(winner, manual.Imported.Task))
            {
                manual.OnlineCancellation.Cancel();
                try { await online; }
                catch (OperationCanceledException) { }
                catch (Exception ex) { AppendLog("Online Setup download stopped after manual import: " + ex.Message); }
                return await manual.Imported.Task;
            }
            Exception onlineFailure = null;
            try { return await online; }
            catch (OperationCanceledException)
            {
                if (manual.Imported.Task.Status == TaskStatus.RanToCompletion) return manual.Imported.Task.Result;
                throw;
            }
            catch (Exception ex)
            {
                onlineFailure = ex;
            }
            AppendLog("Online Setup artifact download failed; waiting for manual import: " + onlineFailure.Message);
            PostInstallProgress(setupRequestId, hubProgress, "download", hubProgress ? 30 : 26,
                _cfg.Language == "zh-CN"
                    ? "在线下载失败，可使用手动下载继续当前安装。"
                    : "Online download failed. Use manual download to continue this installation.",
                LimitDiagnosticText(onlineFailure.Message, fileName), 0, expectedBytes);
            return await manual.Imported.Task;
        }
        finally
        {
            EndManualDownload(manual);
        }
    }

    private static async Task<CommunityArtifactInfo> DownloadCommunityArtifactOnlineAsync(
        Uri uri, string url, string fileName, string expectedSha256, long expectedBytes,
        Action<long, long> reportProgress, CancellationToken cancellationToken)
    {
        EnsureHubDirectories();
        string prepared = Path.Combine(HubRoot, "prepared");
        Directory.CreateDirectory(prepared);
        string temporary = Path.Combine(prepared, Guid.NewGuid().ToString("N") + ".part");
        try
        {
            HttpClientHandler handler = new HttpClientHandler();
            handler.AllowAutoRedirect = false;
            using (handler)
            using (HttpClient client = new HttpClient(handler))
            {
                client.Timeout = TimeSpan.FromMinutes(8);
                client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DeepSeekHarnessDesktop", "0.1"));
                using (HttpResponseMessage response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
                {
                    if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Community artifact request failed with HTTP " + (int)response.StatusCode + ".");
                    long? declared = response.Content.Headers.ContentLength;
                    if (declared.HasValue && declared.Value > MaxCommunityArtifactBytes) throw new InvalidOperationException("Community artifact exceeds the 256 MB safety limit.");
                    if (expectedBytes > 0 && declared.HasValue && declared.Value != expectedBytes) throw new InvalidOperationException("Community artifact size does not match the Setup declaration.");
                    long total = 0;
                    long nextReport = 0;
                    Stopwatch reportTimer = Stopwatch.StartNew();
                    string digest;
                    byte[] buffer = new byte[64 * 1024];
                    if (reportProgress != null) reportProgress(0, declared ?? expectedBytes);
                    using (SHA256 sha = SHA256.Create())
                    using (Stream input = await response.Content.ReadAsStreamAsync())
                    using (FileStream output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        while (true)
                        {
                            int read = await input.ReadAsync(buffer, 0, buffer.Length, cancellationToken);
                            if (read <= 0) break;
                            total += read;
                            if (total > MaxCommunityArtifactBytes) throw new InvalidOperationException("Community artifact exceeds the 256 MB safety limit.");
                            sha.TransformBlock(buffer, 0, read, buffer, 0);
                            await output.WriteAsync(buffer, 0, read, cancellationToken);
                            if (reportProgress != null && (total >= nextReport || reportTimer.ElapsedMilliseconds >= 125))
                            {
                                reportProgress(total, declared ?? expectedBytes);
                                nextReport = total + 256 * 1024;
                                reportTimer.Restart();
                            }
                        }
                        sha.TransformFinalBlock(new byte[0], 0, 0);
                        output.Flush(true);
                        digest = HexDigest(sha.Hash);
                    }
                    if (expectedBytes > 0 && total != expectedBytes) throw new InvalidOperationException("Community artifact size does not match the Setup declaration.");
                    if (!string.IsNullOrEmpty(expectedSha256) && !string.Equals(digest, expectedSha256, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Community artifact SHA-256 does not match the Setup declaration.");
                    if (reportProgress != null) reportProgress(total, declared ?? (expectedBytes > 0 ? expectedBytes : total));
                    string destination = SetupArtifactCachePath(digest, fileName);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    if (!File.Exists(destination)) File.Move(temporary, destination);
                    else File.Delete(temporary);
                    return new CommunityArtifactInfo { Url = url, Sha256 = digest, FileName = fileName, Bytes = total, Manual = false };
                }
            }
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch { }
        }
    }

    private static bool HasLifecycleScripts(Dictionary<string, object> scripts)
    {
        if (scripts == null) return false;
        foreach (string name in new string[] { "preinstall", "install", "postinstall", "prepare" })
            if (!string.IsNullOrWhiteSpace(GetString(scripts, name))) return true;
        return false;
    }

    private static string ResolveNpmLicense(object value)
    {
        string plain = value as string;
        if (!string.IsNullOrWhiteSpace(plain)) return plain.Trim();
        Dictionary<string, object> record = value as Dictionary<string, object>;
        return record == null ? "" : GetString(record, "type");
    }

    private static object NormalizeCommunityDescription(object value, string repositoryDescription)
    {
        string plain = value as string;
        if (!string.IsNullOrWhiteSpace(plain)) return plain.Trim();
        Dictionary<string, object> localized = value as Dictionary<string, object>;
        string chinese = localized == null ? "" : GetString(localized, "zh");
        string english = localized == null ? "" : GetString(localized, "en");
        string fallback = !string.IsNullOrWhiteSpace(chinese) ? chinese
            : !string.IsNullOrWhiteSpace(english) ? english
            : !string.IsNullOrWhiteSpace(repositoryDescription) ? repositoryDescription.Trim()
            : "Community DSH extension from the curated registry.";
        Dictionary<string, object> result = new Dictionary<string, object> { { "default", fallback } };
        if (!string.IsNullOrWhiteSpace(chinese)) result["zh"] = chinese;
        if (!string.IsNullOrWhiteSpace(english)) result["en"] = english;
        return result;
    }

    private static bool IsRedistributableLicense(string identifier)
    {
        if (string.IsNullOrWhiteSpace(identifier)) return false;
        foreach (string allowed in new string[] { "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "CC0-1.0", "Unlicense", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0" })
            if (string.Equals(identifier, allowed, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string SafeCommunityFileName(string value)
    {
        string safe = Regex.Replace(value ?? "community-package.tgz", @"[<>:""/\\|?*\x00-\x1f]", "_");
        safe = Path.GetFileName(safe);
        return string.IsNullOrWhiteSpace(safe) || safe == "." || safe == ".." ? "community-package.tgz" : safe;
    }

    private static string HexDigest(byte[] bytes)
    {
        if (bytes == null) return "";
        StringBuilder value = new StringBuilder(bytes.Length * 2);
        foreach (byte item in bytes) value.Append(item.ToString("x2"));
        return value.ToString();
    }

    private static List<Dictionary<string, object>> ScanSetupLibrary()
    {
        EnsureHubDirectories();
        List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
        foreach (string directory in Directory.GetDirectories(HubLibraryRoot))
        {
            string manifestPath = Path.Combine(directory, "setup.json");
            if (!File.Exists(manifestPath)) continue;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> manifest = serializer.DeserializeObject(File.ReadAllText(manifestPath, Encoding.UTF8)) as Dictionary<string, object>;
                if (manifest == null) continue;
                items.Add(LibraryItemFromManifest(manifest, directory));
            }
            catch { }
        }
        items.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
        {
            return string.Compare(GetString(right, "updatedAt"), GetString(left, "updatedAt"), StringComparison.Ordinal);
        });
        return items;
    }

    private static Dictionary<string, object> LibraryItemFromManifest(Dictionary<string, object> manifest, string directory)
    {
        Dictionary<string, object> source = GetDictionary(manifest, "source");
        string setupPath = Path.Combine(directory, "setup.json");
        return new Dictionary<string, object>
        {
            { "id", GetString(manifest, "id") },
            { "name", ResolveSetupName(manifest) },
            { "description", ResolveSetupText(GetValue(manifest, "description")) },
            { "version", GetString(manifest, "version") },
            { "sourceRepository", source == null ? "" : GetString(source, "repository") },
            { "updatedAt", File.GetLastWriteTimeUtc(setupPath).ToString("o") },
            { "path", directory }
        };
    }

    private static List<Dictionary<string, object>> ScanOfflineInbox()
    {
        EnsureHubDirectories();
        List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
        foreach (string path in Directory.GetFiles(HubOfflineRoot))
        {
            FileInfo file = new FileInfo(path);
            string extension = file.Extension.ToLowerInvariant();
            string kind = extension == ".json" ? "manifest"
                : extension == ".zip" || extension == ".tgz" || extension == ".gz" || extension == ".7z" ? "archive"
                : extension == ".exe" || extension == ".msi" || extension == ".msix" ? "executable" : "unknown";
            items.Add(new Dictionary<string, object>
            {
                { "fileName", file.Name }, { "path", file.FullName }, { "bytes", file.Length },
                { "modifiedAt", file.LastWriteTimeUtc.ToString("o") }, { "kind", kind }
            });
        }
        items.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
        {
            return string.Compare(GetString(right, "modifiedAt"), GetString(left, "modifiedAt"), StringComparison.Ordinal);
        });
        return items;
    }

    private Dictionary<string, object> CreateSetupDraft(Dictionary<string, object> repository, JavaScriptSerializer serializer)
    {
        EnsureHubDirectories();
        string fullName = repository == null ? "" : GetString(repository, "fullName");
        string name = repository == null ? "New Setup" : GetString(repository, "name");
        if (string.IsNullOrEmpty(name)) name = "New Setup";
        string id = repository == null ? "setup-draft-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") : SafeHubId(fullName);
        if (string.IsNullOrEmpty(id)) id = "setup-draft-" + Guid.NewGuid().ToString("N").Substring(0, 10);
        string directory = Path.Combine(HubLibraryRoot, id);
        Directory.CreateDirectory(directory);
        string repositoryUrl = repository == null ? "https://github.com/OWNER/REPOSITORY" : GetString(repository, "repositoryUrl");
        string defaultBranch = repository == null ? "main" : GetString(repository, "defaultBranch");
        if (string.IsNullOrEmpty(defaultBranch)) defaultBranch = "main";
        string description = repository == null ? "Describe what this Setup installs." : GetString(repository, "description");
        string license = repository == null ? "NOASSERTION" : GetString(repository, "license");
        if (string.IsNullOrEmpty(license)) license = "NOASSERTION";
        object[] topics = repository == null ? new object[0] : GetArray(repository, "topics") ?? new object[0];
        Dictionary<string, object> manifest = new Dictionary<string, object>
        {
            { "schemaVersion", 1 }, { "id", id }, { "name", name }, { "description", string.IsNullOrEmpty(description) ? "Describe what this Setup installs." : description },
            { "version", "0.1.0" }, { "kind", "virtual" }, { "categories", new object[] { "community", "draft" } }, { "tags", topics },
            { "source", new Dictionary<string, object>
                { { "repository", repositoryUrl }, { "ref", defaultBranch } } },
            { "compatibility", new Dictionary<string, object>
                { { "dsh", ">=0.1.0" }, { "surfaces", new object[] { "desktop", "web" } }, { "platforms", new object[] { "any" } } } },
            { "license", new Dictionary<string, object>
                { { "identifier", license }, { "name", license }, { "redistributable", false }, { "notice", "Draft only: verify the upstream license before publishing or installing." } } },
            { "signature", new Dictionary<string, object>
                { { "status", "unknown" }, { "signer", "Draft generated by DSH HUB; no signature verified." } } },
            { "audit", new Dictionary<string, object>
                { { "status", "unreviewed" }, { "auditor", "DSH HUB draft generator" }, { "checkedAt", DateTime.UtcNow.ToString("o") }, { "checks", new object[] { "GitHub metadata only", "installation target not verified" } } } },
            { "artifacts", new object[]
                { new Dictionary<string, object> { { "id", "replace-me" }, { "kind", "in-box" }, { "component", "@replace/me" }, { "platform", "any" } } } },
            { "install", new Dictionary<string, object>
                { { "mode", "profile" }, { "source", "in-box" }, { "bundle", "@replace/me" }, { "profile", "web" } } },
            { "permissions", new object[0] }, { "network", new object[0] }
        };
        WriteTextAtomic(Path.Combine(directory, "setup.json"), FormatJson(serializer.Serialize(manifest)));
        WriteTextAtomic(Path.Combine(directory, "options.schema.json"), SetupOptionsSchemaJson());
        WriteTextAtomic(Path.Combine(directory, "README-AI.md"), SetupAiReadme(id, repositoryUrl));
        return LibraryItemFromManifest(manifest, directory);
    }

    private static void DeleteSetupDraft(string id)
    {
        EnsureHubDirectories();
        if (string.IsNullOrEmpty(id) || SafeHubId(id) != id) throw new InvalidOperationException("Invalid Setup draft id.");
        string directory = Path.GetFullPath(Path.Combine(HubLibraryRoot, id));
        EnsureInsideHub(directory);
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    private static void OpenHubPath(string path)
    {
        EnsureHubDirectories();
        string resolved = Path.GetFullPath(path);
        EnsureInsideHub(resolved);
        if (!File.Exists(resolved) && !Directory.Exists(resolved)) throw new FileNotFoundException("HUB path no longer exists.", resolved);
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.UseShellExecute = true;
        if (File.Exists(resolved))
        {
            psi.FileName = "explorer.exe";
            psi.Arguments = "/select," + Quote(resolved);
        }
        else
        {
            psi.FileName = resolved;
        }
        Process.Start(psi);
    }

    private static void EnsureInsideHub(string path)
    {
        string root = Path.GetFullPath(HubRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string candidate = Path.GetFullPath(path);
        if (!candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase) && !string.Equals(candidate.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The requested path is outside the HUB workspace.");
    }

    private HashSet<string> SnapshotSetupDependencies(Dictionary<string, object> manifest)
    {
        Dictionary<string, object> install = GetDictionary(manifest, "install");
        if (install == null || GetString(install, "mode") != "profile" || GetString(install, "source") != "package") return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string profile = GetString(install, "profile");
        if (string.IsNullOrEmpty(profile)) profile = "web";
        return ReadProfileDependencies(profile);
    }

    private void RecordInstalledSetup(Dictionary<string, object> manifest, HashSet<string> dependenciesBefore, string[] verifiedPackageNames)
    {
        EnsureHubDirectories();
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        string workspace = EnsureInstalledWorkspace(manifest, serializer);
        Dictionary<string, object> install = GetDictionary(manifest, "install") ?? new Dictionary<string, object>();
        Dictionary<string, object> source = GetDictionary(manifest, "source");
        string profile = GetString(install, "profile");
        if (string.IsNullOrEmpty(profile)) profile = "web";
        List<string> packageNames = new List<string>();
        string uninstallMethod = "external";
        string bundle = "";
        if (GetString(install, "mode") == "profile" && GetString(install, "source") == "in-box")
        {
            uninstallMethod = "profile-bundle";
            bundle = GetString(install, "bundle");
        }
        else if (GetString(install, "mode") == "profile" && GetString(install, "source") == "package")
        {
            uninstallMethod = "profile-package";
            HashSet<string> after = ReadProfileDependencies(profile);
            foreach (string packageName in after) if (!dependenciesBefore.Contains(packageName)) packageNames.Add(packageName);
            if (packageNames.Count == 0 && verifiedPackageNames != null)
                foreach (string packageName in verifiedPackageNames) if (!string.IsNullOrEmpty(packageName) && !packageNames.Contains(packageName)) packageNames.Add(packageName);
        }
        List<Dictionary<string, object>> records = ReadInstalledRecords();
        string id = GetString(manifest, "id");
        Dictionary<string, object> previous = records.Find(delegate(Dictionary<string, object> item) { return GetString(item, "id") == id; });
        if (packageNames.Count == 0 && previous != null)
        {
            foreach (string packageName in GetRawStringArray(previous, "packageNames")) packageNames.Add(packageName);
        }
        if (previous != null) records.Remove(previous);
        records.Insert(0, new Dictionary<string, object>
        {
            { "id", id }, { "name", ResolveSetupName(manifest) }, { "version", GetString(manifest, "version") },
            { "kind", GetString(manifest, "kind") }, { "sourceRepository", source == null ? "" : GetString(source, "repository") },
            { "installedAt", DateTime.UtcNow.ToString("o") }, { "workspacePath", workspace }, { "profile", profile },
            { "packageNames", packageNames.ToArray() }, { "removable", uninstallMethod == "profile-bundle" ? !string.IsNullOrEmpty(bundle) : packageNames.Count > 0 },
            { "uninstallMethod", uninstallMethod }, { "bundle", bundle },
            { "activationState", uninstallMethod == "external" ? "completed" : "activated" }, { "verifiedAt", DateTime.UtcNow.ToString("o") }
        });
        WriteInstalledRecords(records);
    }

    private static string EnsureInstalledWorkspace(Dictionary<string, object> manifest, JavaScriptSerializer serializer)
    {
        string id = SafeHubId(GetString(manifest, "id"));
        if (string.IsNullOrEmpty(id)) id = "installed-" + Guid.NewGuid().ToString("N").Substring(0, 10);
        string directory = Path.Combine(HubLibraryRoot, id);
        Directory.CreateDirectory(directory);
        string manifestJson = FormatJson(serializer.Serialize(manifest));
        string setupPath = Path.Combine(directory, "setup.json");
        if (!File.Exists(setupPath)) WriteTextAtomic(setupPath, manifestJson);
        WriteTextAtomic(Path.Combine(directory, "last-installed.setup.json"), manifestJson);
        if (!File.Exists(Path.Combine(directory, "options.schema.json"))) WriteTextAtomic(Path.Combine(directory, "options.schema.json"), SetupOptionsSchemaJson());
        if (!File.Exists(Path.Combine(directory, "README-AI.md"))) WriteTextAtomic(Path.Combine(directory, "README-AI.md"), SetupAiReadme(id, GetString(GetDictionary(manifest, "source"), "repository")));
        return directory;
    }

    private static List<Dictionary<string, object>> ReadInstalledRecords()
    {
        EnsureHubDirectories();
        if (!File.Exists(HubInstalledFile)) return new List<Dictionary<string, object>>();
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            object[] raw = serializer.DeserializeObject(File.ReadAllText(HubInstalledFile, Encoding.UTF8)) as object[];
            List<Dictionary<string, object>> records = new List<Dictionary<string, object>>();
            if (raw != null) foreach (object value in raw) { Dictionary<string, object> record = value as Dictionary<string, object>; if (record != null) records.Add(record); }
            return records;
        }
        catch
        {
            return new List<Dictionary<string, object>>();
        }
    }

    private static void WriteInstalledRecords(List<Dictionary<string, object>> records)
    {
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        WriteTextAtomic(HubInstalledFile, FormatJson(serializer.Serialize(records)));
    }

    private async Task UninstallHubSetupAsync(string requestId, string id)
    {
        if (string.IsNullOrEmpty(id)) throw new InvalidOperationException("Installed Setup id is missing.");
        List<Dictionary<string, object>> records = ReadInstalledRecords();
        Dictionary<string, object> record = records.Find(delegate(Dictionary<string, object> item) { return GetString(item, "id") == id; });
        if (record == null) throw new InvalidOperationException("Installed Setup record was not found.");
        if (!GetBoolean(record, "removable")) throw new InvalidOperationException("This Setup must be removed through Windows Apps & features.");
        string displayName = GetString(record, "name");
        if (string.IsNullOrEmpty(displayName)) displayName = id;
        string profile = GetString(record, "profile");
        if (string.IsNullOrEmpty(profile)) profile = "web";
        string method = GetString(record, "uninstallMethod");
        string[] verificationNames;
        bool verifyDependencies;
        PostHubProgress(requestId, "preflight", 6, "正在读取组件安装记录。", displayName);
        if (method == "profile-bundle")
        {
            verificationNames = new string[] { GetString(record, "bundle") };
            verifyDependencies = false;
            PostHubProgress(requestId, "profile", 42, "正在从 Web Profile 移除 Bundle。", string.Join(", ", verificationNames));
            RemoveBundlesFromProfile(profile, verificationNames);
        }
        else if (method == "profile-package")
        {
            string[] packages = GetRawStringArray(record, "packageNames");
            if (packages.Length == 0) throw new InvalidOperationException("No installed package name was recorded for this Setup.");
            verificationNames = packages;
            verifyDependencies = true;
            PostHubProgress(requestId, "install", 28, "正在卸载组件依赖。", string.Join(", ", packages));
            await RemoveProfilePackagesAsync(profile, packages);
            PostHubProgress(requestId, "profile", 72, "依赖已移除，正在更新 Web Profile。", ResolveProfileDirectory(profile));
            RemoveBundlesFromProfile(profile, packages);
        }
        else throw new InvalidOperationException("This Setup does not declare a safe HUB uninstall method.");
        PostHubProgress(requestId, "activation", 86, "正在清理插件启动引用。", string.Join(", ", verificationNames));
        HashSet<string> remainingBundles = ReadProfileBundles(profile);
        HashSet<string> remainingDependencies = ReadProfileDependencies(profile);
        foreach (string name in verificationNames)
        {
            if (string.IsNullOrEmpty(name)) continue;
            if (remainingBundles.Contains(name)) throw new InvalidOperationException("The removed component is still present in the Profile bundle list: " + name);
            if (verifyDependencies && remainingDependencies.Contains(name)) throw new InvalidOperationException("The removed component is still present in Profile dependencies: " + name);
        }
        PostHubProgress(requestId, "verify", 96, "正在核对卸载结果并更新组件记录。", displayName);
        records.Remove(record);
        WriteInstalledRecords(records);
        PostHubProgress(requestId, "verify", 100, "组件卸载完成。", displayName);
    }

    private async Task RemoveProfilePackagesAsync(string profile, string[] packages)
    {
        string repo = FindRepo();
        string node = FindNode(repo);
        if (node == null) throw new InvalidOperationException("The bundled Node.js runtime was not found.");
        string nodeDirectory = Path.GetDirectoryName(node);
        string npm = Path.Combine(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js");
        if (!File.Exists(npm)) npm = Path.GetFullPath(Path.Combine(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
        if (!File.Exists(npm)) throw new InvalidOperationException("The bundled npm runtime was not found.");
        string profileDirectory = ResolveProfileDirectory(profile);
        if (!Directory.Exists(profileDirectory)) throw new DirectoryNotFoundException("The DSH profile directory is missing: " + profileDirectory);
        StringBuilder arguments = new StringBuilder();
        arguments.Append(Quote(npm)).Append(" uninstall --legacy-peer-deps --no-audit --no-fund --ignore-scripts --");
        foreach (string packageName in packages) arguments.Append(" ").Append(Quote(packageName));
        string output = await RunCapturedProcessAsync(node, arguments.ToString(), profileDirectory);
        AppendLog("[HUB UNINSTALL] " + LastSetupOutput(output));
    }

    private async Task<string> RunCapturedProcessAsync(string fileName, string arguments, string workingDirectory)
    {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = fileName;
        psi.Arguments = arguments;
        psi.WorkingDirectory = workingDirectory;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        using (Process process = new Process())
        {
            process.StartInfo = psi;
            process.Start();
            Task<string> stdout = process.StandardOutput.ReadToEndAsync();
            Task<string> stderr = process.StandardError.ReadToEndAsync();
            await Task.Run(delegate { process.WaitForExit(); });
            string output = (await stdout) + Environment.NewLine + (await stderr);
            if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(LastSetupOutput(output)) ? "Package removal failed with code " + process.ExitCode : LastSetupOutput(output));
            return output;
        }
    }

    private static HashSet<string> ReadProfileDependencies(string profile)
    {
        HashSet<string> dependencies = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string packageFile = Path.Combine(ResolveProfileDirectory(profile), "package.json");
        if (!File.Exists(packageFile)) return dependencies;
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> package = serializer.DeserializeObject(File.ReadAllText(packageFile, Encoding.UTF8)) as Dictionary<string, object>;
            Dictionary<string, object> values = GetDictionary(package, "dependencies");
            if (values != null) foreach (string key in values.Keys) dependencies.Add(key);
        }
        catch { }
        return dependencies;
    }

    private static HashSet<string> ReadProfileBundles(string profile)
    {
        HashSet<string> bundles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string packageFile = Path.Combine(ResolveProfileDirectory(profile), "package.json");
        if (!File.Exists(packageFile)) return bundles;
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> package = serializer.DeserializeObject(File.ReadAllText(packageFile, Encoding.UTF8)) as Dictionary<string, object>;
            Dictionary<string, object> dsh = GetDictionary(package, "dsh");
            Dictionary<string, object> profileConfig = GetDictionary(dsh, "profile");
            object[] values = GetArray(profileConfig, "bundles") ?? new object[0];
            foreach (object value in values)
            {
                string name = value as string;
                if (!string.IsNullOrEmpty(name)) bundles.Add(name);
            }
        }
        catch { }
        return bundles;
    }

    private static void RemoveBundlesFromProfile(string profile, string[] packages)
    {
        string packageFile = Path.Combine(ResolveProfileDirectory(profile), "package.json");
        if (!File.Exists(packageFile)) throw new FileNotFoundException("The DSH profile manifest is missing.", packageFile);
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> package = serializer.DeserializeObject(File.ReadAllText(packageFile, Encoding.UTF8)) as Dictionary<string, object>;
        if (package == null) throw new InvalidOperationException("The DSH profile manifest is malformed.");
        Dictionary<string, object> dsh = GetDictionary(package, "dsh");
        Dictionary<string, object> profileConfig = GetDictionary(dsh, "profile");
        if (dsh == null || profileConfig == null) return;
        object[] bundles = GetArray(profileConfig, "bundles") ?? new object[0];
        HashSet<string> remove = new HashSet<string>(packages, StringComparer.OrdinalIgnoreCase);
        List<object> kept = new List<object>();
        foreach (object value in bundles) { string name = value as string; if (string.IsNullOrEmpty(name) || !remove.Contains(name)) kept.Add(value); }
        profileConfig["bundles"] = kept.ToArray();
        WriteTextAtomic(packageFile, FormatJson(serializer.Serialize(package)));
    }

    private static string ResolveProfileDirectory(string profile)
    {
        if (string.IsNullOrEmpty(profile) || profile.Contains("/") || profile.Contains("\\") || profile == "." || profile == "..") throw new InvalidOperationException("Invalid DSH profile name.");
        return Path.GetFullPath(Path.Combine(AppPaths.DshHome, "profiles", profile));
    }

    private static string SetupOptionsSchemaJson()
    {
        return "{\r\n  \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\r\n  \"title\": \"DSH Setup options\",\r\n  \"description\": \"Optional choices exposed by this Setup. Keep empty until every option has a deterministic install action.\",\r\n  \"type\": \"object\",\r\n  \"properties\": {},\r\n  \"additionalProperties\": false\r\n}\r\n";
    }

    private static string SetupAiReadme(string id, string repository)
    {
        return "# DSH Setup AI editing workspace\r\n\r\n"
            + "Setup id: `" + id + "`\r\nSource: " + (string.IsNullOrEmpty(repository) ? "not declared" : repository) + "\r\n\r\n"
            + "Give this directory path to an AI when you want to edit the Setup. The AI may improve localized names, descriptions, categories, tags, compatibility, permissions, network declarations, and `options.schema.json`. It must not invent signatures, audit results, licenses, source commits, hashes, package names, or installer arguments.\r\n\r\n"
            + "把此目录路径交给 AI，即可编辑 Setup。AI 可以改进多语言名称、描述、分类、标签、兼容范围、权限、网络声明与 `options.schema.json`，但不得编造签名、审核、许可证、Commit、哈希、包名或安装参数。\r\n\r\n"
            + "Before installing or publishing, open the draft in DSH HUB and re-check every source and security statement.\r\n";
    }

    private static string SafeHubId(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        StringBuilder safe = new StringBuilder();
        foreach (char character in value.ToLowerInvariant())
        {
            if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')) safe.Append(character);
            else if (character == '-' || character == '_' || character == '.' || character == '/' || char.IsWhiteSpace(character))
            {
                if (safe.Length > 0 && safe[safe.Length - 1] != '-') safe.Append('-');
            }
            if (safe.Length >= 80) break;
        }
        return safe.ToString().Trim('-');
    }

    private static string ResolveSetupText(object value)
    {
        string plain = value as string;
        if (!string.IsNullOrEmpty(plain)) return plain;
        Dictionary<string, object> localized = value as Dictionary<string, object>;
        if (localized == null) return "";
        string chinese = GetString(localized, "zh");
        if (!string.IsNullOrEmpty(chinese)) return chinese;
        string fallback = GetString(localized, "default");
        return string.IsNullOrEmpty(fallback) ? GetString(localized, "en") : fallback;
    }

    private static object GetValue(Dictionary<string, object> value, string key)
    {
        object nested;
        return value != null && value.TryGetValue(key, out nested) ? nested : null;
    }

    private static int GetInteger(Dictionary<string, object> value, string key)
    {
        object nested = GetValue(value, key);
        if (nested is int) return (int)nested;
        if (nested is long) return (int)Math.Min(int.MaxValue, (long)nested);
        if (nested is decimal) return (int)Math.Min(int.MaxValue, (decimal)nested);
        if (nested is double) return (int)Math.Min(int.MaxValue, (double)nested);
        return 0;
    }

    private static long GetLong(Dictionary<string, object> value, string key)
    {
        object nested = GetValue(value, key);
        if (nested is int) return Math.Max(0, (int)nested);
        if (nested is long) return Math.Max(0L, (long)nested);
        if (nested is decimal) return (long)Math.Max(0M, Math.Min(long.MaxValue, (decimal)nested));
        if (nested is double) return (long)Math.Max(0D, Math.Min(long.MaxValue, (double)nested));
        return 0;
    }

    private static string FormatByteCount(long bytes)
    {
        double value = Math.Max(0L, bytes);
        string[] units = new string[] { "B", "KB", "MB", "GB" };
        int unit = 0;
        while (value >= 1024D && unit < units.Length - 1)
        {
            value /= 1024D;
            unit++;
        }
        string format = unit == 0 || value >= 100D ? "0" : value >= 10D ? "0.0" : "0.00";
        return value.ToString(format, CultureInfo.InvariantCulture) + " " + units[unit];
    }

    private static string[] GetRawStringArray(Dictionary<string, object> value, string key)
    {
        object[] values = GetArray(value, key);
        if (values == null) return new string[0];
        List<string> strings = new List<string>();
        foreach (object item in values) { string text = item as string; if (!string.IsNullOrEmpty(text)) strings.Add(text); }
        return strings.ToArray();
    }

    private static void WriteTextAtomic(string path, string content)
    {
        string directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporary, content, new UTF8Encoding(false));
        if (File.Exists(path)) File.Replace(temporary, path, null);
        else File.Move(temporary, path);
    }

    private static string FormatJson(string json)
    {
        StringBuilder formatted = new StringBuilder(json.Length + 128);
        bool quoted = false;
        bool escaped = false;
        int depth = 0;
        for (int index = 0; index < json.Length; index++)
        {
            char character = json[index];
            if (quoted)
            {
                formatted.Append(character);
                if (escaped) escaped = false;
                else if (character == '\\') escaped = true;
                else if (character == '"') quoted = false;
                continue;
            }
            if (character == '"') { quoted = true; formatted.Append(character); }
            else if (character == '{' || character == '[') { formatted.Append(character).AppendLine(); depth++; AppendJsonIndent(formatted, depth); }
            else if (character == '}' || character == ']') { formatted.AppendLine(); depth--; AppendJsonIndent(formatted, depth); formatted.Append(character); }
            else if (character == ',') { formatted.Append(character).AppendLine(); AppendJsonIndent(formatted, depth); }
            else if (character == ':') formatted.Append(": ");
            else if (!char.IsWhiteSpace(character)) formatted.Append(character);
        }
        formatted.AppendLine();
        return formatted.ToString();
    }

    private static void AppendJsonIndent(StringBuilder builder, int depth)
    {
        for (int index = 0; index < depth; index++) builder.Append("  ");
    }

    private bool ConfirmSetupSource(Dictionary<string, object> manifest, string trust)
    {
        string title = ResolveSetupName(manifest);
        Dictionary<string, object> source = GetDictionary(manifest, "source");
        string repository = source == null ? "unknown" : GetString(source, "repository");
        string commit = source == null ? "" : GetString(source, "commit");
        Dictionary<string, object> license = GetDictionary(manifest, "license");
        Dictionary<string, object> signature = GetDictionary(manifest, "signature");
        Dictionary<string, object> audit = GetDictionary(manifest, "audit");
        string licenseText = license == null ? "unknown" : GetString(license, "identifier") + " — " + GetString(license, "name");
        string signatureText = signature == null ? "unknown" : GetString(signature, "status");
        string auditText = audit == null ? "unknown" : GetString(audit, "status") + (string.IsNullOrEmpty(GetString(audit, "auditor")) ? "" : " — " + GetString(audit, "auditor"));
        string permissions = string.Join(", ", GetRawStringArray(manifest, "permissions"));
        string network = string.Join(", ", GetRawStringArray(manifest, "network"));
        string artifactHash = "";
        foreach (object value in GetArray(manifest, "artifacts") ?? new object[0])
        {
            Dictionary<string, object> artifact = value as Dictionary<string, object>;
            string hash = artifact == null ? "" : GetString(artifact, "sha256");
            if (IsHexDigest(hash, 64)) { artifactHash = hash; break; }
        }
        string message;
        if (_cfg.Language == "zh-CN")
        {
            message = "此 Setup 尚未达到 DSH Certified 等级。\r\n\r\n"
                + "名称：" + title + "\r\n"
                + "信任级别：" + trust + "\r\n"
                + "来源：" + repository + "\r\n"
                + "固定 Commit：" + (string.IsNullOrEmpty(commit) ? "未固定" : commit) + "\r\n"
                + "许可证：" + licenseText + "\r\n"
                + "签名：" + signatureText + "\r\n"
                + "审核：" + auditText + "\r\n"
                + "资产 SHA-256：" + (string.IsNullOrEmpty(artifactHash) ? "未声明" : artifactHash) + "\r\n"
                + "权限：" + (string.IsNullOrEmpty(permissions) ? "无" : permissions) + "\r\n"
                + "网络：" + (string.IsNullOrEmpty(network) ? "无" : network) + "\r\n\r\n"
                + "继续后，CLI 仍会重新验证清单、哈希和签名声明。是否继续？";
        }
        else
        {
            message = "This Setup is not DSH Certified.\r\n\r\n"
                + "Name: " + title + "\r\n"
                + "Trust: " + trust + "\r\n"
                + "Source: " + repository + "\r\n"
                + "Pinned commit: " + (string.IsNullOrEmpty(commit) ? "not pinned" : commit) + "\r\n"
                + "License: " + licenseText + "\r\n"
                + "Signature: " + signatureText + "\r\n"
                + "Audit: " + auditText + "\r\n"
                + "Artifact SHA-256: " + (string.IsNullOrEmpty(artifactHash) ? "not declared" : artifactHash) + "\r\n"
                + "Permissions: " + (string.IsNullOrEmpty(permissions) ? "none" : permissions) + "\r\n"
                + "Network: " + (string.IsNullOrEmpty(network) ? "none" : network) + "\r\n\r\n"
                + "The CLI will still revalidate the manifest, hashes, and signature claims. Continue?";
        }
        return MessageBox.Show(this, message, "DSH HUB — Setup source confirmation",
            MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    private async Task<string> InstallSetupManifestAsync(string manifestJson, string trust, string requestId, bool hubProgress)
    {
        string repo = FindRepo();
        string node = FindNode(repo);
        if (repo == null) throw new InvalidOperationException("DeepSeek Harness Runtime was not found.");
        if (node == null) throw new InvalidOperationException("The bundled Node.js runtime was not found.");
        bool sourceEntry;
        string bin = FindServerEntry(repo, out sourceEntry);
        if (bin == null) throw new InvalidOperationException("The DSH CLI entry is missing from the Runtime.");

        AppPaths.Ensure();
        string requestDirectory = Path.Combine(AppPaths.DataDir, "setup-requests");
        Directory.CreateDirectory(requestDirectory);
        string manifestPath = Path.Combine(requestDirectory, Guid.NewGuid().ToString("N") + ".setup.json");
        File.WriteAllText(manifestPath, manifestJson, new UTF8Encoding(false));

        Process setupProcess = null;
        ProcessJob setupJob = null;
        StringBuilder output = new StringBuilder();
        object outputLock = new object();
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = node;
            StringBuilder arguments = new StringBuilder();
            string runtimeResolver = FindRuntimeResolver(repo);
            if (runtimeResolver != null)
                arguments.Append(Quote("--import")).Append(" ").Append(Quote(new Uri(runtimeResolver).AbsoluteUri)).Append(" ");
            else if (File.Exists(Path.Combine(repo, "runtime-manifest.json")))
                throw new InvalidOperationException("The packaged Runtime resolver is missing. Reinstall or repair DeepSeek Harness.");
            if (sourceEntry)
                arguments.Append(Quote("--import")).Append(" ").Append(Quote("tsx/esm")).Append(" ");
            arguments.Append(Quote(bin)).Append(" ").Append(Quote("setup")).Append(" ")
                .Append(Quote("install")).Append(" ").Append(Quote(manifestPath));
            if (trust == "github-source") arguments.Append(" ").Append(Quote("--accept-source"));
            else if (trust == "unverified") arguments.Append(" ").Append(Quote("--accept-unverified"));

            psi.Arguments = arguments.ToString();
            psi.WorkingDirectory = repo;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["DSH_SETUP_PROGRESS"] = "jsonl";

            setupProcess = new Process();
            setupProcess.StartInfo = psi;
            setupProcess.EnableRaisingEvents = true;
            setupProcess.OutputDataReceived += delegate(object processSender, DataReceivedEventArgs args)
            {
                CaptureSetupOutput(args.Data, output, outputLock);
                if (args.Data != null && !TryPostSetupDownloadProgress(requestId, hubProgress, args.Data))
                    PostInstallProgress(requestId, hubProgress, "install", 58, "正在安装依赖并更新目标 Profile。", LimitDiagnosticText(args.Data, "working"));
            };
            setupProcess.ErrorDataReceived += delegate(object processSender, DataReceivedEventArgs args)
            {
                CaptureSetupOutput(args.Data, output, outputLock);
                if (args.Data != null)
                    PostInstallProgress(requestId, hubProgress, "install", 64, "安装引擎正在处理依赖。", LimitDiagnosticText(args.Data, "working"));
            };

            setupJob = new ProcessJob();
            _setupJob = setupJob;
            _setupProcess = setupProcess;
            AppendLog("Starting Setup installer through bundled CLI: " + node);
            AppendLog("Setup CLI arguments: " + arguments.ToString());
            PostInstallProgress(requestId, hubProgress, "download", hubProgress ? 48 : 24, "正在启动下载与安装引擎。", ResolveSetupName(new JavaScriptSerializer().DeserializeObject(manifestJson) as Dictionary<string, object>));
            setupProcess.Start();
            AppendLog("Setup process started: PID " + setupProcess.Id);
            setupJob.Assign(setupProcess);
            AppendLog("Setup process assigned to containment job");
            setupProcess.BeginOutputReadLine();
            setupProcess.BeginErrorReadLine();
            AppendLog("Setup output readers started");
            Task exitTask = Task.Run(delegate
            {
                while (!setupProcess.WaitForExit(1000)) { }
            });
            Task settled = await Task.WhenAny(exitTask, Task.Delay(TimeSpan.FromMinutes(10))).ConfigureAwait(false);
            if (!ReferenceEquals(settled, exitTask))
            {
                try { setupJob.Terminate(1460); }
                catch (Exception ex) { AppendLog("Setup timeout termination failed: " + ex.Message); }
                await Task.WhenAny(exitTask, Task.Delay(TimeSpan.FromSeconds(5))).ConfigureAwait(false);
                throw new TimeoutException("DSH Setup exceeded the 10 minute installation limit and was stopped.");
            }
            if (_setupCancellationRequested) throw new OperationCanceledException("Installation was cancelled.");
            await exitTask.ConfigureAwait(false);
            await Task.Delay(150).ConfigureAwait(false);
            try { setupProcess.CancelOutputRead(); } catch { }
            try { setupProcess.CancelErrorRead(); } catch { }
            int exitCode = setupProcess.ExitCode;
            string captured;
            lock (outputLock) captured = output.ToString().Trim();
            if (exitCode != 0)
            {
                string detail = LastSetupOutput(captured);
                throw new InvalidOperationException(string.IsNullOrEmpty(detail)
                    ? "DSH Setup exited with code " + exitCode
                    : detail);
            }
            return _cfg.Language == "zh-CN" ? "安装完成。" : "Installation completed.";
        }
        finally
        {
            if (ReferenceEquals(_setupProcess, setupProcess)) _setupProcess = null;
            if (ReferenceEquals(_setupJob, setupJob)) _setupJob = null;
            if (setupProcess != null) setupProcess.Dispose();
            if (setupJob != null) setupJob.Dispose();
            try { File.Delete(manifestPath); }
            catch (Exception ex) { AppendLog("Remove temporary Setup manifest failed: " + ex.Message); }
        }
    }

    private void CaptureSetupOutput(string line, StringBuilder output, object outputLock)
    {
        if (line == null) return;
        AppendLog("[SETUP] " + line);
        lock (outputLock)
        {
            output.AppendLine(line);
            if (output.Length > 32768) output.Remove(0, output.Length - 16384);
        }
    }

    private static string LastSetupOutput(string output)
    {
        if (string.IsNullOrWhiteSpace(output)) return "";
        string[] lines = output.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return "";
        if (lines.Length <= 14) return string.Join(Environment.NewLine, lines);
        return string.Join(Environment.NewLine, lines, 0, 5)
            + Environment.NewLine + "..."
            + Environment.NewLine + string.Join(Environment.NewLine, lines, lines.Length - 8, 8);
    }

    private bool TryPostSetupDownloadProgress(string requestId, bool hubProgress, string line)
    {
        if (string.IsNullOrEmpty(line) || !line.StartsWith(SetupProgressPrefix, StringComparison.Ordinal)) return false;
        try
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> value = serializer.DeserializeObject(line.Substring(SetupProgressPrefix.Length)) as Dictionary<string, object>;
            if (value == null || GetString(value, "stage") != "download") return true;
            long downloadedBytes = GetLong(value, "downloadedBytes");
            long totalBytes = GetLong(value, "totalBytes");
            int downloadPercent = totalBytes > 0
                ? (int)Math.Max(0, Math.Min(100, downloadedBytes * 100L / totalBytes))
                : 0;
            int overallPercent = 26 + 22 * downloadPercent / 100;
            string fileName = LimitDiagnosticText(GetString(value, "fileName"), "Setup artifact");
            bool cached = GetBoolean(value, "cached");
            string message = _cfg.Language == "zh-CN"
                ? cached ? "安装资产已在本机缓存中完成校验。" : "正在下载安装资产。"
                : cached ? "The installation artifact is already verified in the local cache." : "Downloading the installation artifact.";
            string detail = fileName + " · " + FormatByteCount(downloadedBytes)
                + (totalBytes > 0 ? " / " + FormatByteCount(totalBytes) : "");
            PostInstallProgress(requestId, hubProgress, "download", overallPercent, message, detail,
                downloadedBytes, totalBytes);
        }
        catch (Exception ex)
        {
            AppendLog("Ignored malformed Setup progress line: " + ex.Message);
        }
        return true;
    }

    private void PostInstallProgress(
        string requestId, bool hubProgress, string stage, int percent, string message, string detail)
    {
        PostInstallProgress(requestId, hubProgress, stage, percent, message, detail, -1, -1);
    }

    private void PostInstallProgress(
        string requestId, bool hubProgress, string stage, int percent, string message, string detail,
        long downloadedBytes, long totalBytes)
    {
        if (hubProgress)
            PostHubProgress(requestId, stage, percent, message, detail, downloadedBytes, totalBytes);
        else
            PostSetupProgress(requestId, stage, percent, message, detail, downloadedBytes, totalBytes);
    }

    private void PostSetupResult(string requestId, bool ok, string message)
    {
        if (InvokeRequired)
        {
            try { BeginInvoke((MethodInvoker)delegate { PostSetupResult(requestId, ok, message); }); }
            catch { }
            return;
        }
        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        string json = serializer.Serialize(new Dictionary<string, object>
        {
            { "type", "dsh-setup-result" },
            { "requestId", requestId },
            { "ok", ok },
            { "message", message }
        });
        _webView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void PostSetupProgress(string requestId, string stage, int percent, string message, string detail)
    {
        PostSetupProgress(requestId, stage, percent, message, detail, -1, -1);
    }

    private void PostSetupProgress(
        string requestId, string stage, int percent, string message, string detail,
        long downloadedBytes, long totalBytes)
    {
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    PostSetupProgress(requestId, stage, percent, message, detail, downloadedBytes, totalBytes);
                });
            }
            catch { }
            return;
        }
        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null) return;
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        Dictionary<string, object> progress = new Dictionary<string, object>
        {
            { "type", "dsh-setup-progress" }, { "requestId", requestId }, { "stage", stage },
            { "percent", Math.Max(0, Math.Min(100, percent)) }, { "message", message }, { "detail", detail },
            { "timestamp", DateTime.UtcNow.ToString("o") }
        };
        if (downloadedBytes >= 0) progress["downloadedBytes"] = downloadedBytes;
        if (totalBytes >= 0) progress["totalBytes"] = totalBytes;
        object[] manualDownloads = BuildManualDownloadPayload(requestId);
        if (manualDownloads.Length > 0) progress["manualDownloads"] = manualDownloads;
        _webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(progress));
    }

    private static string ClassifySetupTrust(Dictionary<string, object> manifest)
    {
        Dictionary<string, object> audit = GetDictionary(manifest, "audit");
        Dictionary<string, object> signature = GetDictionary(manifest, "signature");
        Dictionary<string, object> license = GetDictionary(manifest, "license");
        Dictionary<string, object> source = GetDictionary(manifest, "source");
        object redistributable;
        bool hasRedistributable = license != null && license.TryGetValue("redistributable", out redistributable)
            && redistributable is bool && (bool)redistributable;
        string commit = source == null ? "" : GetString(source, "commit");
        object artifactsValue;
        object[] artifacts = manifest.TryGetValue("artifacts", out artifactsValue) ? artifactsValue as object[] : null;
        bool certifiedArtifacts = artifacts != null && artifacts.Length > 0;
        if (certifiedArtifacts)
        {
            foreach (object artifactValue in artifacts)
            {
                Dictionary<string, object> artifact = artifactValue as Dictionary<string, object>;
                string kind = artifact == null ? "" : GetString(artifact, "kind");
                if (kind != "in-box" && !IsHexDigest(GetString(artifact, "sha256"), 64))
                {
                    certifiedArtifacts = false;
                    break;
                }
            }
        }
        if (audit != null && GetString(audit, "status") == "certified"
            && signature != null && GetString(signature, "status") == "valid"
            && hasRedistributable && IsHexDigest(commit, 40) && certifiedArtifacts)
            return "certified";

        string repository = source == null ? "" : GetString(source, "repository");
        Uri repositoryUri;
        if (Uri.TryCreate(repository, UriKind.Absolute, out repositoryUri)
            && string.Equals(repositoryUri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            return "github-source";
        return "unverified";
    }

    private static bool IsHexDigest(string value, int length)
    {
        if (string.IsNullOrEmpty(value) || value.Length != length) return false;
        foreach (char character in value)
        {
            bool digit = character >= '0' && character <= '9';
            bool lower = character >= 'a' && character <= 'f';
            bool upper = character >= 'A' && character <= 'F';
            if (!digit && !lower && !upper) return false;
        }
        return true;
    }

    private static Dictionary<string, object> GetDictionary(Dictionary<string, object> value, string key)
    {
        object nested;
        return value != null && value.TryGetValue(key, out nested) ? nested as Dictionary<string, object> : null;
    }

    private static string GetString(Dictionary<string, object> value, string key)
    {
        object nested;
        return value != null && value.TryGetValue(key, out nested) && nested is string ? (string)nested : "";
    }

    private static bool GetBoolean(Dictionary<string, object> value, string key)
    {
        object nested;
        return value != null && value.TryGetValue(key, out nested) && nested is bool && (bool)nested;
    }

    private static object[] GetArray(Dictionary<string, object> value, string key)
    {
        object nested;
        return value != null && value.TryGetValue(key, out nested) ? nested as object[] : null;
    }

    private static string[] GetStringArray(Dictionary<string, object> value, string key)
    {
        object[] values = GetArray(value, key);
        if (values == null || values.Length == 0) return new string[0];
        List<string> strings = new List<string>();
        foreach (object item in values)
        {
            string text = item as string;
            if (!string.IsNullOrEmpty(text)) strings.Add(LimitDiagnosticText(text, "unknown"));
        }
        return strings.ToArray();
    }

    private static bool FailuresArePendingOnly(object[] failures)
    {
        if (failures == null || failures.Length == 0) return false;
        foreach (object failureValue in failures)
        {
            Dictionary<string, object> failure = failureValue as Dictionary<string, object>;
            if (failure == null || GetString(failure, "state") != "pending") return false;
        }
        return true;
    }

    private static string LimitDiagnosticText(string value, string fallback)
    {
        string text = string.IsNullOrWhiteSpace(value) ? fallback : value;
        text = text.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return text.Length <= 240 ? text : text.Substring(0, 240) + "...";
    }

    private static string ResolveSetupName(Dictionary<string, object> manifest)
    {
        object name;
        if (!manifest.TryGetValue("name", out name)) return "Setup";
        string plain = name as string;
        if (!string.IsNullOrEmpty(plain)) return plain;
        Dictionary<string, object> localized = name as Dictionary<string, object>;
        if (localized == null) return "Setup";
        string chinese = GetString(localized, "zh");
        if (!string.IsNullOrEmpty(chinese)) return chinese;
        string fallback = GetString(localized, "default");
        return string.IsNullOrEmpty(fallback) ? "Setup" : fallback;
    }

    private void StopSetupInstaller()
    {
        ManualDownloadSession manual = GetActiveManualDownload();
        if (manual != null)
        {
            try { manual.OnlineCancellation.Cancel(); } catch { }
            manual.Imported.TrySetCanceled();
        }
        Process setupProcess = _setupProcess;
        ProcessJob setupJob = _setupJob;
        _setupProcess = null;
        _setupJob = null;
        try
        {
            if (setupJob != null) setupJob.Terminate(1);
        }
        catch (Exception ex)
        {
            AppendLog("Setup job termination failed: " + ex.Message);
        }
        if (setupProcess != null)
        {
            try
            {
                if (!setupProcess.HasExited) setupProcess.WaitForExit(5000);
            }
            catch { }
        }
        if (setupJob != null) setupJob.Dispose();
    }

    private void InjectHooks()
    {
        if (_webView.CoreWebView2 == null) return;
        if (!_hubMode)
        {
            _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildCssScript(DesktopMarketCompatibilityCss));
            _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(DesktopMarketCompatibilityMarkerScript);
            AppendLog("Registered Desktop plugin layout compatibility hooks");
        }
        if (!string.IsNullOrEmpty(_cfg.InjectJs))
        {
            try
            {
                string js = File.ReadAllText(_cfg.InjectJs, Encoding.UTF8);
                _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(js);
                AppendLog("Injected JS: " + _cfg.InjectJs);
            }
            catch (Exception ex)
            {
                AppendLog("Inject JS failed: " + ex.Message);
            }
        }
        if (!string.IsNullOrEmpty(_cfg.InjectCss))
        {
            try
            {
                string css = File.ReadAllText(_cfg.InjectCss, Encoding.UTF8);
                _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildCssScript(css));
                AppendLog("Injected CSS: " + _cfg.InjectCss);
            }
            catch (Exception ex)
            {
                AppendLog("Inject CSS failed: " + ex.Message);
            }
        }
    }

    private static string BuildCssScript(string css)
    {
        string escaped = css.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        return "(function(){var add=function(){var target=document.head||document.documentElement;if(!target)return;var s=document.createElement('style');s.type='text/css';s.appendChild(document.createTextNode(\""
            + escaped + "\"));target.appendChild(s);};if(document.head||document.readyState!=='loading')add();else document.addEventListener('DOMContentLoaded',add,{once:true});})();";
    }

    private void OnWebKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == _toolbarKey && e.Modifiers == _toolbarMods)
        {
            ToggleToolbarSticky();
            e.Handled = true;
            e.SuppressKeyPress = true;
        }
        else if (e.KeyCode == _fullscreenKey && e.Modifiers == _fullscreenMods)
        {
            ToggleFullscreen();
            e.Handled = true;
            e.SuppressKeyPress = true;
        }
        else if (e.KeyCode == Keys.F12)
        {
            if (_cfg.DevTools)
            {
                try { _webView.CoreWebView2.OpenDevToolsWindow(); }
                catch { }
                e.Handled = true;
                e.SuppressKeyPress = true;
            }
        }
        else if (e.KeyCode == Keys.Escape)
        {
            if (_fullscreen)
            {
                ToggleFullscreen();
                e.Handled = true;
                e.SuppressKeyPress = true;
            }
        }
    }

    private static bool TryParseHotkey(string text, out Keys key, out Keys modifiers)
    {
        key = Keys.None;
        modifiers = Keys.None;
        if (string.IsNullOrWhiteSpace(text)) return false;
        string[] parts = text.Trim().Split(new char[] { '\n' });
        string last = parts[parts.Length - 1].Trim();
        for (int i = 0; i < parts.Length - 1; i++)
        {
            string part = parts[i].Trim().ToLowerInvariant();
            if (part == "ctrl" || part == "control") modifiers |= Keys.Control;
            else if (part == "alt") modifiers |= Keys.Alt;
            else if (part == "shift") modifiers |= Keys.Shift;
            else return false;
        }
        try
        {
            key = (Keys)Enum.Parse(typeof(Keys), last, true);
        }
        catch
        {
            return false;
        }
        if (key == Keys.None) return false;
        return true;
    }

    private void ShowRuntimeError()
    {
        if (_runtimeErrorShown || _exitRequested || _shuttingDown || IsDisposed || Disposing) return;
        _runtimeErrorShown = true;
        MessageBox.Show(this,
            "The embedded web UI requires the Microsoft Edge WebView2 runtime." + Environment.NewLine +
            "If it is missing, install it manually and restart this app." + Environment.NewLine +
            "No browser page will be opened automatically.",
            "DeepSeek Harness", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private void BeginServerStart()
    {
        if (_serviceStartWaiting) return;
        if (_proc != null && !_proc.HasExited)
        {
            AppendLog("Server already running");
            return;
        }
        _serviceStartWaiting = true;
        SetLoadingStage("Coordinating local service startup", 18F);
        SetStatus("Waiting for local service startup slot", Color.FromArgb(180, 130, 20));
        SetButtons();
        string gatePath = Path.Combine(AppPaths.DataDir, "service-start.lock");
        ThreadPool.QueueUserWorkItem(delegate
        {
            FileStream gate = null;
            Exception lastError = null;
            DateTime deadline = DateTime.UtcNow.AddSeconds(120);
            while (!_exitRequested && DateTime.UtcNow < deadline)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(gatePath));
                    gate = new FileStream(gatePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                    break;
                }
                catch (IOException ex)
                {
                    lastError = ex;
                    Thread.Sleep(100);
                }
                catch (UnauthorizedAccessException ex)
                {
                    lastError = ex;
                    break;
                }
            }
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    _serviceStartWaiting = false;
                    if (_exitRequested || IsDisposed)
                    {
                        if (gate != null) gate.Dispose();
                        return;
                    }
                    if (gate == null)
                    {
                        string detail = lastError == null ? "timed out" : lastError.Message;
                        Fail("Could not coordinate local service startup: " + detail);
                        return;
                    }
                    _serviceStartGate = gate;
                    StartServer();
                });
            }
            catch
            {
                if (gate != null) gate.Dispose();
            }
        });
    }

    private void ReleaseServiceStartGate()
    {
        FileStream gate = _serviceStartGate;
        _serviceStartGate = null;
        if (gate == null) return;
        try { gate.Dispose(); }
        catch { }
    }

    private void StartServer()
    {
        if (_proc != null && !_proc.HasExited)
        {
            AppendLog("Server already running");
            ReleaseServiceStartGate();
            return;
        }

        SetLoadingStage("Starting local service", 20F);
        bool preserveRecoveryCount = _preserveWebUiServiceRecoveryCount;
        _preserveWebUiServiceRecoveryCount = false;
        _serviceReady = false;
        _webUiVerified = false;
        _webUiBootTerminal = false;
        _webUiRetryCount = 0;
        if (!preserveRecoveryCount) _webUiServiceRecoveryCount = 0;
        _webUiBootStartedUtc = DateTime.MinValue;
        _webUiBootLastActivityUtc = DateTime.MinValue;
        _webUiBootStage = "waiting for navigation";
        _activeNavigationId = 0;
        _activePort = _cfg.Port;
        _activeUrl = _cfg.Url;
        if (_hubMode)
        {
            _activePort = FindAvailableLoopbackPort();
            if (_activePort <= 0)
            {
                Fail("DSH HUB could not reserve an isolated local service port.");
                return;
            }
            _activeUrl = BuildUrlForPort(_cfg.Url, _activePort);
            SetStatus("HUB isolated service port " + _activePort, Color.FromArgb(180, 130, 20));
            AppendLog("DSH HUB reserved isolated local service port " + _activePort
                + "; the configured Desktop port " + _cfg.Port + " remains exclusive to dsh.exe");
        }
        else if (IsPortOpen(_activePort))
        {
            int occupiedPort = _activePort;
            _activePort = FindAvailableLoopbackPort();
            if (_activePort <= 0)
            {
                Fail("Port " + occupiedPort + " is already in use and no free local port could be reserved.");
                return;
            }
            _activeUrl = BuildUrlForPort(_cfg.Url, _activePort);
            SetStatus("Port " + occupiedPort + " occupied - using " + _activePort, Color.FromArgb(180, 130, 20));
            AppendLog("Port " + occupiedPort + " is occupied by another service; starting an isolated desktop service on " + _activePort);
        }
        _navigationUrl = BuildNavigationUrl(_activeUrl, _hubMode, _hubConfig, out _desktopBootId);

        string repo = FindRepo();
        string node = FindNode(repo);
        if (repo == null)
        {
            Fail("deepseek-harness project folder not found. Set RepoPath in the Config app.");
            return;
        }
        if (node == null)
        {
            Fail("Node.js not found. Install Node.js 22.19+ or set NodePath in the Config app.");
            return;
        }
        SetLoadingStage("Preparing JavaScript runtime", 31F);
        bool sourceEntry;
        string bin = FindServerEntry(repo, out sourceEntry);
        if (bin == null)
        {
            Fail("CLI entry missing in " + repo + ". Install a Windows Runtime or run 'pnpm install && pnpm run build'.");
            return;
        }

        AppendLog("Starting server (" + node + ") ...");
        AppendLog("Working dir: " + repo);
        SetStatus("Starting...", Color.FromArgb(180, 130, 20));
        SetLoadingStage("Launching local Web UI", 46F);

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = node;
        StringBuilder arguments = new StringBuilder();
        string runtimeResolver = FindRuntimeResolver(repo);
        if (runtimeResolver != null)
        {
            arguments.Append(Quote("--import")).Append(" ").Append(Quote(new Uri(runtimeResolver).AbsoluteUri)).Append(" ");
        }
        else if (File.Exists(Path.Combine(repo, "runtime-manifest.json")))
        {
            Fail("The packaged Runtime resolver is missing. Reinstall or repair DeepSeek Harness.");
            return;
        }
        if (sourceEntry)
        {
            arguments.Append(Quote("--import")).Append(" ").Append(Quote("tsx/esm")).Append(" ");
        }
        arguments.Append(Quote(bin)).Append(" ").Append(Quote("web"));
        string desktopPatch = EnsureDesktopWebPatch();
        if (string.IsNullOrEmpty(desktopPatch))
        {
            Fail("The desktop Web UI patch could not be created. The native Node.js directory picker will not be used as a fallback.");
            return;
        }
        arguments.Append(" ").Append(Quote("--patch")).Append(" ").Append(Quote(desktopPatch));
        arguments.Append(" ").Append(Quote("--port")).Append(" ").Append(_activePort.ToString());
        psi.Arguments = arguments.ToString();
        psi.WorkingDirectory = repo;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        string desktopHome = AppPaths.DshHome;
        Directory.CreateDirectory(desktopHome);
        psi.EnvironmentVariables["DSH_HOME"] = desktopHome;
        if (_hubMode && !_hubConfig.AllowDesktopPlugins)
        {
            string isolatedHubHome = Path.Combine(HubRoot, "runtime-home");
            Directory.CreateDirectory(isolatedHubHome);
            psi.EnvironmentVariables["DSH_HOME"] = isolatedHubHome;
            AppendLog("DSH HUB is using isolated Web Profile home: " + isolatedHubHome);
        }
        else if (_hubMode)
        {
            AppendLog("DSH HUB is sharing the Desktop Web Profile by explicit CONFIG opt-in");
        }
        else
        {
            AppendLog("Desktop is using Web Profile home: " + desktopHome);
        }

        Process serverProcess = new Process();
        _proc = serverProcess;
        serverProcess.StartInfo = psi;
        serverProcess.EnableRaisingEvents = true;
        serverProcess.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { OnOutput(e.Data); };
        serverProcess.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { OnOutput(e.Data); };
        serverProcess.Exited += delegate
        {
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (_shuttingDown || !ReferenceEquals(_proc, serverProcess)) return;
                    int exitCode = serverProcess.ExitCode;
                    _proc = null;
                    _serviceReady = false;
                    ReleaseServiceStartGate();
                    SetStatus("Stopped", Color.FromArgb(150, 60, 60));
                    AppendLog("Server process exited, code " + exitCode);
                    if (_loadingOverlay != null)
                        _loadingOverlay.ShowError("Local service exited (code " + exitCode + ") — open the toolbar log");
                    CompleteHostedServiceRestart();
                    serverProcess.Dispose();
                    SetButtons();
                });
            }
            catch
            {
            }
        };
        try
        {
            if (_serverJob == null) _serverJob = new ProcessJob();
            serverProcess.Start();
            AppendLog("Local service process started: PID " + serverProcess.Id);
            try
            {
                _serverJob.Assign(serverProcess);
                AppendLog("Local service process assigned to containment job");
            }
            catch (Win32Exception ex)
            {
                if (ex.NativeErrorCode != 5) throw;
                AppendLog("Local service containment skipped after inherited Job access denial; explicit shutdown cleanup remains active");
            }
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();
            SetLoadingStage("Waiting for local service", 56F);
        }
        catch (Exception ex)
        {
            try
            {
                if (!serverProcess.HasExited) serverProcess.Kill();
                serverProcess.WaitForExit(5000);
            }
            catch
            {
            }
            serverProcess.Dispose();
            _proc = null;
            ReleaseServiceStartGate();
            Fail("Start failed: " + ex.Message);
            return;
        }

        SetButtons();

        int watchedPort = _activePort;
        Thread watcher = new Thread(new ThreadStart(delegate { WatchStartup(watchedPort); }));
        watcher.IsBackground = true;
        watcher.Start();
    }

    private void WatchStartup(int port)
    {
        bool portObserved = false;
        for (int i = 0; i < 180; i++)
        {
            if (_shuttingDown) return;
            if (_proc == null || _proc.HasExited) return;
            if (_serviceReady) return;
            if (!portObserved && IsPortOpen(port))
            {
                portObserved = true;
                BeginInvoke((MethodInvoker)delegate
                {
                    if (_serviceReady) return;
                    SetLoadingStage("Finalizing plugin graph", 68F);
                    SetStatus("Local service started - loading plugins", Color.FromArgb(180, 130, 20));
                    SetButtons();
                });
            }
            Thread.Sleep(500);
        }
        BeginInvoke((MethodInvoker)delegate
        {
            if (_serviceReady) return;
            ReleaseServiceStartGate();
            SetStatus("Startup timeout - check log", Color.FromArgb(190, 60, 60));
            AppendLog("Waited 90s for the plugin graph to settle on port " + port + ". Open the log panel for details.");
            if (_loadingOverlay != null) _loadingOverlay.ShowError("Local service startup timed out");
            CompleteHostedServiceRestart();
            SetButtons();
        });
    }

    private void MaybeNavigate()
    {
        if (_coreReady && _serviceReady && _webView.CoreWebView2 != null)
        {
            PrepareWebViewBehindLoadingOverlay();
            SetLoadingStage("Rendering interface", 88F);
            try
            {
                string current = _webView.CoreWebView2.Source;
                if (current != _navigationUrl) _webView.CoreWebView2.Navigate(_navigationUrl);
            }
            catch
            {
                try { _webView.CoreWebView2.Navigate(_navigationUrl); }
                catch { }
            }
        }
    }

    private void PrepareWebViewBehindLoadingOverlay()
    {
        if (_webView == null || _webView.IsDisposed) return;
        _webView.Visible = true;
        if (_loadingOverlay != null && _loadingOverlay.Visible) _loadingOverlay.BringToFront();
        if (_logPanel.Visible) _logPanel.BringToFront();
        if (_toolbarTargetVisible || _toolPanel.Top > -_toolPanel.Height) _toolPanel.BringToFront();
        if (_restartOverlay != null && _restartOverlay.Visible) _restartOverlay.BringToFront();
    }

    private async void WaitForWebUiBootStatus(string bootId)
    {
        int idleTimeout = _webUiRetryCount > 0
            ? WebUiRetryStatusIdleTimeoutMilliseconds
            : WebUiStatusIdleTimeoutMilliseconds;
        int hardTimeout = _webUiRetryCount > 0
            ? WebUiRetryStatusHardTimeoutMilliseconds
            : WebUiStatusHardTimeoutMilliseconds;
        DateTime started = _webUiBootStartedUtc == DateTime.MinValue ? DateTime.UtcNow : _webUiBootStartedUtc;
        if (_webUiBootLastActivityUtc == DateTime.MinValue) _webUiBootLastActivityUtc = started;
        while (true)
        {
            await Task.Delay(1000);
            if (_exitRequested || _shuttingDown || !_serviceReady || _webUiVerified || _webUiBootTerminal) return;
            if (!string.Equals(bootId, _desktopBootId, StringComparison.Ordinal)) return;
            DateTime now = DateTime.UtcNow;
            if ((now - started).TotalMilliseconds >= hardTimeout) break;
            if ((now - _webUiBootLastActivityUtc).TotalMilliseconds >= idleTimeout) break;
        }
        DateTime timedOutAt = DateTime.UtcNow;
        bool hardLimit = (timedOutAt - started).TotalMilliseconds >= hardTimeout;
        string reason = hardLimit
            ? "Web UI boot did not settle within the " + hardTimeout + " ms hard limit; last stage: " + _webUiBootStage
            : "Web UI boot reported no progress for " + idleTimeout + " ms; last stage: " + _webUiBootStage;
        if (TryRecoverWebUiService(reason)) return;
        _webUiBootTerminal = true;
        AppendLog("Web UI boot status timed out: " + reason);
        SetStatus("Plugin startup timeout - check log", Color.FromArgb(190, 60, 60));
        if (_loadingOverlay != null) _loadingOverlay.ShowError("Plugin startup verification timed out");
        CompleteHostedServiceRestart();
    }

    private bool TryRecoverWebUiService(string reason)
    {
        if (_webUiServiceRecoveryCount >= MaxWebUiServiceRecoveries || _exitRequested || _shuttingDown || !_serviceReady)
            return false;
        _webUiServiceRecoveryCount++;
        _preserveWebUiServiceRecoveryCount = true;
        _webUiVerified = false;
        _webUiBootTerminal = false;
        _webUiRetryCount = 0;
        _activeNavigationId = 0;
        string detail = LimitDiagnosticText(reason, "plugin activation did not settle");
        SetLoadingStage("Recovering Web UI plugin activation", 96F);
        return RestartHostedService(
            "Restarting local service once to recover Web UI plugin activation: " + detail,
            "Restarting local service to recover plugins");
    }

    private static bool IsRecoverableWebUiAssetFailure(string reason)
    {
        if (string.IsNullOrEmpty(reason)) return false;
        bool loaderFailure = reason.IndexOf("failed to import loader entry", StringComparison.OrdinalIgnoreCase) >= 0;
        bool clientFailure = reason.IndexOf("client-modules", StringComparison.OrdinalIgnoreCase) >= 0
            || reason.IndexOf("bundle script", StringComparison.OrdinalIgnoreCase) >= 0;
        bool loadFailure = reason.IndexOf("failed to load", StringComparison.OrdinalIgnoreCase) >= 0;
        return loaderFailure && clientFailure && loadFailure;
    }

    private bool TryRecoverWebUiAssetFailure(string reason)
    {
        if (_webUiServiceRecoveryCount >= MaxWebUiServiceRecoveries || _exitRequested || _shuttingDown || !_serviceReady)
            return false;
        _webUiServiceRecoveryCount++;
        _preserveWebUiServiceRecoveryCount = true;
        _webUiVerified = false;
        _webUiBootTerminal = false;
        _webUiRetryCount = 0;
        _activeNavigationId = 0;
        string detail = LimitDiagnosticText(reason, "stale plugin client assets");
        SetLoadingStage("Refreshing Web UI plugin assets", 96F);
        bool started = RestartHostedService(
            "Refreshing WebView plugin caches after a client bundle load failure: " + detail,
            "Refreshing plugin assets",
            true);
        if (!started)
        {
            _webUiServiceRecoveryCount--;
            _preserveWebUiServiceRecoveryCount = false;
        }
        return started;
    }

    private void RefreshPage()
    {
        if (_coreReady && _serviceReady && _webView.CoreWebView2 != null)
        {
            _webUiVerified = false;
            _webUiBootTerminal = false;
            _webUiRetryCount = 0;
            _webUiServiceRecoveryCount = 0;
            _preserveWebUiServiceRecoveryCount = false;
            _activeNavigationId = 0;
            _navigationUrl = BuildNavigationUrl(_activeUrl, _hubMode, _hubConfig, out _desktopBootId);
            _webView.CoreWebView2.Navigate(_navigationUrl);
        }
        else
        {
            AppendLog("Service not ready yet");
        }
    }

    private void RestartDesktopServiceAfterSetup()
    {
        if (_hubMode || _exitRequested || IsDisposed) return;
        _webUiServiceRecoveryCount = 0;
        _preserveWebUiServiceRecoveryCount = false;
        SetLoadingStage("Reloading installed plugins", 28F);
        RestartHostedService(
            "Reload requested after HUB installation; restarting the Desktop service",
            "Reloading installed plugins",
            true);
    }

    private bool RestartHostedService(string logMessage, string statusMessage, bool clearPluginAssets = false)
    {
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke((MethodInvoker)delegate { RestartHostedService(logMessage, statusMessage, clearPluginAssets); });
                return true;
            }
            catch
            {
                return false;
            }
        }
        if (_restartInProgress || _exitRequested || IsDisposed || Disposing) return false;
        _restartInProgress = true;
        _webUiVerified = false;
        _webUiBootTerminal = false;
        _webUiRetryCount = 0;
        _activeNavigationId = 0;
        AppendLog(logMessage);
        SetStatus(statusMessage, Color.FromArgb(180, 130, 20));
        if (_restartOverlay != null) _restartOverlay.ShowRestarting();
        if (clearPluginAssets) ClearWebUiPluginAssetsAndQueueRestart();
        else QueueHostedServiceRestart();
        return true;
    }

    private async void ClearWebUiPluginAssetsAndQueueRestart()
    {
        try
        {
            if (_webView != null && !_webView.IsDisposed && _webView.CoreWebView2 != null)
            {
                try { _webView.CoreWebView2.Navigate("about:blank"); }
                catch { }
                CoreWebView2BrowsingDataKinds kinds = CoreWebView2BrowsingDataKinds.DiskCache
                    | CoreWebView2BrowsingDataKinds.CacheStorage
                    | CoreWebView2BrowsingDataKinds.ServiceWorkers;
                await _webView.CoreWebView2.Profile.ClearBrowsingDataAsync(kinds);
                AppendLog("Cleared WebView plugin cache, cache storage, and service workers before restart");
            }
        }
        catch (Exception ex)
        {
            AppendLog("WebView plugin cache cleanup failed; continuing with service restart: " + ex.Message);
        }
        if (_exitRequested || IsDisposed || Disposing)
        {
            CompleteHostedServiceRestart();
            return;
        }
        QueueHostedServiceRestart();
    }

    private void QueueHostedServiceRestart()
    {
        ThreadPool.QueueUserWorkItem(delegate
        {
            StopServer();
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (_exitRequested || IsDisposed || Disposing)
                    {
                        CompleteHostedServiceRestart();
                        return;
                    }
                    BeginServerStart();
                });
            }
            catch
            {
            }
        });
    }

    private void CompleteHostedServiceRestart()
    {
        if (InvokeRequired)
        {
            try { BeginInvoke((MethodInvoker)CompleteHostedServiceRestart); }
            catch { }
            return;
        }
        if (!_restartInProgress) return;
        _restartInProgress = false;
        if (_restartOverlay != null) _restartOverlay.HideRestarting();
    }

    private void OpenInBrowser()
    {
        if (!IsPortOpen(_activePort))
        {
            AppendLog("Service not ready yet");
            return;
        }
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(_activeUrl);
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            AppendLog("Open browser failed: " + ex.Message);
        }
    }

    private void OpenConfigApp()
    {
        string path = Path.Combine(AppPaths.ExeDir, "dsh-config.exe");
        try
        {
            if (File.Exists(path))
            {
                ProcessStartInfo psi = new ProcessStartInfo(path);
                psi.WorkingDirectory = AppPaths.ExeDir;
                if (_hubMode) psi.Arguments = "--hub";
                Process.Start(psi);
            }
            else
            {
                AppendLog("dsh-config.exe not found next to dsh.exe");
            }
        }
        catch (Exception ex)
        {
            AppendLog("Open config failed: " + ex.Message);
        }
    }

    private void OpenCompanionApp()
    {
        if (_hubMode) OpenMainApp();
        else OpenHubApp();
    }

    private void OpenHubApp()
    {
        OpenSiblingApp("dsh-hub.exe", "HUB");
    }

    private void OpenMainApp()
    {
        OpenSiblingApp("dsh.exe", "DSH");
    }

    private bool RequestDesktopReload()
    {
        return OpenSiblingApp("dsh.exe", "DSH", "--reload-silent");
    }

    private bool OpenSiblingApp(string executableName, string displayName, string arguments = "--activate-silent")
    {
        string path = Path.Combine(AppPaths.ExeDir, executableName);
        try
        {
            if (!File.Exists(path))
            {
                string missing = executableName + " not found next to " + Path.GetFileName(Application.ExecutablePath);
                AppendLog(missing);
                MessageBox.Show(this, missing, ProductDisplayName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            ProcessStartInfo psi = new ProcessStartInfo(path);
            psi.WorkingDirectory = AppPaths.ExeDir;
            psi.UseShellExecute = true;
            psi.Arguments = arguments;
            Process process = Process.Start(psi);
            ActivateExternalProcess(process);
            AppendLog("Opened independent " + displayName + " process");
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("Open " + displayName + " failed: " + ex.Message);
            MessageBox.Show(this, "Unable to open " + displayName + ".\r\n" + ex.Message,
                ProductDisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
    }

    private void ActivateExternalProcess(Process process)
    {
        if (process == null) return;
        try { AllowSetForegroundWindow(process.Id); }
        catch { }
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                try { process.WaitForInputIdle(10000); }
                catch { }
                for (int attempt = 0; attempt < 100; attempt++)
                {
                    if (process.HasExited) return;
                    process.Refresh();
                    IntPtr window = process.MainWindowHandle;
                    if (window != IntPtr.Zero)
                    {
                        try
                        {
                            BeginInvoke((MethodInvoker)delegate
                            {
                                if (_exitRequested || IsDisposed || Disposing) return;
                                RaiseWindowToForeground(window);
                            });
                        }
                        catch
                        {
                        }
                        return;
                    }
                    Thread.Sleep(100);
                }
            }
            catch
            {
            }
            finally
            {
                process.Dispose();
            }
        });
    }

    private void ToggleLog()
    {
        _logPanel.Visible = !_logPanel.Visible;
    }
    private void StopServer()
    {
        Process serverProcess = _proc;
        _proc = null;
        bool hadRunningServer = false;
        try
        {
            hadRunningServer = serverProcess != null && !serverProcess.HasExited;
        }
        catch
        {
        }

        if (hadRunningServer)
        {
            AppendLog("Stopping server...");
        }

        _shuttingDown = true;
        try
        {
            _serviceStartWaiting = false;
            ReleaseServiceStartGate();
            ProcessJob serverJob = _serverJob;
            _serverJob = null;
            try
            {
                if (serverJob != null) serverJob.Terminate(1);
            }
            catch (Exception ex)
            {
                AppendLog("Job termination failed: " + ex.Message);
            }
            finally
            {
                if (serverJob != null) serverJob.Dispose();
            }

            if (serverProcess != null)
            {
                try
                {
                    if (!serverProcess.HasExited && !serverProcess.WaitForExit(8000))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = "taskkill.exe";
                        psi.Arguments = "/PID " + serverProcess.Id + " /T /F";
                        psi.UseShellExecute = false;
                        psi.CreateNoWindow = true;
                        using (Process killer = Process.Start(psi))
                        {
                            if (killer != null) killer.WaitForExit(5000);
                        }
                        serverProcess.WaitForExit(5000);
                    }
                }
                catch
                {
                    try
                    {
                        if (!serverProcess.HasExited) serverProcess.Kill();
                        serverProcess.WaitForExit(5000);
                    }
                    catch
                    {
                    }
                }
                serverProcess.Dispose();
            }

            if (hadRunningServer && _activePort > 0)
            {
                if (WaitForPortToClose(_activePort, 5000))
                    AppendLog("Released local service port " + _activePort);
                else
                    AppendLog("Local service port " + _activePort + " remained occupied after shutdown");
            }

            _serviceReady = false;
            SetStatus("Stopped", Color.FromArgb(150, 60, 60));
            if (hadRunningServer) AppendLog("Server stopped");
            SetButtons();
        }
        finally
        {
            _shuttingDown = false;
        }
    }

    private void OnOutput(string line)
    {
        if (line == null) return;
        AppendLog(line);
        const string marker = "dsh web: ";
        int markerIndex = line.IndexOf(marker, StringComparison.Ordinal);
        if (markerIndex < 0) return;
        int start = markerIndex + marker.Length;
        int end = line.IndexOf(' ', start);
        string reportedUrl = end < 0 ? line.Substring(start) : line.Substring(start, end - start);
        Uri reported;
        if (!Uri.TryCreate(reportedUrl, UriKind.Absolute, out reported)) return;
        if (!reported.IsLoopback || reported.Port != _activePort) return;
        try
        {
            BeginInvoke((MethodInvoker)delegate
            {
                if (_serviceReady || _proc == null || _proc.HasExited || reported.Port != _activePort) return;
                _serviceReady = true;
                ReleaseServiceStartGate();
                SetLoadingStage("Connecting to Web UI", 74F);
                SetStatus("Service running", Color.FromArgb(34, 139, 74));
                AppendLog("Plugin graph ready: " + reportedUrl);
                MaybeNavigate();
                SetButtons();
            });
        }
        catch
        {
        }
    }

    private void AppendLog(string text)
    {
        if (_logBox != null && _logBox.InvokeRequired)
        {
            try { _logBox.BeginInvoke((MethodInvoker)delegate { AppendLog(text); }); }
            catch { }
            return;
        }
        string stamp = DateTime.Now.ToString("HH:mm:ss");
        string line = "[" + stamp + "] " + text;
        if (_logBox != null)
        {
            if (_logBox.Text.Length > 60000)
            {
                _logBox.Text = _logBox.Text.Substring(_logBox.Text.Length - 30000);
            }
            _logBox.AppendText(line + Environment.NewLine);
        }
        try
        {
            AppPaths.Ensure();
            File.AppendAllText(Path.Combine(AppPaths.LogDir, "app.log"), line + Environment.NewLine, Encoding.UTF8);
        }
        catch
        {
        }
    }

    private void SetStatus(string text, Color color)
    {
        if (_statusText == null) return;
        if (_statusText.InvokeRequired)
        {
            try { _statusText.BeginInvoke((MethodInvoker)delegate { SetStatus(text, color); }); }
            catch { }
            return;
        }
        _statusText.Text = text;
        _statusText.ForeColor = color;
    }

    private void Fail(string message)
    {
        ReleaseServiceStartGate();
        SetStatus("Startup failed", Color.FromArgb(190, 60, 60));
        AppendLog(message);
        if (_loadingOverlay != null) _loadingOverlay.ShowError("Startup failed — open Config or the toolbar log");
        CompleteHostedServiceRestart();
        MessageBox.Show(this, message, ProductDisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        SetButtons();
    }

    private void SetButtons()
    {
        if (InvokeRequired)
        {
            try { BeginInvoke((MethodInvoker)SetButtons); }
            catch { }
            return;
        }
        if (_startButton == null || _stopButton == null || _refreshButton == null || _openBrowserButton == null) return;
        bool running = _proc != null && !_proc.HasExited;
        bool portOpen = IsPortOpen(_activePort);
        _startButton.Enabled = !_serviceStartWaiting && !running && !portOpen;
        _stopButton.Enabled = running;
        _refreshButton.Enabled = portOpen && _coreReady;
        _openBrowserButton.Enabled = portOpen;
    }

    private static bool IsPortOpen(int port)
    {
        TcpClient client = new TcpClient();
        try
        {
            IAsyncResult ar = client.BeginConnect("127.0.0.1", port, null, null);
            bool done = ar.AsyncWaitHandle.WaitOne(800);
            if (!done) return false;
            client.EndConnect(ar);
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            try { client.Close(); }
            catch { }
        }
    }

    private static bool WaitForPortToClose(int port, int timeoutMilliseconds)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            if (!IsPortOpen(port)) return true;
            Thread.Sleep(100);
        }
        return !IsPortOpen(port);
    }

    private static int FindAvailableLoopbackPort()
    {
        TcpListener listener = null;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        catch
        {
            return 0;
        }
        finally
        {
            if (listener != null)
            {
                try { listener.Stop(); }
                catch { }
            }
        }
    }

    private static string BuildUrlForPort(string configuredUrl, int port)
    {
        Uri configured;
        if (Uri.TryCreate(configuredUrl, UriKind.Absolute, out configured))
        {
            UriBuilder builder = new UriBuilder(configured);
            builder.Port = port;
            return builder.Uri.AbsoluteUri;
        }
        return "http://127.0.0.1:" + port;
    }

    private static string BuildNavigationUrl(string serviceUrl, bool hubMode, HubConfig hubConfig, out string bootId)
    {
        bootId = Guid.NewGuid().ToString("N");
        string hubToken = "";
        if (hubMode)
        {
            HubConfig resolved = hubConfig ?? new HubConfig();
            hubToken = "dshSurface=hub"
                + "&dshHubTheme=" + Uri.EscapeDataString(resolved.Theme)
                + "&dshHubStart=" + Uri.EscapeDataString(resolved.StartPage)
                + "&dshHubDiscovery=" + Uri.EscapeDataString(resolved.DiscoverySource)
                + "&dshHubPageSize=" + resolved.PageSize
                + "&dshHubDetailEntry=" + Uri.EscapeDataString(resolved.DetailEntry)
                + "&dshHubDetailMode=" + Uri.EscapeDataString(resolved.DetailMode)
                + "&dshHubDetailContent=" + Uri.EscapeDataString(resolved.DetailContent)
                + "&";
        }
        Uri configured;
        if (Uri.TryCreate(serviceUrl, UriKind.Absolute, out configured))
        {
            UriBuilder builder = new UriBuilder(configured);
            string query = builder.Query.TrimStart('?');
            string token = hubToken + "desktopBoot=" + bootId;
            builder.Query = string.IsNullOrEmpty(query) ? token : query + "&" + token;
            return builder.Uri.AbsoluteUri;
        }
        return serviceUrl + (serviceUrl.IndexOf('?') >= 0 ? "&" : "?")
            + hubToken + "desktopBoot=" + bootId;
    }

    private string ProductDisplayName
    {
        get { return _hubMode ? "HUB" : "DSH"; }
    }

    private string CompanionDisplayName
    {
        get { return _hubMode ? "DSH" : "HUB"; }
    }

    private string FindRepo()
    {
        if (!string.IsNullOrEmpty(_cfg.RepoPath))
        {
            if (HasServerEntry(_cfg.RepoPath)) return Path.GetFullPath(_cfg.RepoPath);
        }
        string exeDir = AppPaths.ExeDir;
        string bundledRuntime = Path.Combine(exeDir, "runtime");
        if (HasServerEntry(bundledRuntime)) return Path.GetFullPath(bundledRuntime);
        if (HasServerEntry(exeDir)) return Path.GetFullPath(exeDir);
        foreach (string candidate in GetDevelopmentRepositoryCandidates(exeDir))
        {
            if (HasServerEntry(candidate)) return Path.GetFullPath(candidate);
        }
        return null;
    }

    private static IEnumerable<string> GetDevelopmentRepositoryCandidates(string exeDir)
    {
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string current = exeDir;
        for (int depth = 0; depth < 6 && !string.IsNullOrEmpty(current); depth++)
        {
            if (seen.Add(current)) yield return current;
            DirectoryInfo parent = Directory.GetParent(current);
            current = parent == null ? null : parent.FullName;
        }

        string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        if (!string.IsNullOrEmpty(documents))
        {
            string candidate = Path.Combine(documents, "DeepSeekHarness");
            if (seen.Add(candidate)) yield return candidate;
        }
    }

    private static bool HasServerEntry(string root)
    {
        bool sourceEntry;
        return FindServerEntry(root, out sourceEntry) != null;
    }

    private static string FindServerEntry(string root, out bool sourceEntry)
    {
        sourceEntry = false;
        if (string.IsNullOrEmpty(root)) return null;
        string[] builtCandidates = new string[]
        {
            Path.Combine(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
            Path.Combine(root, "lib", "bin.js"),
            Path.Combine(root, "apps", "cli", "lib", "bin.js")
        };
        foreach (string candidate in builtCandidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        string source = Path.Combine(root, "apps", "cli", "src", "bin.ts");
        if (File.Exists(source))
        {
            sourceEntry = true;
            return source;
        }
        return null;
    }

    private static string FindRuntimeResolver(string root)
    {
        if (string.IsNullOrEmpty(root)) return null;
        string resolver = Path.Combine(root, "runtime-resolver.mjs");
        return File.Exists(resolver) ? Path.GetFullPath(resolver) : null;
    }

    private string EnsureDesktopWebPatch()
    {
        const string content =
            "- id: directory-picker\r\n" +
            "  disabled: true\r\n" +
            "- insert:\r\n" +
            "    - id: directory-picker-browse\r\n" +
            "      name: '@deepseek-ai/dsh-host-directory-picker-browse'\r\n" +
            "    - id: ui-directory-picker-browse\r\n" +
            "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'\r\n";
        try
        {
            AppPaths.Ensure();
            string path = Path.Combine(AppPaths.DataDir, "desktop-web.patch.yml");
            if (!File.Exists(path) || File.ReadAllText(path, Encoding.UTF8) != content)
            {
                File.WriteAllText(path, content, Encoding.UTF8);
            }
            return path;
        }
        catch (Exception ex)
        {
            AppendLog("Desktop directory picker patch failed: " + ex.Message);
            return null;
        }
    }

    private string FindNode(string repo)
    {
        if (!string.IsNullOrEmpty(_cfg.NodePath))
        {
            string configured = _cfg.NodePath;
            if (!Path.IsPathRooted(configured)) configured = Path.Combine(AppPaths.ExeDir, configured);
            if (File.Exists(configured)) return Path.GetFullPath(configured);
        }
        List<string> candidates = new List<string>();
        candidates.Add(Path.Combine(AppPaths.ExeDir, "runtime", "tools", "node", "node.exe"));
        candidates.Add(Path.Combine(AppPaths.ExeDir, "tools", "node", "node.exe"));
        if (!string.IsNullOrEmpty(repo)) candidates.Add(Path.Combine(repo, "tools", "node", "node.exe"));
        candidates.AddRange(new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        });
        foreach (string c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        string pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in pathVar.Split(';'))
        {
            string p;
            try { p = Path.Combine(dir, "node.exe"); }
            catch { continue; }
            if (File.Exists(p)) return p;
        }
        return null;
    }

    private static string Quote(string s)
    {
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
