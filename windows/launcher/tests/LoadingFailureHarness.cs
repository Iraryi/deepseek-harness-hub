using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class LoadingFailureHarness
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Expected launcher and screenshot directory");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Directory.CreateDirectory(args[1]);
        Type type = Assembly.LoadFrom(Path.GetFullPath(args[0])).GetType("LoadingOverlay", true);
        foreach (string language in new string[] { "zh-CN", "en-US" })
        foreach (Size size in new Size[] { new Size(1024, 768), new Size(640, 480) })
        {
            using (Form form = new Form())
            using (Control overlay = (Control)Activator.CreateInstance(type, new object[] { "off", "DSH", language }))
            {
                form.Text = "DSH startup diagnostics layout test";
                form.ClientSize = size;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.Controls.Add(overlay);
                int retries = 0;
                type.GetEvent("RetryRequested").AddEventHandler(overlay, new EventHandler(delegate { retries++; }));
                type.GetField("DiagnosticText").SetValue(overlay, new Func<string>(delegate {
                    return "DSH 0.1.3-alpha.2" + Environment.NewLine
                        + "Windows startup diagnostics" + Environment.NewLine + Environment.NewLine
                        + "error: unknown option '--patch'" + Environment.NewLine
                        + "PACKAGED_FAILURE_PROBE: the local service exited with code 1.";
                }));
                form.Show();
                Application.DoEvents();
                type.GetMethod("ShowError").Invoke(overlay, new object[] { "Local service exited (code 1) — open the toolbar log" });
                Application.DoEvents();
                if (!overlay.Visible) throw new Exception("Errors must remain visible when loading animation is off");
                type.GetMethod("SetStage").Invoke(overlay, new object[] { "Browser engine ready", 58F });
                if (!(bool)type.GetField("_error", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(overlay))
                    throw new Exception("Late progress replaced terminal startup error");

                Rectangle viewport = form.RectangleToScreen(form.ClientRectangle);
                List<Button> buttons = new List<Button>();
                Inspect(overlay, viewport, buttons);
                if (buttons.Count != 4) throw new Exception("Expected four recovery actions");
                for (int first = 0; first < buttons.Count; first++)
                for (int second = first + 1; second < buttons.Count; second++)
                {
                    if (buttons[first].RectangleToScreen(buttons[first].ClientRectangle).IntersectsWith(
                        buttons[second].RectangleToScreen(buttons[second].ClientRectangle)))
                        throw new Exception("Recovery actions overlap");
                }
                using (Bitmap bitmap = new Bitmap(form.ClientSize.Width, form.ClientSize.Height))
                {
                    overlay.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                    bitmap.Save(Path.Combine(args[1], language + "-" + size.Width + "x" + size.Height + ".png"), ImageFormat.Png);
                }
                buttons.Find(delegate(Button button) { return button.AccessibleName == "Retry startup"; }).PerformClick();
                if (retries != 1) throw new Exception("Retry action was not delivered");
                type.GetMethod("Reset").Invoke(overlay, null);
                if (overlay.Visible) throw new Exception("Retry must respect disabled loading animation");
                form.Close();
                Console.WriteLine(language + " " + size + ": visible diagnostics, four accessible actions, retry and reset passed");
            }
        }
    }

    private static void Inspect(Control parent, Rectangle viewport, List<Button> buttons)
    {
        foreach (Control child in parent.Controls)
        {
            if (!child.Visible) continue;
            Button button = child as Button;
            if (button != null)
            {
                if (!viewport.Contains(button.RectangleToScreen(button.ClientRectangle)))
                    throw new Exception("Recovery button lies outside the window: " + button.Text);
                if (button.Height < button.Font.Height + button.Padding.Vertical)
                    throw new Exception("Recovery button text is clipped: " + button.Text);
                buttons.Add(button);
            }
            TextBox details = child as TextBox;
            if (details != null && (details.Height < 80 || !details.Text.Contains("unknown option")))
                throw new Exception("Error details are missing or unreadable");
            Inspect(child, viewport, buttons);
        }
    }
}
