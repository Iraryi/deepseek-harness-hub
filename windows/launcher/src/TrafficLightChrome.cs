using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class TrafficLightChrome : Panel
{
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr parameter, IntPtr data);
    private readonly Form _form;
    private readonly Label _title;
    private readonly ToolTip _tips = new ToolTip();

    public TrafficLightChrome(Form form, bool chinese, bool dark)
    {
        _form = form;
        Height = 38;
        Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        BackColor = dark ? Color.FromArgb(32, 35, 42) : Color.FromArgb(234, 239, 247);
        _title = new Label { Text = form.Text, TextAlign = ContentAlignment.MiddleCenter, AutoEllipsis = true, ForeColor = dark ? Color.WhiteSmoke : Color.FromArgb(48, 56, 72), BackColor = Color.Transparent };
        Controls.Add(_title);
        AddButton(Color.FromArgb(255, 95, 87), chinese ? "关闭" : "Close", 10, delegate { form.Close(); });
        AddButton(Color.FromArgb(255, 189, 46), chinese ? "最小化" : "Minimize", 40, delegate { form.WindowState = FormWindowState.Minimized; });
        AddButton(Color.FromArgb(40, 200, 64), chinese ? "最大化 / 还原" : "Maximize / restore", 70, ToggleMaximize);
        MouseDown += Drag;
        _title.MouseDown += Drag;
        DoubleClick += delegate { ToggleMaximize(); };
        _title.DoubleClick += delegate { ToggleMaximize(); };
        Resize += delegate { _title.SetBounds(112, 0, Math.Max(0, Width - 224), Height); };
    }

    private void ToggleMaximize()
    {
        _form.WindowState = _form.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
    }

    private void Drag(object sender, MouseEventArgs args)
    {
        if (args.Button != MouseButtons.Left || args.Clicks != 1) return;
        ReleaseCapture();
        SendMessage(_form.Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
    }

    private void AddButton(Color color, string label, int left, Action action)
    {
        Button button = new Button { AccessibleName = label, FlatStyle = FlatStyle.Flat, BackColor = BackColor, TabStop = true, Cursor = Cursors.Hand };
        button.FlatAppearance.BorderSize = 0;
        button.SetBounds(left, 5, 28, 28);
        button.Paint += delegate(object sender, PaintEventArgs args) {
            args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (Brush brush = new SolidBrush(color)) args.Graphics.FillEllipse(brush, 7, 7, 14, 14);
        };
        button.Click += delegate { action(); };
        _tips.SetToolTip(button, label);
        Controls.Add(button);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _tips.Dispose();
        base.Dispose(disposing);
    }
}
