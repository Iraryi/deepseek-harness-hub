using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ConfigEditorHarness
{
    private static int _checks;
    private static void Require(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        _checks++;
    }

    private static Dictionary<string, object> Read(string target) { return (Dictionary<string, object>)ConfigEditor.Read(target); }
    private static void Reject(Action action, string name)
    {
        try { action(); } catch (InvalidOperationException) { _checks++; return; }
        throw new Exception("Expected rejection: " + name);
    }

    [STAThread]
    private static void Main(string[] args)
    {
        try { Run(args); }
        catch (Exception error) { Console.WriteLine(error.GetType().FullName + ": " + error.Message); Environment.ExitCode = 1; }
    }

    private static void Run(string[] args)
    {
        string root = Path.GetFullPath(args[0]);
        if (!root.StartsWith("D:\\", StringComparison.OrdinalIgnoreCase) || Directory.Exists(root)) throw new Exception("Fresh D: fixture required");
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_DATA_DIR", root);
        Environment.SetEnvironmentVariable("DSH_HOME", Path.Combine(root, "home with spaces"));
        Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_INSTANCE_SCOPE", "CONFIG-FIXTURE");
        string companion = AppPaths.CompanionArguments("--hub");
        Require(companion.Contains("--dsh-data-dir \"" + root + "\""), "companion retains data root");
        Require(companion.Contains("--dsh-home \"" + Path.Combine(root, "home with spaces") + "\""), "companion retains spaced home");
        Require(companion.Contains("--dsh-instance-scope \"CONFIG-FIXTURE\""), "companion retains instance identity");
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        string original = "{\"FirstRunCompleted\":true,\"ResolutionWidth\":1500,\"Extensions\":[\"D:\\\\Plugins\\\\用户扩展\"],\"UnknownExtensionPreference\":{\"keep\":true}}";
        File.WriteAllText(AppPaths.ConfigFile, original, new UTF8Encoding(false));
        string revision = (string)Read("dsh")["revision"];
        Dictionary<string, object> result = (Dictionary<string, object>)ConfigEditor.Save("dsh", revision,
            new Dictionary<string, object> { { "WindowChrome", "traffic" }, { "ResolutionWidth", 1600 } });
        Dictionary<string, object> stored = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(AppPaths.ConfigFile));
        Require((bool)stored["FirstRunCompleted"], "onboarding preserved");
        Require(stored.ContainsKey("UnknownExtensionPreference"), "unknown fields preserved");
        Require(serializer.Serialize(stored["Extensions"]).Contains("用户扩展"), "extensions preserved");
        Require(File.ReadAllText(AppPaths.ConfigFile + ".before-config-edit.bak") == original, "exact previous file backup");
        Require((string)((Dictionary<string, object>)result["values"])["WindowChrome"] == "traffic", "new style persisted");
        byte[] saved = File.ReadAllBytes(AppPaths.ConfigFile);
        Reject(delegate { ConfigEditor.Save("dsh", revision, new Dictionary<string, object> { { "ResolutionWidth", 1700 } }); }, "stale revision");
        revision = (string)result["revision"];
        Reject(delegate { ConfigEditor.Save("dsh", revision, new Dictionary<string, object> { { "FirstRunCompleted", false } }); }, "protected field");
        Reject(delegate { ConfigEditor.Save("dsh", revision, new Dictionary<string, object> { { "WindowChrome", "invalid" } }); }, "choice");
        Reject(delegate { ConfigEditor.Save("dsh", revision, new Dictionary<string, object> { { "ResolutionWidth", 0 } }); }, "range");
        Reject(delegate { ConfigEditor.Save("dsh", revision, new Dictionary<string, object> { { "DevTools", "true" } }); }, "boolean type");
        Require(Convert.ToBase64String(File.ReadAllBytes(AppPaths.ConfigFile)) == Convert.ToBase64String(saved), "failures never alter original");
        Dictionary<string, object> arrayPatch = serializer.Deserialize<Dictionary<string, object>>("{\"Extensions\":[\"D:\\\\Extensions\\\\new\"]}");
        ConfigEditor.Save("dsh", revision, arrayPatch);
        Require(File.ReadAllText(AppPaths.ConfigFile).Contains("new"), "bridge extension array accepted");
        saved = File.ReadAllBytes(AppPaths.ConfigFile);
        Require((bool)((Dictionary<string, object>)Read("hub")["values"])["PreloadOnDesktopStart"], "preload defaults on for older HUB documents");
        ConfigEditor.Save("hub", (string)Read("hub")["revision"], new Dictionary<string, object> { { "PreloadOnDesktopStart", false } });
        Require(!HubConfig.Load().PreloadOnDesktopStart, "preload opt-out persists");
        ConfigEditor.Save("hub", (string)Read("hub")["revision"], new Dictionary<string, object> { { "Theme", "dark" }, { "WindowChrome", "traffic" } });
        Require(Convert.ToBase64String(File.ReadAllBytes(AppPaths.ConfigFile)) == Convert.ToBase64String(saved), "HUB save does not rewrite DSH");
        Require((string)((Dictionary<string, object>)Read("hub")["values"])["Theme"] == "dark", "HUB target saved");
        File.WriteAllText(AppPaths.HubConfigFile, "broken config");
        bool rejected = false;
        try { Read("hub"); } catch { rejected = true; }
        Require(rejected && File.ReadAllText(AppPaths.HubConfigFile) == "broken config", "corruption remains intact");
        Application.EnableVisualStyles();
        foreach (bool dark in new bool[] { false, true })
        {
            using (Form form = new Form { Text = "HUB", FormBorderStyle = FormBorderStyle.None, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Location = new Point(-20000, -20000), ClientSize = new Size(1024, 768), BackColor = dark ? Color.FromArgb(24, 26, 32) : Color.FromArgb(247, 249, 252) })
            using (TrafficLightChrome chrome = new TrafficLightChrome(form, true, dark))
            {
                chrome.Width = form.ClientSize.Width;
                form.Controls.Add(chrome);
                form.Show();
                Application.DoEvents();
                Require(chrome.Controls.Count == 4, "title and three controls");
                using (Bitmap bitmap = new Bitmap(form.Width, form.Height))
                {
                    form.DrawToBitmap(bitmap, form.ClientRectangle);
                    bitmap.Save(Path.Combine(root, dark ? "chrome-dark.png" : "chrome-light.png"));
                }
                form.Hide();
            }
        }
        Console.WriteLine("PASS: " + _checks + " CONFIG isolation, conflict, validation, persistence and chrome checks");
    }
}
