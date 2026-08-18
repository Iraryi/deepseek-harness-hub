using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

internal static class ConfigProgram
{
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    private static void Main(string[] args)
    {
        try { SetProcessDPIAware(); }
        catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool firstRun = false;
        bool hubMode = false;
        foreach (string arg in args)
        {
            if (string.Equals(arg, "--first-run", StringComparison.OrdinalIgnoreCase)) firstRun = true;
            if (string.Equals(arg, "--hub", StringComparison.OrdinalIgnoreCase)) hubMode = true;
        }
        ConfigForm form = new ConfigForm(firstRun, hubMode);
        Application.Run(form);
        if (form.LaunchAfterClose) form.LaunchApplicationAfterClose();
    }
}

internal sealed class LanguageDialog : Form
{
    private readonly RadioButton _chinese;
    private readonly RadioButton _english;

    public string SelectedLanguage { get; private set; }

    public LanguageDialog(string currentLanguage)
    {
        Text = "Configuration language / 配置程序语言";
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        ClientSize = new Size(700, 430);
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        Font = new Font("Microsoft YaHei UI", 9F);
        BackColor = Color.White;

        TableLayoutPanel layout = new TableLayoutPanel();
        layout.Dock = DockStyle.Fill;
        layout.Padding = new Padding(38, 32, 38, 32);
        layout.ColumnCount = 1;
        layout.RowCount = 6;
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 78F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 66F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 60F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 60F));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52F));
        Controls.Add(layout);

        Label heading = new Label();
        heading.Text = "选择 CONFIG 语言\r\nChoose CONFIG language";
        heading.Dock = DockStyle.Fill;
        heading.Font = new Font(Font.FontFamily, 13F, FontStyle.Bold);
        heading.ForeColor = Color.FromArgb(31, 39, 49);
        heading.TextAlign = ContentAlignment.MiddleLeft;
        layout.Controls.Add(heading, 0, 0);

        Label description = new Label();
        description.Text = "This choice is stored for future launches.\r\n此选择会保存，并用于后续启动。";
        description.Dock = DockStyle.Fill;
        description.ForeColor = Color.FromArgb(96, 108, 122);
        description.TextAlign = ContentAlignment.MiddleLeft;
        layout.Controls.Add(description, 0, 1);

        _chinese = MakeLanguageOption("简体中文");
        _english = MakeLanguageOption("English");
        _chinese.Checked = currentLanguage != "en-US";
        _english.Checked = currentLanguage == "en-US";
        layout.Controls.Add(_chinese, 0, 2);
        layout.Controls.Add(_english, 0, 3);

        FlowLayoutPanel actions = new FlowLayoutPanel();
        actions.Dock = DockStyle.Fill;
        actions.FlowDirection = FlowDirection.RightToLeft;
        actions.WrapContents = false;

        Button continueButton = new Button();
        continueButton.Text = "继续  Continue";
        continueButton.Size = new Size(190, 42);
        continueButton.FlatStyle = FlatStyle.Flat;
        continueButton.FlatAppearance.BorderColor = Color.FromArgb(30, 105, 210);
        continueButton.BackColor = Color.FromArgb(30, 105, 210);
        continueButton.ForeColor = Color.White;
        continueButton.Click += delegate
        {
            SelectedLanguage = _english.Checked ? "en-US" : "zh-CN";
            DialogResult = DialogResult.OK;
            Close();
        };
        actions.Controls.Add(continueButton);
        layout.Controls.Add(actions, 0, 5);
        AcceptButton = continueButton;
    }

    private RadioButton MakeLanguageOption(string text)
    {
        RadioButton option = new RadioButton();
        option.Text = text;
        option.Dock = DockStyle.Fill;
        option.Padding = new Padding(14, 0, 0, 0);
        option.FlatStyle = FlatStyle.Flat;
        option.Font = new Font(Font.FontFamily, 10F, FontStyle.Regular);
        option.BackColor = Color.FromArgb(244, 246, 249);
        option.ForeColor = Color.FromArgb(31, 39, 49);
        option.Cursor = Cursors.Hand;
        return option;
    }
}

internal sealed class PageScrollPanel : Panel
{
    public PageScrollPanel()
    {
        AutoScroll = true;
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        ScrollByWheel(e.Delta);
    }

    public void ScrollByWheel(int delta)
    {
        int current = -AutoScrollPosition.Y;
        int lines = SystemInformation.MouseWheelScrollLines;
        int step = lines < 0 ? Math.Max(1, ClientSize.Height) : Math.Max(48, lines * 24);
        int ticks = Math.Max(1, Math.Abs(delta) / SystemInformation.MouseWheelScrollDelta);
        int maximum = Math.Max(0, VerticalScroll.Maximum - VerticalScroll.LargeChange + 1);
        int target = current - Math.Sign(delta) * step * ticks;
        target = Math.Max(0, Math.Min(maximum, target));
        AutoScrollPosition = new Point(0, target);
    }

    public static void ForwardWheel(Control source, int delta)
    {
        Control current = source;
        while (current != null)
        {
            PageScrollPanel page = current as PageScrollPanel;
            if (page != null)
            {
                page.ScrollByWheel(delta);
                return;
            }
            current = current.Parent;
        }
    }
}

internal sealed class ConfigMouseWheelFilter : IMessageFilter
{
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(NativePoint point);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);

    private const int MouseWheelMessage = 0x020A;
    private readonly Control _owner;

    public ConfigMouseWheelFilter(Control owner)
    {
        _owner = owner;
    }

    public bool PreFilterMessage(ref Message message)
    {
        if (message.Msg != MouseWheelMessage || _owner.IsDisposed || !_owner.Visible) return false;

        Point cursor = Control.MousePosition;
        NativePoint nativePoint = new NativePoint();
        nativePoint.X = cursor.X;
        nativePoint.Y = cursor.Y;
        IntPtr window = WindowFromPoint(nativePoint);
        Control hovered = null;
        while (window != IntPtr.Zero && hovered == null)
        {
            hovered = Control.FromHandle(window);
            window = GetParent(window);
        }
        if (hovered == null || (hovered != _owner && !_owner.Contains(hovered))) return false;

        Control current = hovered;
        while (current != null)
        {
            PageScrollPanel page = current as PageScrollPanel;
            if (page != null && page.Visible)
            {
                int delta = unchecked((short)(message.WParam.ToInt64() >> 16));
                page.ScrollByWheel(delta);
                return true;
            }
            current = current.Parent;
        }
        return false;
    }
}

internal sealed class PageScrollComboBox : ComboBox
{
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        PageScrollPanel.ForwardWheel(this, e.Delta);
    }
}

internal sealed class PageScrollNumericUpDown : NumericUpDown
{
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        PageScrollPanel.ForwardWheel(this, e.Delta);
    }
}

internal sealed class RoundedChoiceControl : Control
{
    private string _primaryText = "";
    private string _secondaryText = "";
    private bool _selected;
    private bool _showChevron;
    private bool _expanded;
    private bool _hovered;
    private bool _pressed;

    public Color SurfaceColor { get; set; }
    public Color HoverColor { get; set; }
    public Color PressedColor { get; set; }
    public Color BorderColor { get; set; }
    public Color AccentColor { get; set; }
    public Color SecondaryColor { get; set; }
    public int BorderSize { get; set; }
    public int Radius { get; set; }

    public string PrimaryText
    {
        get { return _primaryText; }
        set { _primaryText = value ?? ""; Text = _primaryText; Invalidate(); }
    }

    public string SecondaryText
    {
        get { return _secondaryText; }
        set { _secondaryText = value ?? ""; Invalidate(); }
    }

    public bool Selected
    {
        get { return _selected; }
        set { _selected = value; Invalidate(); }
    }

    public bool ShowChevron
    {
        get { return _showChevron; }
        set { _showChevron = value; Invalidate(); }
    }

    public bool Expanded
    {
        get { return _expanded; }
        set { _expanded = value; Invalidate(); }
    }

