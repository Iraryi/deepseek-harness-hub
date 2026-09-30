using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

internal static class EnhancementSettingsHarness
{
    private static int checks;
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (InvalidOperationException) { checks++; return; }
        throw new Exception("Expected rejection");
    }
    private static int Main(string[] args)
    {
        try
        {
            string root = Path.GetFullPath(args[0]);
            if (!root.StartsWith("D:\\", StringComparison.OrdinalIgnoreCase) || Directory.Exists(root)) throw new Exception("Fresh D: fixture required.");
            Directory.CreateDirectory(root);
            Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_DATA_DIR", root);
            Dictionary<string, object> document = EnhancementSettings.Read();
            Require(!File.Exists(EnhancementSettings.FilePath), "Read must not write defaults");
            Require((int)((Dictionary<string, object>)document["values"])["conversationWidth"] == 0, "Automatic width default");
            string revision = (string)document["revision"];
            Dictionary<string, object> saved = EnhancementSettings.Save(revision, new Dictionary<string, object> { { "conversationWidth", 1000 }, { "plainTextPaste", true } });
            Require((bool)saved["restartRequired"], "Restart explicit");
            Require((int)((Dictionary<string, object>)saved["values"])["conversationWidth"] == 1000, "Width saved");
            Reject(delegate { EnhancementSettings.Save(revision, new Dictionary<string, object>()); });
            revision = (string)saved["revision"];
            string before = File.ReadAllText(EnhancementSettings.FilePath);
            Reject(delegate { EnhancementSettings.Save(revision, new Dictionary<string, object> { { "conversationWidth", 2001 } }); });
            Reject(delegate { EnhancementSettings.Save(revision, new Dictionary<string, object> { { "plainTextPaste", "true" } }); });
            Reject(delegate { EnhancementSettings.Save(revision, new Dictionary<string, object> { { "schemaVersion", 9 } }); });
            Reject(delegate { EnhancementSettings.Save(revision, new Dictionary<string, object> { { "unknown", true } }); });
            Require(File.ReadAllText(EnhancementSettings.FilePath) == before, "Invalid saves preserve file");
            EnhancementSettings.Save(revision, new Dictionary<string, object> { { "enabled", false } });
            Require(File.ReadAllText(EnhancementSettings.FilePath + ".before-edit.bak") == before, "Exact backup");
            File.WriteAllText(EnhancementSettings.FilePath, "{\"futureOwnedPreference\":\"keep\"}", new UTF8Encoding(false));
            document = EnhancementSettings.Read();
            EnhancementSettings.Save((string)document["revision"], new Dictionary<string, object> { { "enabled", true } });
            Require(File.ReadAllText(EnhancementSettings.FilePath).Contains("futureOwnedPreference"), "Unknown persisted settings retained");
            DesktopEndpoint.Publish("http://127.0.0.1:31234/?token=fixture-secret");
            Require(DesktopEndpoint.Read("http://127.0.0.1:1/").Contains("fixture-secret"), "Live endpoint recovered");
            Require(!File.ReadAllText(Path.Combine(root, "desktop-endpoint.json")).Contains("fixture-secret"), "Token not plaintext");
            DesktopEndpoint.Withdraw();
            Require(DesktopEndpoint.Read("http://127.0.0.1:1/") == "http://127.0.0.1:1/", "Owner cleanup");
            Reject(delegate { DesktopEndpoint.Publish("http://example.com/"); });
            File.WriteAllText(EnhancementSettings.FilePath, "null");
            Reject(delegate { EnhancementSettings.Read(); });
            Require(File.ReadAllText(EnhancementSettings.FilePath) == "null", "Corrupt settings preserved");
            Console.WriteLine("PASS: " + checks + " enhancement and endpoint checks");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