    public RoundedChoiceControl()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.ResizeRedraw | ControlStyles.UserPaint | ControlStyles.Selectable, true);
        Cursor = Cursors.Hand;
        TabStop = true;
        SurfaceColor = Color.White;
        HoverColor = Color.FromArgb(247, 249, 252);
        PressedColor = Color.FromArgb(238, 243, 249);
        BorderColor = Color.FromArgb(220, 225, 232);
        AccentColor = Color.FromArgb(30, 105, 210);
        SecondaryColor = Color.FromArgb(96, 108, 122);
        BorderSize = 1;
        Radius = 11;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        _hovered = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hovered = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        _pressed = true;
        Focus();
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode != Keys.Enter && e.KeyCode != Keys.Space) return;
        OnClick(EventArgs.Empty);
        e.Handled = true;
        e.SuppressKeyPress = true;
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (Width <= 1 || Height <= 1) return;
        using (GraphicsPath path = RoundedRectangle(new RectangleF(0, 0, Width, Height), Radius))
        {
            Region oldRegion = Region;
            Region = new Region(path);
            if (oldRegion != null) oldRegion.Dispose();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        RectangleF bounds = new RectangleF(0.5F, 0.5F, Math.Max(1F, Width - 1F), Math.Max(1F, Height - 1F));
        Color fill = _pressed ? PressedColor : (_hovered ? HoverColor : SurfaceColor);
        using (GraphicsPath path = RoundedRectangle(bounds, Radius))
        using (SolidBrush brush = new SolidBrush(fill))
        {
            e.Graphics.FillPath(brush, path);
            if (BorderSize > 0)
            {
                using (Pen pen = new Pen(BorderColor, BorderSize)) e.Graphics.DrawPath(pen, path);
            }
        }

        if (_selected)
        {
            float accentHeight = Math.Max(12F, Height * 0.46F);
            RectangleF accentBounds = new RectangleF(3F, (Height - accentHeight) / 2F, 3F, accentHeight);
            using (GraphicsPath accentPath = RoundedRectangle(accentBounds, 1.5F))
            using (SolidBrush accentBrush = new SolidBrush(AccentColor)) e.Graphics.FillPath(accentBrush, accentPath);
        }

        int left = _selected ? 17 : 13;
        int right = _showChevron ? 37 : 11;
        Rectangle primaryBounds;
        Rectangle secondaryBounds;
        using (Font primaryFont = new Font(Font.FontFamily, Font.Size, FontStyle.Bold))
        using (Font secondaryFont = new Font(Font.FontFamily, Math.Max(7F, Font.Size - 1.25F), FontStyle.Regular))
        {
            int textWidth = Math.Max(1, Width - left - right);
            int primaryHeight = TextRenderer.MeasureText(e.Graphics, "Ag", primaryFont,
                new Size(textWidth, int.MaxValue), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Height;
            int secondaryHeight = TextRenderer.MeasureText(e.Graphics, "Ag", secondaryFont,
                new Size(textWidth, int.MaxValue), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Height;
            if (string.IsNullOrEmpty(_secondaryText))
            {
                primaryBounds = new Rectangle(left, 0, textWidth, Height);
                secondaryBounds = Rectangle.Empty;
            }
            else
            {
                int gap = Math.Max(2, DeviceDpi / 96);
                int textHeight = primaryHeight + gap + secondaryHeight;
                int top = Math.Max(4, (Height - textHeight) / 2);
                primaryBounds = new Rectangle(left, top, textWidth, primaryHeight);
                secondaryBounds = new Rectangle(left, top + primaryHeight + gap, textWidth, secondaryHeight);
            }
            TextRenderer.DrawText(e.Graphics, _primaryText, primaryFont, primaryBounds, ForeColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            if (!secondaryBounds.IsEmpty)
            {
                TextRenderer.DrawText(e.Graphics, _secondaryText, secondaryFont, secondaryBounds, SecondaryColor,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            }
        }
        if (_showChevron)
        {
            int centerX = Width - 18;
            int centerY = Height / 2;
            Point[] chevron;
            if (_expanded)
            {
                chevron = new[] { new Point(centerX - 5, centerY + 2), new Point(centerX, centerY - 3), new Point(centerX + 5, centerY + 2) };
            }
            else
            {
                chevron = new[] { new Point(centerX - 5, centerY - 2), new Point(centerX, centerY + 3), new Point(centerX + 5, centerY - 2) };
            }
            using (Pen pen = new Pen(SecondaryColor, 2F))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                e.Graphics.DrawLines(pen, chevron);
            }
        }

        if (Focused && ShowFocusCues)
        {
            Rectangle focus = Rectangle.Inflate(ClientRectangle, -5, -5);
            ControlPaint.DrawFocusRectangle(e.Graphics, focus, ForeColor, fill);
        }
    }

    private static GraphicsPath RoundedRectangle(RectangleF rectangle, float radius)
    {
        float safeRadius = Math.Max(0F, Math.Min(radius, Math.Min(rectangle.Width, rectangle.Height) / 2F));
        float diameter = safeRadius * 2F;
        GraphicsPath path = new GraphicsPath();
        if (diameter <= 0F)
        {
            path.AddRectangle(rectangle);
            return path;
        }
        path.AddArc(rectangle.Left, rectangle.Top, diameter, diameter, 180F, 90F);
        path.AddArc(rectangle.Right - diameter, rectangle.Top, diameter, diameter, 270F, 90F);
        path.AddArc(rectangle.Right - diameter, rectangle.Bottom - diameter, diameter, diameter, 0F, 90F);
        path.AddArc(rectangle.Left, rectangle.Bottom - diameter, diameter, diameter, 90F, 90F);
        path.CloseFigure();
        return path;
    }
}

internal sealed class ConfigForm : Form
{
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool RedrawWindow(IntPtr window, IntPtr updateRectangle, IntPtr updateRegion, uint flags);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    private const int SetRedrawMessage = 0x000B;
    private const uint RedrawInvalidate = 0x0001;
    private const uint RedrawErase = 0x0004;
    private const uint RedrawAllChildren = 0x0080;
    private const uint RedrawUpdateNow = 0x0100;
    private const uint RedrawEraseNow = 0x0200;
    private const uint RedrawFrame = 0x0400;

    private sealed class ResolutionOption
    {
        public readonly int Width;
        public readonly int Height;
        public readonly bool IsCustom;

        public ResolutionOption(int width, int height)
        {
            Width = width;
            Height = height;
        }

        private ResolutionOption()
        {
            IsCustom = true;
        }

        public static ResolutionOption Custom()
        {
            return new ResolutionOption();
        }

        public override string ToString()
        {
            return IsCustom ? "Custom" : Width + " x " + Height;
        }
    }

    private static readonly Color ShellColor = Color.FromArgb(244, 246, 249);
    private static readonly Color PageColor = Color.White;
    private static readonly Color TextColor = Color.FromArgb(31, 39, 49);
    private static readonly Color MutedColor = Color.FromArgb(96, 108, 122);
    private static readonly Color AccentColor = Color.FromArgb(30, 105, 210);
    private static readonly Color AccentSoftColor = Color.FromArgb(229, 239, 252);
    private static readonly Color LineColor = Color.FromArgb(220, 225, 232);

    private readonly Dictionary<string, Panel> _pages = new Dictionary<string, Panel>();
    private readonly Dictionary<string, RoundedChoiceControl> _navigationButtons = new Dictionary<string, RoundedChoiceControl>();
    private readonly Dictionary<string, List<ResolutionOption>> _resolutionPresets = BuildResolutionPresets();
    private readonly ToolTip _toolTip = new ToolTip();
    private readonly System.Windows.Forms.Timer _targetMenuTimer;

    private AppConfig _cfg;
    private HubConfig _hubCfg;
    private readonly bool _firstRun;
    private bool _hubConfigMode;
    private bool _languagePromptShown;
    private readonly ConfigMouseWheelFilter _mouseWheelFilter;
    private Panel _pageHost;
    private Control _shellRoot;
    private Label _lblModeDescription;
    private TableLayoutPanel _sidebarLayout;
    private RowStyle _targetSelectorRow;
    private Panel _targetSelectorHost;
    private RoundedChoiceControl _targetSelectorHeader;
    private RoundedChoiceControl _targetDesktopOption;
    private RoundedChoiceControl _targetHubOption;
    private bool _targetMenuExpanded;
    private float _layoutScale = 1F;

    private NumericUpDown _numWidth;
    private NumericUpDown _numHeight;
    private ComboBox _comboAspectRatio;
    private ComboBox _comboResolutionPreset;
    private ComboBox _comboMode;
    private bool _updatingResolutionControls;
    private CheckBox _chkAutoHide;
    private CheckBox _chkEdgeReveal;
    private ComboBox _comboLoadingStyle;
    private ComboBox _comboCloseAction;
    private CheckBox _chkShowTrayButton;
    private CheckBox _chkFullscreenToolbar;
    private CheckBox _chkFullscreenTaskbar;
    private TextBox _txtToolbarHotkey;
    private TextBox _txtFullscreenHotkey;

    private TextBox _txtUrl;
    private NumericUpDown _numPort;
    private TextBox _txtNodePath;
    private TextBox _txtRepoPath;

    private CheckBox _chkExtensions;
    private ListBox _listExtensions;
    private TextBox _txtInjectCss;
    private TextBox _txtInjectJs;
    private CheckBox _chkDevTools;
    private CheckBox _chkExternalBrowser;

    private ComboBox _comboHubTheme;
    private ComboBox _comboHubStartPage;
    private ComboBox _comboHubDiscoverySource;
    private ComboBox _comboHubPageSize;
    private ComboBox _comboHubDetailEntry;
    private ComboBox _comboHubDetailMode;
    private ComboBox _comboHubDetailContent;
    private ComboBox _comboHubLoadingStyle;
    private ComboBox _comboHubCloseAction;
    private CheckBox _chkHubShowTrayButton;
    private CheckBox _chkHubAllowDesktopPlugins;

    private Label _lblDataDir;

    internal bool LaunchAfterClose { get; private set; }

    public ConfigForm()
        : this(false, false)
    {
    }

    public ConfigForm(bool firstRun)
        : this(firstRun, false)
    {
    }

    public ConfigForm(bool firstRun, bool hubMode)
    {
        _firstRun = firstRun;
        _hubConfigMode = hubMode && !firstRun;
        _cfg = AppConfig.Load();
        _hubCfg = HubConfig.Load();
        _targetMenuTimer = new System.Windows.Forms.Timer();
        _targetMenuTimer.Interval = 16;
        _targetMenuTimer.Tick += delegate { AnimateConfigTargetMenu(); };
        BuildUi();
        LoadValues();
        _mouseWheelFilter = new ConfigMouseWheelFilter(this);
        Application.AddMessageFilter(_mouseWheelFilter);
        FormClosed += delegate
        {
            Application.RemoveMessageFilter(_mouseWheelFilter);
            _targetMenuTimer.Stop();
            _targetMenuTimer.Dispose();
        };
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }
        Shown += delegate
        {
            UpdateCurrentLayoutScale();
            string page = DefaultPageKey;
            ShowPage(page);
            _navigationButtons[page].Select();
            if ((_firstRun || !_cfg.FirstRunCompleted) && !_languagePromptShown)
            {
                BeginInvoke((MethodInvoker)ShowLanguagePrompt);
            }
        };
    }

    private void BuildUi()
    {
        BuildUi(true);
    }

    private void BuildUi(bool showImmediately)
    {
        SuspendLayout();

        Text = "CONFIG";
        if (showImmediately)
        {
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(920, 680);
            MinimumSize = new Size(820, 600);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = PageColor;
            ForeColor = TextColor;
            DoubleBuffered = true;
        }

        TableLayoutPanel shell = new TableLayoutPanel();
        shell.Dock = DockStyle.Fill;
        shell.Margin = Padding.Empty;
        shell.Padding = Padding.Empty;
        shell.ColumnCount = 2;
        shell.RowCount = 2;
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190F));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 66F));
        Panel sidebar = BuildSidebar();
        shell.Controls.Add(sidebar, 0, 0);
        shell.SetRowSpan(sidebar, 2);

        _pageHost = new Panel();
        _pageHost.Dock = DockStyle.Fill;
        _pageHost.Margin = Padding.Empty;
        _pageHost.BackColor = PageColor;
        shell.Controls.Add(_pageHost, 1, 0);

        Panel footer = BuildFooter();
        shell.Controls.Add(footer, 1, 1);

        if (_hubConfigMode)
        {
            _pages.Add("hubAppearance", BuildHubAppearancePage());
            _pages.Add("hubStartup", BuildHubStartupPage());
        }
        else
        {
            _pages.Add("display", BuildDisplayPage());
            _pages.Add("server", BuildServerPage());
            _pages.Add("extensions", BuildExtensionsPage());
        }

        foreach (Panel page in _pages.Values)
        {
            page.Visible = false;
            _pageHost.Controls.Add(page);
        }

        shell.Visible = false;
        Controls.Add(shell);
        _shellRoot = shell;
        ShowPage(DefaultPageKey);
        Text = T(Text);
        TranslateControlTree(shell);
        shell.Visible = showImmediately;
        if (showImmediately) shell.BringToFront();
        ResumeLayout(true);
    }

    private void ShowLanguagePrompt()
    {
        _languagePromptShown = true;
        using (LanguageDialog dialog = new LanguageDialog(_cfg.Language))
        {
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            bool changed = _cfg.Language != dialog.SelectedLanguage;
            _cfg.Language = dialog.SelectedLanguage;
            _cfg.Save();
            if (changed) RebuildUiForLanguage();
        }
    }

    private void RebuildUiForLanguage()
    {
        StopConfigTargetAnimation();
        Control oldRoot = _shellRoot;
        FormWindowState preservedWindowState = WindowState;
        Rectangle preservedBounds = Bounds;
        bool nativeRedrawSuspended = IsHandleCreated && !IsDisposed;
        if (nativeRedrawSuspended) SendMessage(Handle, SetRedrawMessage, IntPtr.Zero, IntPtr.Zero);
        SuspendLayout();
        try
        {
            _pages.Clear();
            _navigationButtons.Clear();
            _layoutScale = 1F;
            BuildUi(false);
            ScaleReplacementSurfaceForWindow(_shellRoot);
            LoadValues();
            ShowPage(DefaultPageKey);
            Control newRoot = _shellRoot;
            if (newRoot != null)
            {
                newRoot.PerformLayout();
                newRoot.Visible = true;
                newRoot.BringToFront();
            }
            if (oldRoot != null && !ReferenceEquals(oldRoot, newRoot))
            {
                Controls.Remove(oldRoot);
                oldRoot.Dispose();
            }
        }
        finally
        {
            if (preservedWindowState == FormWindowState.Normal && Bounds != preservedBounds)
            {
                Bounds = preservedBounds;
            }
            else if (WindowState != preservedWindowState)
            {
                WindowState = preservedWindowState;
            }
            ResumeLayout(true);
            if (nativeRedrawSuspended)
            {
                SendMessage(Handle, SetRedrawMessage, new IntPtr(1), IntPtr.Zero);
                RedrawWindow(Handle, IntPtr.Zero, IntPtr.Zero,
                    RedrawInvalidate | RedrawErase | RedrawAllChildren | RedrawUpdateNow | RedrawEraseNow | RedrawFrame);
            }
        }
    }

    private void ScaleReplacementSurfaceForWindow(Control newRoot)
    {
        if (newRoot == null) return;
        float scale = GetCurrentWindowScale();
        _layoutScale = scale;
        if (Math.Abs(scale - 1F) <= 0.01F) return;
        newRoot.SuspendLayout();
        try
        {
            ScaleControlLayoutMetrics(newRoot, scale, true);
            PositionConfigTargetControls();
        }
        finally
        {
            newRoot.ResumeLayout(true);
        }
    }

    private void UpdateCurrentLayoutScale()
    {
        _layoutScale = GetCurrentWindowScale();
    }

    private float GetCurrentWindowScale()
    {
        if (!IsHandleCreated || IsDisposed) return 1F;
        uint dpi = GetDpiForWindow(Handle);
        if (dpi < 72 || dpi > 768) return 1F;
        return dpi / 96F;
    }

    private static void ScaleControlLayoutMetrics(Control control, float scale, bool root)
    {
        control.Margin = ScalePadding(control.Margin, scale);
        control.Padding = ScalePadding(control.Padding, scale);
        if (!control.MinimumSize.IsEmpty) control.MinimumSize = ScaleSize(control.MinimumSize, scale);
        if (!control.MaximumSize.IsEmpty) control.MaximumSize = ScaleSize(control.MaximumSize, scale);

        TableLayoutPanel table = control as TableLayoutPanel;
        if (table != null)
        {
            foreach (ColumnStyle style in table.ColumnStyles)
            {
                if (style.SizeType == SizeType.Absolute) style.Width = ScaleValue(style.Width, scale);
            }
            foreach (RowStyle style in table.RowStyles)
            {
                if (style.SizeType == SizeType.Absolute) style.Height = ScaleValue(style.Height, scale);
            }
        }

        if (!root && !control.AutoSize)
        {
            int taggedWidth = control.Tag is int ? (int)control.Tag : 0;
            if (taggedWidth > 0)
            {
                control.Width = ScaleValue(taggedWidth, scale);
            }
            else if (control.Dock == DockStyle.None)
            {
                control.Size = ScaleSize(control.Size, scale);
            }
            else if (control.Dock == DockStyle.Left || control.Dock == DockStyle.Right)
            {
                control.Width = ScaleValue(control.Width, scale);
            }
            else if (control.Dock == DockStyle.Top || control.Dock == DockStyle.Bottom)
            {
                control.Height = ScaleValue(control.Height, scale);
            }
        }

        foreach (Control child in control.Controls) ScaleControlLayoutMetrics(child, scale, false);
    }

    private static Padding ScalePadding(Padding padding, float scale)
    {
        return new Padding(
            ScaleValue(padding.Left, scale),
            ScaleValue(padding.Top, scale),
            ScaleValue(padding.Right, scale),
            ScaleValue(padding.Bottom, scale));
    }

    private static Size ScaleSize(Size size, float scale)
    {
        return new Size(ScaleValue(size.Width, scale), ScaleValue(size.Height, scale));
    }

    private static int ScaleValue(int value, float scale)
    {
        return (int)Math.Round(value * scale);
    }

    private static float ScaleValue(float value, float scale)
    {
        return value * scale;
    }

    private string DefaultPageKey
    {
        get { return _hubConfigMode ? "hubAppearance" : "display"; }
    }

    private string T(string english)
    {
        if (_cfg.Language != "zh-CN") return english;
        switch (english)
        {
            case "CONFIG": return "CONFIG";
            case "CONFIGURATION": return "配置中心";
            case "HUB CONFIGURATION": return "HUB 配置";
            case "Desktop settings": return "主程序设置";
            case "HUB settings": return "HUB 设置";
            case "Display": return "显示";
            case "Server": return "服务";
            case "Extensions & Dev": return "扩展与开发";
            case "HUB Appearance": return "HUB 外观";
            case "HUB Startup": return "HUB 启动";
            case "Cancel": return "取消";
            case "Save": return "保存";
            case "Save & Launch": return "保存并启动";
            case "Browse": return "浏览";
            case "Add": return "添加";
            case "Remove": return "移除";
            case "Window size, launch mode, and keyboard controls.": return "窗口尺寸、启动模式与快捷键设置。";
            case "Window": return "窗口";
            case "Aspect ratio": return "宽高比";
            case "Resolution preset": return "分辨率预设";
            case "Custom width and height": return "自定义宽度和高度";
            case "Default launch mode": return "默认启动模式";
            case "Startup and window controls": return "启动与窗口控制";
            case "Loading screen": return "加载画面";
            case "When the title-bar X is clicked": return "点击标题栏 X 时";
            case "Show a dedicated Minimize to tray button when X exits": return "当 X 设置为退出时，显示专用的最小化到托盘按钮";
            case "Fullscreen behavior": return "全屏行为";
            case "Keep the application toolbar visible in fullscreen": return "全屏时始终显示应用工具栏";
            case "Keep the Windows taskbar visible in borderless or exclusive fullscreen": return "无边框或独占全屏时保留 Windows 任务栏";
            case "Toolbar and shortcuts": return "工具栏与快捷键";
            case "Auto-hide toolbar": return "自动隐藏工具栏";
            case "Reveal toolbar at the top screen edge": return "鼠标触及屏幕顶边时显示工具栏";
            case "Toolbar hotkey": return "工具栏快捷键";
            case "Fullscreen hotkey": return "全屏快捷键";
            case "F12 opens DevTools. Esc exits fullscreen.": return "F12 打开开发者工具，Esc 退出全屏。";
            case "Local Web UI endpoint and runtime locations.": return "本地 Web UI 地址与运行环境位置。";
            case "Connection": return "连接";
            case "Web UI URL": return "Web UI 地址";
            case "Port": return "端口";
            case "Runtime": return "运行环境";
            case "node.exe path": return "node.exe 路径";
            case "Harness folder": return "Harness 目录";
            case "Leave either path blank to use automatic detection.": return "路径留空时使用自动检测。";
            case "Browser extensions and Web UI customization files.": return "浏览器扩展与 Web UI 二次开发文件。";
            case "Theme and visual behavior stored only for HUB.": return "仅应用于 HUB 的主题与视觉设置。";
            case "Startup choices stored separately from the main Desktop program.": return "与主程序互不影响的 HUB 启动设置。";
            case "HUB loading and close behavior are stored separately from the main Desktop program.": return "HUB 的加载画面与关闭行为独立于主程序保存。";
            case "Allow Desktop plugins to affect HUB": return "允许主程序插件影响 HUB";
            case "Disabled by default: HUB uses an isolated Web Profile so Desktop sidebar and UI plugins do not leak into it.": return "默认关闭：HUB 使用独立 Web Profile，主程序的侧边栏和界面插件不会混入 HUB。";
            case "Appearance": return "外观";
            case "Color theme": return "颜色主题";
            case "Follow Windows": return "跟随 Windows";
            case "Light": return "浅色";
            case "Dark": return "深色";
            case "The HUB theme does not change the main Desktop interface.": return "HUB 主题不会改变主程序界面。";
            case "Startup": return "启动";
            case "Default HUB page": return "默认 HUB 页面";
            case "Home": return "主页";
            case "Discovery": return "发现";
            case "Setup library": return "Setup 库";
            case "Installed Setups": return "已安装 Setup";
            case "Default discovery source": return "默认发现来源";
            case "DSHMK verified market": return "DSHMK 验证市场";
            case "Curated Setup market": return "精选 Setup 市场";
            case "Global GitHub": return "GitHub 全域";
            case "DSHMK is the default live source. Its validation status and explicit install candidates decide whether one-click Setup is available.": return "DSHMK 是默认在线来源；验证状态与明确的安装候选共同决定是否提供一键 Setup。";
            case "Catalog and details": return "目录与详情";
            case "Projects per page": return "每页项目数";
            case "Project detail entry": return "详情入口";
            case "Details button (recommended)": return "独立详情按钮（推荐）";
            case "Click the entire project card": return "点击整张项目卡片";
            case "Project detail presentation": return "详情显示方式";
            case "Side copilot panel": return "侧边副驾驶面板";
            case "Centered modal": return "居中浮层";
            case "Full HUB surface": return "整个 HUB 页面";
            case "Project detail content": return "详情内容";
            case "HUB reconstructed detail": return "HUB 重构详情";
            case "Original source page": return "原始来源页面";
            case "Curated remains the default because only reviewed entries can enter one-click Setup preflight.": return "精选市场保持默认，因为只有经过目录筛选的条目才能进入一键 Setup 预检。";
            case "Browser extensions": return "浏览器扩展";
            case "Enable unpacked Edge or Chrome extensions": return "启用未打包的 Edge 或 Chrome 扩展";
            case "Web UI injection": return "Web UI 注入";
            case "CSS file": return "CSS 文件";
            case "JavaScript file": return "JavaScript 文件";
            case "Developer options": return "开发者选项";
            case "Enable F12 DevTools window": return "允许使用 F12 打开开发者工具";
            case "Open external links in the system browser": return "使用系统浏览器打开外部链接";
            case "Whales": return "双鲸环游";
            case "Progress console": return "进度控制台";
            case "Disabled": return "关闭";
            case "Minimize to tray": return "最小化到托盘";
            case "Exit application": return "退出应用";
            case "Configuration stored in portable data": return "配置保存在便携数据目录";
            case "Configuration stored in user data": return "配置保存在用户数据目录";
            case "HUB configuration stored in portable data": return "HUB 配置保存在便携数据目录";
            case "HUB configuration stored in user data": return "HUB 配置保存在用户数据目录";
            case "Maximized with the standard window border.": return "使用标准窗口边框最大化显示。";
            case "Borderless fullscreen that leaves normal window priority.": return "无边框全屏，并保持普通窗口优先级。";
            case "Borderless, always on top, and covers the taskbar.": return "无边框、始终置顶并覆盖任务栏。";
            case "A normal resizable window. Oversized resolutions are fitted to the current desktop.": return "普通可缩放窗口；过大的分辨率会自动适配当前桌面。";
            default: return english;
        }
    }

    private void TranslateControlTree(Control control)
    {
        if (control is Form || control is Label || control is Button || control is CheckBox)
        {
            control.Text = T(control.Text);
        }
        foreach (Control child in control.Controls) TranslateControlTree(child);
    }

    private Panel BuildSidebar()
    {
        Panel sidebar = new Panel();
        sidebar.Dock = DockStyle.Fill;
        sidebar.Margin = Padding.Empty;
        sidebar.Padding = new Padding(14, 18, 14, 16);
        sidebar.BackColor = ShellColor;

        _sidebarLayout = new TableLayoutPanel();
        _sidebarLayout.Dock = DockStyle.Fill;
        _sidebarLayout.Margin = Padding.Empty;
        _sidebarLayout.ColumnCount = 1;
        _sidebarLayout.RowCount = _hubConfigMode ? 5 : 6;
        _sidebarLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        _targetSelectorRow = new RowStyle(SizeType.Absolute, GetTargetSelectorCollapsedHeight());
        _sidebarLayout.RowStyles.Add(_targetSelectorRow);
        _sidebarLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 14F));
        _sidebarLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48F));
        _sidebarLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48F));
        if (!_hubConfigMode) _sidebarLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48F));
        _sidebarLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        sidebar.Controls.Add(_sidebarLayout);

        _targetSelectorHost = new Panel();
        _targetSelectorHost.Dock = DockStyle.Fill;
        _targetSelectorHost.Margin = Padding.Empty;
        _targetSelectorHost.BackColor = ShellColor;
        _targetSelectorHost.Resize += delegate { PositionConfigTargetControls(); };

        _targetSelectorHeader = MakeTargetChoice(
            _hubConfigMode ? "HUB" : "DSH",
            T(_hubConfigMode ? "HUB CONFIGURATION" : "CONFIGURATION"), false, true);
        _targetSelectorHeader.Click += delegate { SetConfigTargetMenuExpanded(!_targetMenuExpanded); };
        _targetSelectorHost.Controls.Add(_targetSelectorHeader);

        _targetDesktopOption = MakeTargetChoice("DSH", T("Desktop settings"), !_hubConfigMode, false);
        _targetDesktopOption.Click += delegate { SwitchConfigTarget(false); };
        _targetDesktopOption.Visible = false;
        _targetSelectorHost.Controls.Add(_targetDesktopOption);

        _targetHubOption = MakeTargetChoice("HUB", T("HUB settings"), _hubConfigMode, false);
        _targetHubOption.Click += delegate { SwitchConfigTarget(true); };
        _targetHubOption.Visible = false;
        _targetSelectorHost.Controls.Add(_targetHubOption);
        _targetSelectorHeader.BringToFront();
        _sidebarLayout.Controls.Add(_targetSelectorHost, 0, 0);
        PositionConfigTargetControls();

        Panel spacer = new Panel();
        spacer.Dock = DockStyle.Fill;
        spacer.Margin = Padding.Empty;
        spacer.BackColor = ShellColor;
        _sidebarLayout.Controls.Add(spacer, 0, 1);

        if (_hubConfigMode)
        {
            _sidebarLayout.Controls.Add(MakeNavigationButton("HUB Appearance", "hubAppearance"), 0, 2);
            _sidebarLayout.Controls.Add(MakeNavigationButton("HUB Startup", "hubStartup"), 0, 3);
        }
        else
        {
            _sidebarLayout.Controls.Add(MakeNavigationButton("Display", "display"), 0, 2);
            _sidebarLayout.Controls.Add(MakeNavigationButton("Server", "server"), 0, 3);
            _sidebarLayout.Controls.Add(MakeNavigationButton("Extensions & Dev", "extensions"), 0, 4);
        }

        return sidebar;
    }

    private RoundedChoiceControl MakeTargetChoice(string primary, string secondary, bool selected, bool chevron)
    {
        RoundedChoiceControl choice = new RoundedChoiceControl();
        choice.PrimaryText = primary;
        choice.SecondaryText = secondary;
        choice.Selected = selected;
        choice.ShowChevron = chevron;
        choice.Font = new Font(Font.FontFamily, 9.5F, FontStyle.Regular);
        choice.ForeColor = TextColor;
        choice.SecondaryColor = MutedColor;
        choice.SurfaceColor = selected && !chevron ? AccentSoftColor : PageColor;
        choice.HoverColor = selected && !chevron ? Color.FromArgb(221, 234, 251) : Color.FromArgb(249, 250, 252);
        choice.PressedColor = Color.FromArgb(232, 239, 248);
        choice.BorderColor = selected && !chevron ? Color.FromArgb(174, 202, 238) : LineColor;
        choice.AccentColor = AccentColor;
        choice.BorderSize = 1;
        choice.Radius = 11;
        return choice;
    }

    private int GetTargetSelectorHeaderHeight()
    {
        return ScaleValue(62, _layoutScale);
    }

    private int GetTargetSelectorOptionHeight()
    {
        return ScaleValue(66, _layoutScale);
    }

    private int GetTargetSelectorCollapsedHeight()
    {
        return GetTargetSelectorHeaderHeight();
    }

    private int GetTargetSelectorExpandedHeight()
    {
        return GetTargetSelectorHeaderHeight() + ScaleValue(8, _layoutScale)
            + GetTargetSelectorOptionHeight() * 2 + ScaleValue(6, _layoutScale);
    }

    private void PositionConfigTargetControls()
    {
        if (_targetSelectorHost == null) return;
        int width = Math.Max(1, _targetSelectorHost.ClientSize.Width);
        int headerHeight = GetTargetSelectorHeaderHeight();
        int optionHeight = GetTargetSelectorOptionHeight();
        if (_targetSelectorHeader != null) _targetSelectorHeader.SetBounds(0, 0, width, headerHeight);
        if (_targetDesktopOption != null)
            _targetDesktopOption.SetBounds(0, headerHeight + ScaleValue(8, _layoutScale), width, optionHeight);
        if (_targetHubOption != null)
            _targetHubOption.SetBounds(0, headerHeight + ScaleValue(14, _layoutScale) + optionHeight, width, optionHeight);
    }

    private void SetConfigTargetMenuExpanded(bool expanded)
    {
        if (_targetSelectorRow == null || _targetSelectorHeader == null) return;
        _targetMenuExpanded = expanded;
        _targetSelectorHeader.Expanded = expanded;
        if (expanded)
        {
            _targetDesktopOption.Visible = true;
            _targetHubOption.Visible = true;
        }
        _targetMenuTimer.Start();
    }

    private void AnimateConfigTargetMenu()
    {
        if (_targetSelectorRow == null || _sidebarLayout == null || _sidebarLayout.IsDisposed)
        {
            _targetMenuTimer.Stop();
            return;
        }
        int target = _targetMenuExpanded ? GetTargetSelectorExpandedHeight() : GetTargetSelectorCollapsedHeight();
        int current = (int)Math.Round(_targetSelectorRow.Height);
        int distance = target - current;
        if (Math.Abs(distance) <= 2)
        {
            _targetSelectorRow.Height = target;
            _targetMenuTimer.Stop();
            if (!_targetMenuExpanded)
            {
                _targetDesktopOption.Visible = false;
                _targetHubOption.Visible = false;
            }
            _sidebarLayout.PerformLayout();
            return;
        }
        int step = Math.Max(4, Math.Abs(distance) / 4);
        _targetSelectorRow.Height = current + Math.Sign(distance) * step;
        _sidebarLayout.PerformLayout();
    }

    private void StopConfigTargetAnimation()
    {
        _targetMenuTimer.Stop();
        _targetMenuExpanded = false;
        if (_targetSelectorHeader != null && !_targetSelectorHeader.IsDisposed) _targetSelectorHeader.Expanded = false;
        if (_targetSelectorRow != null) _targetSelectorRow.Height = GetTargetSelectorCollapsedHeight();
        if (_targetDesktopOption != null && !_targetDesktopOption.IsDisposed) _targetDesktopOption.Visible = false;
        if (_targetHubOption != null && !_targetHubOption.IsDisposed) _targetHubOption.Visible = false;
    }

    private void SwitchConfigTarget(bool hubMode)
    {
        if (_hubConfigMode == hubMode)
        {
            SetConfigTargetMenuExpanded(false);
            return;
        }
        StopConfigTargetAnimation();
        CollectValues();
        _hubConfigMode = hubMode;
        RebuildUiForLanguage();
    }

    private Panel BuildFooter()
    {
        Panel footer = new Panel();
        footer.Dock = DockStyle.Fill;
        footer.Margin = Padding.Empty;
        footer.Padding = new Padding(22, 12, 20, 12);
        footer.BackColor = PageColor;
        footer.Paint += delegate(object sender, PaintEventArgs e)
        {
            using (Pen pen = new Pen(LineColor))
            {
                e.Graphics.DrawLine(pen, 0, 0, footer.ClientSize.Width, 0);
            }
        };

        TableLayoutPanel layout = new TableLayoutPanel();
        layout.Dock = DockStyle.Fill;
        layout.Margin = Padding.Empty;
        layout.ColumnCount = 2;
        layout.RowCount = 1;
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 342F));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        footer.Controls.Add(layout);

        _lblDataDir = new Label();
        _lblDataDir.Dock = DockStyle.Fill;
        _lblDataDir.AutoEllipsis = true;
        _lblDataDir.ForeColor = MutedColor;
        _lblDataDir.TextAlign = ContentAlignment.MiddleLeft;
        layout.Controls.Add(_lblDataDir, 0, 0);

        FlowLayoutPanel actions = new FlowLayoutPanel();
        actions.Dock = DockStyle.Fill;
        actions.Margin = Padding.Empty;
        actions.Padding = Padding.Empty;
        actions.FlowDirection = FlowDirection.RightToLeft;
        actions.WrapContents = false;
        layout.Controls.Add(actions, 1, 0);

        Button btnCancel = MakeActionButton("Cancel", false, 86);
        btnCancel.Click += delegate { Close(); };
        actions.Controls.Add(btnCancel);

        Button btnSaveLaunch = MakeActionButton("Save & Launch", true, 122);
        btnSaveLaunch.Click += delegate { SaveAndClose(true); };
        actions.Controls.Add(btnSaveLaunch);

        Button btnSave = MakeActionButton("Save", false, 86);
        btnSave.Click += delegate { SaveAndClose(false); };
        actions.Controls.Add(btnSave);

        AcceptButton = btnSave;
        CancelButton = btnCancel;
        return footer;
    }

    private Panel BuildDisplayPage()
    {
        TableLayoutPanel content;
        Panel page = CreatePage("Display", "Window size, launch mode, and keyboard controls.", out content);

        AddSectionTitle(content, "Window");
        AddFieldLabel(content, "Aspect ratio");
        _comboAspectRatio = MakeChoiceCombo(220);
        _comboAspectRatio.Items.Add("16:9");
        _comboAspectRatio.Items.Add("16:10");
        _comboAspectRatio.Items.Add("21:9");
        _comboAspectRatio.Items.Add("32:9");
        _comboAspectRatio.Items.Add("4:3");
        _comboAspectRatio.Items.Add("5:4");
        _comboAspectRatio.Items.Add("3:2");
        _comboAspectRatio.Items.Add("Custom");
        _comboAspectRatio.SelectedIndexChanged += delegate { AspectRatioChanged(); };
        AddRow(content, _comboAspectRatio);

        AddFieldLabel(content, "Resolution preset");
        _comboResolutionPreset = MakeChoiceCombo(320);
        _comboResolutionPreset.SelectedIndexChanged += delegate { ResolutionPresetChanged(); };
        AddRow(content, _comboResolutionPreset);

        AddSubFieldLabel(content, "Custom width and height");

        FlowLayoutPanel resolution = new FlowLayoutPanel();
        resolution.Dock = DockStyle.Top;
        resolution.AutoSize = true;
        resolution.Margin = new Padding(12, 0, 0, 14);
        resolution.FlowDirection = FlowDirection.LeftToRight;
        resolution.WrapContents = false;

        _numWidth = MakeNumeric(400, 7680);
        _numHeight = MakeNumeric(300, 4320);
        _numWidth.Dock = DockStyle.None;
        _numHeight.Dock = DockStyle.None;
        _numWidth.Width = 118;
        _numHeight.Width = 118;
        _numWidth.Margin = Padding.Empty;
        _numHeight.Margin = Padding.Empty;
        resolution.Controls.Add(_numWidth);

        Label multiply = new Label();
        multiply.Text = "x";
        multiply.AutoSize = true;
        multiply.Margin = new Padding(7, 4, 7, 0);
        resolution.Controls.Add(multiply);
        resolution.Controls.Add(_numHeight);
        AddRow(content, resolution);
        _numWidth.ValueChanged += delegate { CustomResolutionChanged(); };
        _numHeight.ValueChanged += delegate { CustomResolutionChanged(); };

        AddFieldLabel(content, "Default launch mode");
        _comboMode = new PageScrollComboBox();
        _comboMode.DropDownStyle = ComboBoxStyle.DropDownList;
        _comboMode.Dock = DockStyle.Left;
        _comboMode.Width = 360;
        _comboMode.Tag = 360;
        _comboMode.Margin = new Padding(0, 0, 0, 8);
        _comboMode.Items.Add("window");
        _comboMode.Items.Add("bordered");
        _comboMode.Items.Add("borderless");
        _comboMode.Items.Add("exclusive");
        _comboMode.SelectedIndexChanged += delegate { UpdateModeDescription(); };
        AddRow(content, _comboMode);

        _lblModeDescription = MakeMutedBlock(30);
        _lblModeDescription.Margin = new Padding(0, 0, 0, 6);
        AddRow(content, _lblModeDescription);

        AddSeparator(content);
        AddSectionTitle(content, "Startup and window controls");

        AddFieldLabel(content, "Loading screen");
        _comboLoadingStyle = MakeChoiceCombo(360);
        _comboLoadingStyle.Items.Add(T("Whales"));
        _comboLoadingStyle.Items.Add(T("Progress console"));
        _comboLoadingStyle.Items.Add(T("Disabled"));
        _toolTip.SetToolTip(_comboLoadingStyle, "Whale animation, console-style progress, or no native loading screen.");
        AddRow(content, _comboLoadingStyle);

        AddFieldLabel(content, "When the title-bar X is clicked");
        _comboCloseAction = MakeChoiceCombo(360);
        _comboCloseAction.Items.Add(T("Minimize to tray"));
        _comboCloseAction.Items.Add(T("Exit application"));
        _comboCloseAction.SelectedIndexChanged += delegate { UpdateCloseActionUi(); };
        _toolTip.SetToolTip(_comboCloseAction, "Tray keeps the local service running. Exit closes the app and stops it.");
        AddRow(content, _comboCloseAction);

        _chkShowTrayButton = MakeCheckBox("Show a dedicated Minimize to tray button when X exits");
        AddRow(content, _chkShowTrayButton);

        AddSeparator(content);
        AddSectionTitle(content, "Fullscreen behavior");

        _chkFullscreenToolbar = MakeCheckBox("Keep the application toolbar visible in fullscreen");
        AddRow(content, _chkFullscreenToolbar);

        _chkFullscreenTaskbar = MakeCheckBox("Keep the Windows taskbar visible in borderless or exclusive fullscreen");
        AddRow(content, _chkFullscreenTaskbar);

        AddSeparator(content);
        AddSectionTitle(content, "Toolbar and shortcuts");

        _chkAutoHide = MakeCheckBox("Auto-hide toolbar");
        _toolTip.SetToolTip(_chkAutoHide, "Keep the toolbar hidden until the toolbar hotkey is pressed.");
        AddRow(content, _chkAutoHide);

        _chkEdgeReveal = MakeCheckBox("Reveal toolbar at the top screen edge");
        _toolTip.SetToolTip(_chkEdgeReveal, "Optional. The toolbar slides over the page without resizing the Web UI.");
        _chkAutoHide.CheckedChanged += delegate { _chkEdgeReveal.Enabled = _chkAutoHide.Checked; };
        AddRow(content, _chkEdgeReveal);

        AddFieldLabel(content, "Toolbar hotkey");
        _txtToolbarHotkey = MakeShortTextBox();
        _toolTip.SetToolTip(_txtToolbarHotkey, "Examples: F8 or Ctrl+Alt+F5");
        AddRow(content, _txtToolbarHotkey);

        AddFieldLabel(content, "Fullscreen hotkey");
        _txtFullscreenHotkey = MakeShortTextBox();
        _toolTip.SetToolTip(_txtFullscreenHotkey, "Example: F11");
        AddRow(content, _txtFullscreenHotkey);

        Label fixedKeys = MakeMutedBlock(28);
        fixedKeys.Text = "F12 opens DevTools. Esc exits fullscreen.";
        fixedKeys.Margin = new Padding(0, 4, 0, 0);
        AddRow(content, fixedKeys);
        return page;
    }

    private Panel BuildServerPage()
    {
        TableLayoutPanel content;
        Panel page = CreatePage("Server", "Local Web UI endpoint and runtime locations.", out content);

        AddSectionTitle(content, "Connection");
        AddFieldLabel(content, "Web UI URL");
        _txtUrl = MakeFullTextBox();
        AddRow(content, _txtUrl);

        AddFieldLabel(content, "Port");
        _numPort = MakeNumeric(1024, 65535);
        _numPort.Width = 160;
        _numPort.Dock = DockStyle.Left;
        AddRow(content, _numPort);

        AddSeparator(content);
        AddSectionTitle(content, "Runtime");
        AddFieldLabel(content, "node.exe path");
        _txtNodePath = MakeFullTextBox();
        Button btnNode = MakeBrowseButton();
        btnNode.Click += delegate
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Filter = "node.exe|node.exe";
                if (dlg.ShowDialog(this) == DialogResult.OK) _txtNodePath.Text = dlg.FileName;
            }
        };
        AddRow(content, MakeBrowseRow(_txtNodePath, btnNode));

        AddFieldLabel(content, "Harness folder");
        _txtRepoPath = MakeFullTextBox();
        Button btnRepo = MakeBrowseButton();
        btnRepo.Click += delegate
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                if (dlg.ShowDialog(this) == DialogResult.OK) _txtRepoPath.Text = dlg.SelectedPath;
            }
        };
        AddRow(content, MakeBrowseRow(_txtRepoPath, btnRepo));

        Label runtimeHint = MakeMutedBlock(38);
        runtimeHint.Text = "Leave either path blank to use automatic detection.";
        runtimeHint.Margin = new Padding(0, 4, 0, 0);
        AddRow(content, runtimeHint);
        return page;
    }

    private Panel BuildExtensionsPage()
    {
        TableLayoutPanel content;
        Panel page = CreatePage("Extensions & Dev", "Browser extensions and Web UI customization files.", out content);

        AddSectionTitle(content, "Browser extensions");
        _chkExtensions = MakeCheckBox("Enable unpacked Edge or Chrome extensions");
        _toolTip.SetToolTip(_chkExtensions, "Uses WebView2 msExtensions support.");
        AddRow(content, _chkExtensions);

        TableLayoutPanel extensionRow = new TableLayoutPanel();
        extensionRow.Dock = DockStyle.Top;
        extensionRow.Height = 174;
        extensionRow.MinimumSize = new Size(0, 174);
        extensionRow.Margin = new Padding(0, 0, 0, 14);
        extensionRow.ColumnCount = 2;
        extensionRow.RowCount = 1;
        extensionRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        extensionRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108F));
        extensionRow.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));

        _listExtensions = new ListBox();
        _listExtensions.Dock = DockStyle.Fill;
        _listExtensions.IntegralHeight = false;
        _listExtensions.Margin = new Padding(0, 0, 12, 0);
        extensionRow.Controls.Add(_listExtensions, 0, 0);

        FlowLayoutPanel extensionActions = new FlowLayoutPanel();
        extensionActions.Dock = DockStyle.Fill;
        extensionActions.Margin = Padding.Empty;
        extensionActions.FlowDirection = FlowDirection.TopDown;
        extensionActions.WrapContents = false;
        extensionRow.Controls.Add(extensionActions, 1, 0);

        Button btnAdd = MakeActionButton("Add", false, 96);
        btnAdd.Margin = new Padding(0, 0, 0, 8);
        btnAdd.Click += delegate
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Select an unpacked extension folder containing manifest.json";
                if (dlg.ShowDialog(this) == DialogResult.OK) _listExtensions.Items.Add(dlg.SelectedPath);
            }
        };
        extensionActions.Controls.Add(btnAdd);

        Button btnRemove = MakeActionButton("Remove", false, 96);
        btnRemove.Margin = Padding.Empty;
        btnRemove.Click += delegate
        {
            if (_listExtensions.SelectedIndex >= 0) _listExtensions.Items.RemoveAt(_listExtensions.SelectedIndex);
        };
        extensionActions.Controls.Add(btnRemove);
        AddRow(content, extensionRow);

        AddSeparator(content);
        AddSectionTitle(content, "Web UI injection");
        AddFieldLabel(content, "CSS file");
        _txtInjectCss = MakeFullTextBox();
        Button btnCss = MakeBrowseButton();
        btnCss.Click += delegate
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Filter = "CSS|*.css|All files|*.*";
                if (dlg.ShowDialog(this) == DialogResult.OK) _txtInjectCss.Text = dlg.FileName;
            }
        };
        AddRow(content, MakeBrowseRow(_txtInjectCss, btnCss));

        AddFieldLabel(content, "JavaScript file");
        _txtInjectJs = MakeFullTextBox();
        Button btnJs = MakeBrowseButton();
        btnJs.Click += delegate
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Filter = "JavaScript|*.js|All files|*.*";
                if (dlg.ShowDialog(this) == DialogResult.OK) _txtInjectJs.Text = dlg.FileName;
            }
        };
        AddRow(content, MakeBrowseRow(_txtInjectJs, btnJs));

        AddSeparator(content);
        AddSectionTitle(content, "Developer options");
        _chkDevTools = MakeCheckBox("Enable F12 DevTools window");
        AddRow(content, _chkDevTools);
        _chkExternalBrowser = MakeCheckBox("Open external links in the system browser");
        AddRow(content, _chkExternalBrowser);
        return page;
    }

    private Panel BuildHubAppearancePage()
    {
        TableLayoutPanel content;
        Panel page = CreatePage("HUB Appearance", "Theme and visual behavior stored only for HUB.", out content);

        AddSectionTitle(content, "Appearance");
        AddFieldLabel(content, "Color theme");
        _comboHubTheme = MakeChoiceCombo(360);
        _comboHubTheme.Items.Add(T("Follow Windows"));
        _comboHubTheme.Items.Add(T("Light"));
        _comboHubTheme.Items.Add(T("Dark"));
        AddRow(content, _comboHubTheme);

        Label hint = MakeMutedBlock(38);
        hint.Text = "The HUB theme does not change the main Desktop interface.";
        hint.Margin = new Padding(0, 4, 0, 0);
        AddRow(content, hint);
        return page;
    }

    private Panel BuildHubStartupPage()
    {
        TableLayoutPanel content;
        Panel page = CreatePage("HUB Startup", "Startup choices stored separately from the main Desktop program.", out content);

        AddSectionTitle(content, "Startup");
        AddFieldLabel(content, "Default HUB page");
        _comboHubStartPage = MakeChoiceCombo(360);
        _comboHubStartPage.Items.Add(T("Home"));
        _comboHubStartPage.Items.Add(T("Discovery"));
        _comboHubStartPage.Items.Add(T("Setup library"));
        _comboHubStartPage.Items.Add(T("Installed Setups"));
        AddRow(content, _comboHubStartPage);

        AddFieldLabel(content, "Default discovery source");
        _comboHubDiscoverySource = MakeChoiceCombo(360);
        _comboHubDiscoverySource.Items.Add(T("DSHMK verified market"));
        _comboHubDiscoverySource.Items.Add(T("Curated Setup market"));
        _comboHubDiscoverySource.Items.Add(T("Global GitHub"));
        AddRow(content, _comboHubDiscoverySource);

        Label hint = MakeMutedBlock(58);
        hint.Text = "DSHMK is the default live source. Its validation status and explicit install candidates decide whether one-click Setup is available.";
        hint.Margin = new Padding(0, 4, 0, 0);
        AddRow(content, hint);

        _chkHubAllowDesktopPlugins = MakeCheckBox("Allow Desktop plugins to affect HUB");
        AddRow(content, _chkHubAllowDesktopPlugins);
        Label isolationHint = MakeMutedBlock(48);
        isolationHint.Text = "Disabled by default: HUB uses an isolated Web Profile so Desktop sidebar and UI plugins do not leak into it.";
        isolationHint.Margin = new Padding(0, 2, 0, 0);
        AddRow(content, isolationHint);

        AddSeparator(content);
        AddSectionTitle(content, "Catalog and details");
        AddFieldLabel(content, "Projects per page");
        _comboHubPageSize = MakeChoiceCombo(360);
        foreach (int pageSize in new int[] { 12, 24, 48, 96, 200 }) _comboHubPageSize.Items.Add(pageSize.ToString());
        AddRow(content, _comboHubPageSize);

        AddFieldLabel(content, "Project detail entry");
        _comboHubDetailEntry = MakeChoiceCombo(360);
        _comboHubDetailEntry.Items.Add(T("Details button (recommended)"));
        _comboHubDetailEntry.Items.Add(T("Click the entire project card"));
        AddRow(content, _comboHubDetailEntry);

        AddFieldLabel(content, "Project detail presentation");
        _comboHubDetailMode = MakeChoiceCombo(360);
        _comboHubDetailMode.Items.Add(T("Side copilot panel"));
        _comboHubDetailMode.Items.Add(T("Centered modal"));
        _comboHubDetailMode.Items.Add(T("Full HUB surface"));
        AddRow(content, _comboHubDetailMode);

        AddFieldLabel(content, "Project detail content");
        _comboHubDetailContent = MakeChoiceCombo(360);
        _comboHubDetailContent.Items.Add(T("HUB reconstructed detail"));
        _comboHubDetailContent.Items.Add(T("Original source page"));
        AddRow(content, _comboHubDetailContent);

        AddSeparator(content);
        AddSectionTitle(content, "Startup and window controls");
        AddFieldLabel(content, "Loading screen");
        _comboHubLoadingStyle = MakeChoiceCombo(360);
        _comboHubLoadingStyle.Items.Add(T("Whales"));
        _comboHubLoadingStyle.Items.Add(T("Progress console"));
        _comboHubLoadingStyle.Items.Add(T("Disabled"));
        _toolTip.SetToolTip(_comboHubLoadingStyle, T("HUB loading and close behavior are stored separately from the main Desktop program."));
        AddRow(content, _comboHubLoadingStyle);

        AddFieldLabel(content, "When the title-bar X is clicked");
        _comboHubCloseAction = MakeChoiceCombo(360);
        _comboHubCloseAction.Items.Add(T("Minimize to tray"));
        _comboHubCloseAction.Items.Add(T("Exit application"));
        _comboHubCloseAction.SelectedIndexChanged += delegate { UpdateHubCloseActionUi(); };
        AddRow(content, _comboHubCloseAction);

        _chkHubShowTrayButton = MakeCheckBox("Show a dedicated Minimize to tray button when X exits");
        AddRow(content, _chkHubShowTrayButton);

        Label behaviorHint = MakeMutedBlock(42);
        behaviorHint.Text = "HUB loading and close behavior are stored separately from the main Desktop program.";
        behaviorHint.Margin = new Padding(0, 2, 0, 0);
        AddRow(content, behaviorHint);
        return page;
    }

    private static Dictionary<string, List<ResolutionOption>> BuildResolutionPresets()
    {
        Dictionary<string, List<ResolutionOption>> presets = new Dictionary<string, List<ResolutionOption>>();
        presets.Add("16:9", new List<ResolutionOption>
        {
            new ResolutionOption(1280, 720),
            new ResolutionOption(1366, 768),
            new ResolutionOption(1600, 900),
            new ResolutionOption(1920, 1080),
            new ResolutionOption(2560, 1440),
            new ResolutionOption(3840, 2160)
        });
        presets.Add("16:10", new List<ResolutionOption>
        {
            new ResolutionOption(1280, 800),
            new ResolutionOption(1440, 900),
            new ResolutionOption(1680, 1050),
            new ResolutionOption(1920, 1200),
            new ResolutionOption(2560, 1600),
            new ResolutionOption(3840, 2400)
        });
        presets.Add("21:9", new List<ResolutionOption>
        {
            new ResolutionOption(2560, 1080),
            new ResolutionOption(3440, 1440),
            new ResolutionOption(3840, 1600),
            new ResolutionOption(5120, 2160)
        });
        presets.Add("32:9", new List<ResolutionOption>
        {
            new ResolutionOption(3840, 1080),
            new ResolutionOption(5120, 1440),
            new ResolutionOption(7680, 2160)
        });
        presets.Add("4:3", new List<ResolutionOption>
        {
            new ResolutionOption(1024, 768),
            new ResolutionOption(1280, 960),
            new ResolutionOption(1600, 1200),
            new ResolutionOption(2048, 1536)
        });
        presets.Add("5:4", new List<ResolutionOption>
        {
            new ResolutionOption(1280, 1024),
            new ResolutionOption(2560, 2048)
        });
        presets.Add("3:2", new List<ResolutionOption>
        {
            new ResolutionOption(1440, 960),
            new ResolutionOption(1920, 1280),
            new ResolutionOption(2160, 1440),
            new ResolutionOption(3000, 2000)
        });
        return presets;
    }

    private Panel CreatePage(string title, string subtitle, out TableLayoutPanel content)
    {
        Panel page = new PageScrollPanel();
        page.Dock = DockStyle.Fill;
        page.Margin = Padding.Empty;
        page.BackColor = PageColor;

        content = new TableLayoutPanel();
        content.Dock = DockStyle.Top;
        content.AutoSize = true;
        content.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        content.Margin = Padding.Empty;
        content.Padding = new Padding(30, 20, 30, 6);
        content.ColumnCount = 1;
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        content.BackColor = PageColor;
        page.Controls.Add(content);

        Label heading = new Label();
        heading.Text = title;
        heading.UseMnemonic = false;
        heading.AutoSize = true;
        heading.Dock = DockStyle.Fill;
        heading.Margin = new Padding(0, 0, 0, 4);
        heading.Font = new Font(Font.FontFamily, 16F, FontStyle.Bold);
        heading.ForeColor = TextColor;
        AddRow(content, heading);

        Label description = MakeMutedBlock(28);
        description.Text = subtitle;
        description.Margin = new Padding(0, 0, 0, 2);
        AddRow(content, description);
        return page;
    }

    private RoundedChoiceControl MakeNavigationButton(string text, string key)
    {
        RoundedChoiceControl button = new RoundedChoiceControl();
        button.PrimaryText = T(text);
        button.Dock = DockStyle.Fill;
        button.Margin = new Padding(0, 3, 0, 3);
        button.SurfaceColor = ShellColor;
        button.HoverColor = Color.FromArgb(237, 241, 246);
        button.PressedColor = Color.FromArgb(229, 235, 243);
        button.BorderColor = LineColor;
        button.BorderSize = 0;
        button.Radius = 10;
        button.ForeColor = TextColor;
        button.SecondaryColor = MutedColor;
        button.Font = new Font(Font.FontFamily, 9.5F, FontStyle.Regular);
        button.Click += delegate
        {
            SetConfigTargetMenuExpanded(false);
            ShowPage(key);
        };
        _navigationButtons.Add(key, button);
        return button;
    }

    private Button MakeActionButton(string text, bool primary, int width)
    {
        Button button = new Button();
        button.Text = text;
        button.UseMnemonic = false;
        button.Size = new Size(width, 36);
        button.Margin = new Padding(6, 0, 0, 0);
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = primary ? AccentColor : LineColor;
        button.BackColor = primary ? AccentColor : PageColor;
        button.ForeColor = primary ? Color.White : TextColor;
        button.Cursor = Cursors.Hand;
        return button;
    }

    private Button MakeBrowseButton()
    {
        Button button = MakeActionButton("Browse", false, 96);
        button.Dock = DockStyle.Fill;
        button.Margin = Padding.Empty;
        return button;
    }

    private NumericUpDown MakeNumeric(int min, int max)
    {
        NumericUpDown numeric = new PageScrollNumericUpDown();
        numeric.Dock = DockStyle.Fill;
        numeric.Minimum = min;
        numeric.Maximum = max;
        numeric.Margin = Padding.Empty;
        numeric.ThousandsSeparator = true;
        return numeric;
    }

    private ComboBox MakeChoiceCombo(int width)
    {
        ComboBox comboBox = new PageScrollComboBox();
        comboBox.DropDownStyle = ComboBoxStyle.DropDownList;
        comboBox.Dock = DockStyle.Left;
        comboBox.Width = width;
        comboBox.Tag = width;
        comboBox.Margin = new Padding(0, 0, 0, 12);
        return comboBox;
    }

    private TextBox MakeFullTextBox()
    {
        TextBox textBox = new TextBox();
        textBox.Dock = DockStyle.Fill;
        textBox.Margin = new Padding(0, 0, 0, 12);
        return textBox;
    }

    private TextBox MakeShortTextBox()
    {
        TextBox textBox = new TextBox();
        textBox.Dock = DockStyle.Left;
        textBox.Width = 190;
        textBox.Margin = new Padding(0, 0, 0, 12);
        return textBox;
    }

    private CheckBox MakeCheckBox(string text)
    {
        CheckBox checkBox = new CheckBox();
        checkBox.Text = text;
        checkBox.Dock = DockStyle.Top;
        checkBox.AutoSize = true;
        checkBox.Margin = new Padding(0, 0, 0, 12);
        checkBox.ForeColor = TextColor;
        return checkBox;
    }

    private TableLayoutPanel MakeBrowseRow(TextBox textBox, Button button)
    {
        textBox.Margin = new Padding(0, 0, 12, 0);

        TableLayoutPanel row = new TableLayoutPanel();
        row.Dock = DockStyle.Top;
        row.AutoSize = true;
        row.Margin = new Padding(0, 0, 0, 14);
        row.ColumnCount = 2;
        row.RowCount = 1;
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96F));
        row.Controls.Add(textBox, 0, 0);
        row.Controls.Add(button, 1, 0);
        return row;
    }

    private void AddSectionTitle(TableLayoutPanel content, string text)
    {
        Label label = new Label();
        label.Text = text;
        label.AutoSize = true;
        label.Dock = DockStyle.Fill;
        label.Margin = new Padding(0, 6, 0, 10);
        label.Font = new Font(Font.FontFamily, 11F, FontStyle.Bold);
        label.ForeColor = TextColor;
        AddRow(content, label);
    }

    private void AddFieldLabel(TableLayoutPanel content, string text)
    {
        Label label = new Label();
        label.Text = text;
        label.AutoSize = true;
        label.Dock = DockStyle.Fill;
        label.Margin = new Padding(0, 0, 0, 5);
        label.ForeColor = TextColor;
        AddRow(content, label);
    }

    private void AddSubFieldLabel(TableLayoutPanel content, string text)
    {
        Label label = new Label();
        label.Text = text;
        label.AutoSize = true;
        label.Dock = DockStyle.Fill;
        label.Margin = new Padding(12, 2, 0, 5);
        label.ForeColor = MutedColor;
        AddRow(content, label);
    }

    private Label MakeMutedBlock(int height)
    {
        Label label = new Label();
        label.AutoSize = false;
        label.Dock = DockStyle.Fill;
        label.Height = height;
        label.MinimumSize = new Size(0, height);
        label.ForeColor = MutedColor;
        label.TextAlign = ContentAlignment.TopLeft;
        return label;
    }

    private void AddSeparator(TableLayoutPanel content)
    {
        Panel line = new Panel();
        line.Dock = DockStyle.Top;
        line.Height = 1;
        line.MinimumSize = new Size(0, 1);
        line.Margin = new Padding(0, 8, 0, 8);
        line.BackColor = LineColor;
        AddRow(content, line);
    }

    private void AddRow(TableLayoutPanel content, Control control)
    {
        int row = content.RowCount;
        content.RowCount++;
        content.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        content.Controls.Add(control, 0, row);
    }

    private void ShowPage(string key)
    {
        foreach (KeyValuePair<string, Panel> item in _pages)
        {
            item.Value.Visible = item.Key == key;
        }

        foreach (KeyValuePair<string, RoundedChoiceControl> item in _navigationButtons)
        {
            bool selected = item.Key == key;
            item.Value.Selected = selected;
            item.Value.SurfaceColor = selected ? PageColor : ShellColor;
            item.Value.HoverColor = selected ? PageColor : Color.FromArgb(237, 241, 246);
            item.Value.BorderSize = selected ? 1 : 0;
            item.Value.BorderColor = selected ? LineColor : ShellColor;
            item.Value.ForeColor = TextColor;
            item.Value.Invalidate();
        }

        Panel selectedPage;
        if (_pages.TryGetValue(key, out selectedPage))
        {
            selectedPage.AutoScrollPosition = Point.Empty;
            selectedPage.BringToFront();
        }
    }

    private void AspectRatioChanged()
    {
        if (_updatingResolutionControls || _comboAspectRatio.SelectedItem == null) return;

        string ratio = _comboAspectRatio.SelectedItem.ToString();
        int width = (int)_numWidth.Value;
        int height = (int)_numHeight.Value;

        _updatingResolutionControls = true;
        ResolutionOption selected = PopulateResolutionPresetItems(ratio, width, height);
        if (ratio != "Custom" && selected.IsCustom && FindAspectRatio(width, height) != ratio)
        {
            selected = (ResolutionOption)_comboResolutionPreset.Items[0];
            _comboResolutionPreset.SelectedItem = selected;
            ApplyResolution(selected);
        }
        _updatingResolutionControls = false;
    }

    private void ResolutionPresetChanged()
    {
        if (_updatingResolutionControls) return;
        ResolutionOption option = _comboResolutionPreset.SelectedItem as ResolutionOption;
        if (option == null || option.IsCustom) return;

        _updatingResolutionControls = true;
        ApplyResolution(option);
        _updatingResolutionControls = false;
    }

    private void CustomResolutionChanged()
    {
        if (_updatingResolutionControls) return;
        SyncResolutionSelectorsFromNumbers();
    }

    private void SyncResolutionSelectorsFromNumbers()
    {
        int width = (int)_numWidth.Value;
        int height = (int)_numHeight.Value;
        string ratio = FindAspectRatio(width, height);

        _updatingResolutionControls = true;
        _comboAspectRatio.SelectedItem = ratio;
        PopulateResolutionPresetItems(ratio, width, height);
        _updatingResolutionControls = false;
    }

    private ResolutionOption PopulateResolutionPresetItems(string ratio, int width, int height)
    {
        _comboResolutionPreset.BeginUpdate();
        _comboResolutionPreset.Items.Clear();

        ResolutionOption selected = null;
        List<ResolutionOption> options;
        if (_resolutionPresets.TryGetValue(ratio, out options))
        {
            foreach (ResolutionOption option in options)
            {
                _comboResolutionPreset.Items.Add(option);
                if (option.Width == width && option.Height == height) selected = option;
            }
        }

        ResolutionOption custom = ResolutionOption.Custom();
        _comboResolutionPreset.Items.Add(custom);
        if (selected == null) selected = custom;
        _comboResolutionPreset.SelectedItem = selected;
        _comboResolutionPreset.EndUpdate();
        return selected;
    }

    private string FindAspectRatio(int width, int height)
    {
        string[] ratios = new string[] { "16:9", "16:10", "21:9", "32:9", "4:3", "5:4", "3:2" };
        foreach (string ratio in ratios)
        {
            List<ResolutionOption> options = _resolutionPresets[ratio];
            foreach (ResolutionOption option in options)
            {
                if (option.Width == width && option.Height == height) return ratio;
            }
        }

        if (width * 9 == height * 16) return "16:9";
        if (width * 10 == height * 16) return "16:10";
        if (width * 9 == height * 21) return "21:9";
        if (width * 9 == height * 32) return "32:9";
        if (width * 3 == height * 4) return "4:3";
        if (width * 4 == height * 5) return "5:4";
        if (width * 2 == height * 3) return "3:2";
        return "Custom";
    }

    private void ApplyResolution(ResolutionOption option)
    {
        _numWidth.Value = Math.Max(_numWidth.Minimum, Math.Min(_numWidth.Maximum, option.Width));
        _numHeight.Value = Math.Max(_numHeight.Minimum, Math.Min(_numHeight.Maximum, option.Height));
    }

    private void UpdateModeDescription()
    {
        if (_lblModeDescription == null || _comboMode.SelectedItem == null) return;

        switch (_comboMode.SelectedItem.ToString())
        {
            case "bordered":
                _lblModeDescription.Text = T("Maximized with the standard window border.");
                break;
            case "borderless":
                _lblModeDescription.Text = T("Borderless fullscreen that leaves normal window priority.");
                break;
            case "exclusive":
                _lblModeDescription.Text = T("Borderless, always on top, and covers the taskbar.");
                break;
            default:
                _lblModeDescription.Text = T("A normal resizable window. Oversized resolutions are fitted to the current desktop.");
                break;
        }
    }

    private void UpdateCloseActionUi()
    {
        if (_chkShowTrayButton == null || _comboCloseAction == null) return;
        bool exits = _comboCloseAction.SelectedIndex == 1;
        _chkShowTrayButton.Visible = exits;
    }

    private void UpdateHubCloseActionUi()
    {
        if (_chkHubShowTrayButton == null || _comboHubCloseAction == null) return;
        _chkHubShowTrayButton.Visible = _comboHubCloseAction.SelectedIndex == 1;
    }

    private void LoadValues()
    {
        if (_hubConfigMode)
        {
            _comboHubTheme.SelectedIndex = _hubCfg.Theme == "light" ? 1 : (_hubCfg.Theme == "dark" ? 2 : 0);
            _comboHubStartPage.SelectedIndex = _hubCfg.StartPage == "github" ? 1 : (_hubCfg.StartPage == "library" ? 2 : (_hubCfg.StartPage == "installed" ? 3 : 0));
            _comboHubDiscoverySource.SelectedIndex = _hubCfg.DiscoverySource == "github" ? 2 : (_hubCfg.DiscoverySource == "community" ? 1 : 0);
            _comboHubPageSize.SelectedIndex = Math.Max(0, _comboHubPageSize.Items.IndexOf(_hubCfg.PageSize.ToString()));
            _comboHubDetailEntry.SelectedIndex = _hubCfg.DetailEntry == "card" ? 1 : 0;
            _comboHubDetailMode.SelectedIndex = _hubCfg.DetailMode == "modal" ? 1 : (_hubCfg.DetailMode == "full" ? 2 : 0);
            _comboHubDetailContent.SelectedIndex = _hubCfg.DetailContent == "original" ? 1 : 0;
            _comboHubLoadingStyle.SelectedIndex = _hubCfg.LoadingStyle == "progress" ? 1 : (_hubCfg.LoadingStyle == "off" ? 2 : 0);
            _comboHubCloseAction.SelectedIndex = _hubCfg.CloseAction == "tray" ? 0 : 1;
            _chkHubShowTrayButton.Checked = _hubCfg.ShowTrayButton;
            _chkHubAllowDesktopPlugins.Checked = _hubCfg.AllowDesktopPlugins;
            UpdateHubCloseActionUi();
            _lblDataDir.Text = AppPaths.IsPortable ? T("HUB configuration stored in portable data") : T("HUB configuration stored in user data");
            _toolTip.SetToolTip(_lblDataDir, AppPaths.HubConfigFile);
            return;
        }
        _updatingResolutionControls = true;
        _numWidth.Value = Math.Max(_numWidth.Minimum, Math.Min(_numWidth.Maximum, _cfg.ResolutionWidth));
        _numHeight.Value = Math.Max(_numHeight.Minimum, Math.Min(_numHeight.Maximum, _cfg.ResolutionHeight));
        _updatingResolutionControls = false;
        SyncResolutionSelectorsFromNumbers();
        int idx = _comboMode.Items.IndexOf(_cfg.LaunchMode);
        _comboMode.SelectedIndex = idx >= 0 ? idx : 0;
        _chkAutoHide.Checked = _cfg.ToolbarAutoHide;
        _chkEdgeReveal.Checked = _cfg.ToolbarEdgeReveal;
        _chkEdgeReveal.Enabled = _chkAutoHide.Checked;
        _comboLoadingStyle.SelectedIndex = _cfg.LoadingStyle == "progress" ? 1 : (_cfg.LoadingStyle == "off" ? 2 : 0);
        _comboCloseAction.SelectedIndex = _cfg.CloseAction == "exit" ? 1 : 0;
        _chkShowTrayButton.Checked = _cfg.ShowTrayButton;
        _chkFullscreenToolbar.Checked = _cfg.FullscreenShowToolbar;
        _chkFullscreenTaskbar.Checked = _cfg.FullscreenShowTaskbar;
        UpdateCloseActionUi();
        _txtToolbarHotkey.Text = _cfg.ToolbarHotkey;
        _txtFullscreenHotkey.Text = _cfg.FullscreenHotkey;
        _txtUrl.Text = _cfg.Url;
        _numPort.Value = Math.Max(_numPort.Minimum, Math.Min(_numPort.Maximum, _cfg.Port));
        _txtNodePath.Text = _cfg.NodePath;
        _txtRepoPath.Text = _cfg.RepoPath;
        _chkExtensions.Checked = _cfg.EnableExtensions;
        _listExtensions.Items.Clear();
        foreach (string ext in _cfg.Extensions)
        {
            _listExtensions.Items.Add(ext);
        }
        _txtInjectCss.Text = _cfg.InjectCss;
        _txtInjectJs.Text = _cfg.InjectJs;
        _chkDevTools.Checked = _cfg.DevTools;
        _chkExternalBrowser.Checked = _cfg.ExternalLinksInBrowser;
        _lblDataDir.Text = AppPaths.IsPortable ? T("Configuration stored in portable data") : T("Configuration stored in user data");
        _toolTip.SetToolTip(_lblDataDir, AppPaths.ConfigFile);
        UpdateModeDescription();
    }

    private void CollectValues()
    {
        if (_hubConfigMode)
        {
            _hubCfg.Theme = _comboHubTheme.SelectedIndex == 1 ? "light" : (_comboHubTheme.SelectedIndex == 2 ? "dark" : "system");
            _hubCfg.StartPage = _comboHubStartPage.SelectedIndex == 1 ? "github" : (_comboHubStartPage.SelectedIndex == 2 ? "library" : (_comboHubStartPage.SelectedIndex == 3 ? "installed" : "home"));
            _hubCfg.DiscoverySource = _comboHubDiscoverySource.SelectedIndex == 2 ? "github" : (_comboHubDiscoverySource.SelectedIndex == 1 ? "community" : "dshmk");
            int pageSize;
            _hubCfg.PageSize = int.TryParse(Convert.ToString(_comboHubPageSize.SelectedItem), out pageSize) ? pageSize : 24;
            _hubCfg.DetailEntry = _comboHubDetailEntry.SelectedIndex == 1 ? "card" : "button";
            _hubCfg.DetailMode = _comboHubDetailMode.SelectedIndex == 1 ? "modal" : (_comboHubDetailMode.SelectedIndex == 2 ? "full" : "side");
            _hubCfg.DetailContent = _comboHubDetailContent.SelectedIndex == 1 ? "original" : "native";
            _hubCfg.LoadingStyle = _comboHubLoadingStyle.SelectedIndex == 1 ? "progress" : (_comboHubLoadingStyle.SelectedIndex == 2 ? "off" : "whales");
            _hubCfg.CloseAction = _comboHubCloseAction.SelectedIndex == 0 ? "tray" : "exit";
            _hubCfg.ShowTrayButton = _chkHubShowTrayButton.Checked;
            _hubCfg.AllowDesktopPlugins = _chkHubAllowDesktopPlugins.Checked;
            return;
        }
        _cfg.ResolutionWidth = (int)_numWidth.Value;
        _cfg.ResolutionHeight = (int)_numHeight.Value;
        _cfg.LaunchMode = _comboMode.SelectedItem == null ? "window" : _comboMode.SelectedItem.ToString();
        _cfg.ToolbarAutoHide = _chkAutoHide.Checked;
        _cfg.ToolbarEdgeReveal = _chkEdgeReveal.Checked;
        _cfg.LoadingStyle = _comboLoadingStyle.SelectedIndex == 1 ? "progress" : (_comboLoadingStyle.SelectedIndex == 2 ? "off" : "whales");
        _cfg.CloseAction = _comboCloseAction.SelectedIndex == 1 ? "exit" : "tray";
        _cfg.ShowTrayButton = _chkShowTrayButton.Checked;
        _cfg.FullscreenShowToolbar = _chkFullscreenToolbar.Checked;
        _cfg.FullscreenShowTaskbar = _chkFullscreenTaskbar.Checked;
        _cfg.ToolbarHotkey = _txtToolbarHotkey.Text.Trim();
        _cfg.FullscreenHotkey = _txtFullscreenHotkey.Text.Trim();
        _cfg.Url = _txtUrl.Text.Trim();
        _cfg.Port = (int)_numPort.Value;
        _cfg.NodePath = _txtNodePath.Text.Trim();
        _cfg.RepoPath = _txtRepoPath.Text.Trim();
        _cfg.EnableExtensions = _chkExtensions.Checked;
        _cfg.Extensions = new List<string>();
        foreach (object item in _listExtensions.Items)
        {
            _cfg.Extensions.Add(item.ToString());
        }
        _cfg.InjectCss = _txtInjectCss.Text.Trim();
        _cfg.InjectJs = _txtInjectJs.Text.Trim();
        _cfg.DevTools = _chkDevTools.Checked;
        _cfg.ExternalLinksInBrowser = _chkExternalBrowser.Checked;
    }

    private void SaveAndClose(bool launch)
    {
        try
        {
            CollectValues();
            _cfg.FirstRunCompleted = true;
            _cfg.Save();
            _hubCfg.Save();
            LaunchAfterClose = launch;
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, (_cfg.Language == "zh-CN" ? "保存失败：" : "Save failed: ") + ex.Message,
                "CONFIG",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    internal void LaunchApplicationAfterClose()
    {
        try
        {
            string main = Path.Combine(AppPaths.ExeDir, _hubConfigMode ? "dsh-hub.exe" : "dsh.exe");
            if (!File.Exists(main)) return;
            ProcessStartInfo startInfo = new ProcessStartInfo("explorer.exe");
            startInfo.Arguments = "\"" + main.Replace("\"", "\\\"") + "\"";
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);
        }
        catch (Exception ex)
        {
            MessageBox.Show((_cfg.Language == "zh-CN" ? "启动失败：" : "Launch failed: ") + ex.Message,
                "CONFIG", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
