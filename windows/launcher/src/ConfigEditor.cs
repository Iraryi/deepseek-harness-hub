using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class ConfigEditor
{
    private static readonly object Gate = new object();

    private static string PathFor(string target)
    {
        if (target == "dsh") return AppPaths.ConfigFile;
        if (target == "hub") return AppPaths.HubConfigFile;
        throw new InvalidOperationException("Unknown CONFIG target.");
    }

    private static Dictionary<string, object> Defaults(string target)
    {
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        object defaults = target == "dsh" ? (object)new AppConfig() : new HubConfig();
        Dictionary<string, object> values = serializer.Deserialize<Dictionary<string, object>>(serializer.Serialize(defaults));
        values.Remove("FirstRunCompleted");
        return values;
    }

    private static string Revision(byte[] bytes)
    {
        using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "");
    }

    public static object Read(string target)
    {
        lock (Gate)
        {
            string path = PathFor(target);
            byte[] bytes = File.Exists(path) ? File.ReadAllBytes(path) : new byte[0];
            Dictionary<string, object> values = Defaults(target);
            if (bytes.Length > 0)
            {
                Dictionary<string, object> document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));
                if (document == null) throw new InvalidOperationException("Invalid CONFIG document; original file preserved.");
                foreach (string key in new List<string>(values.Keys)) if (document.ContainsKey(key)) values[key] = document[key];
            }
            return new Dictionary<string, object> { { "target", target }, { "revision", Revision(bytes) }, { "values", values } };
        }
    }

    private static void Choice(string key, object value, string choices)
    {
        if (!(value is string) || Array.IndexOf(choices.Split('|'), (string)value) < 0)
            throw new InvalidOperationException("Invalid CONFIG choice: " + key);
    }

    public static object Save(string target, string revision, Dictionary<string, object> patch)
    {
        string name = "Local\\DeepSeekHarness.ConfigEditor." + Revision(Encoding.UTF8.GetBytes(Path.GetFullPath(PathFor(target)).ToUpperInvariant()));
        using (Mutex mutex = new Mutex(false, name))
        {
            bool acquired;
            try { acquired = mutex.WaitOne(5000); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new InvalidOperationException("CONFIG is busy in another window.");
            try { return SaveLocked(target, revision, patch); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static object SaveLocked(string target, string revision, Dictionary<string, object> patch)
    {
        lock (Gate)
        {
            string path = PathFor(target);
            byte[] original = File.Exists(path) ? File.ReadAllBytes(path) : new byte[0];
            if (revision != Revision(original)) throw new InvalidOperationException("CONFIG_CONFLICT");
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> document = original.Length == 0 ? new Dictionary<string, object>()
                : serializer.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(original).TrimStart('\uFEFF'));
            if (document == null || patch == null) throw new InvalidOperationException("Invalid CONFIG document.");
            Dictionary<string, object> defaults = Defaults(target);
            foreach (KeyValuePair<string, object> item in patch)
            {
                if (!defaults.ContainsKey(item.Key)) throw new InvalidOperationException("Unsupported CONFIG field: " + item.Key);
                object expected = defaults[item.Key];
                if (expected is bool && !(item.Value is bool)) throw new InvalidOperationException("Invalid boolean: " + item.Key);
                if (expected is int)
                {
                    int min = item.Key == "ResolutionWidth" ? 400 : item.Key == "ResolutionHeight" ? 300 : 1;
                    int max = item.Key == "Port" ? 65535 : item.Key == "PageSize" ? 200 : item.Key == "ResolutionHeight" ? 4320 : 7680;
                    if (!(item.Value is int) || (int)item.Value < min || (int)item.Value > max) throw new InvalidOperationException("Invalid number: " + item.Key);
                    if (item.Key == "PageSize" && Array.IndexOf(new int[] {12,24,48,96,200}, (int)item.Value) < 0) throw new InvalidOperationException("Invalid page size.");
                }
                if (expected is string && (!(item.Value is string) || ((string)item.Value).Length > 4096)) throw new InvalidOperationException("Invalid text: " + item.Key);
                if (item.Key == "Extensions")
                {
                    IList paths = item.Value as IList;
                    if (paths == null || paths.Count > 128) throw new InvalidOperationException("Invalid extension list.");
                    foreach (object entry in paths) if (!(entry is string) || ((string)entry).Length > 4096) throw new InvalidOperationException("Invalid extension path.");
                }
                string choices = null;
                switch (item.Key)
                {
                    case "Language": choices = "zh-CN|en-US"; break;
                    case "LaunchMode": choices = "window|bordered|borderless|exclusive"; break;
                    case "WindowChrome": choices = "system|traffic"; break;
                    case "LoadingStyle": choices = "whales|progress|off"; break;
                    case "CloseAction": choices = "tray|exit"; break;
                    case "Theme": choices = "system|light|dark"; break;
                    case "StartPage": choices = "home|github|library|installed"; break;
                    case "DiscoverySource": choices = "dshmk|community|github"; break;
                    case "DetailEntry": choices = "button|card"; break;
                    case "DetailMode": choices = "side|modal|full"; break;
                    case "DetailContent": choices = "native|original"; break;
                }
                if (choices != null) Choice(item.Key, item.Value, choices);
                if (item.Key == "Url")
                {
                    Uri url;
                    if (!Uri.TryCreate((string)item.Value, UriKind.Absolute, out url) || (url.Scheme != "http" && url.Scheme != "https")) throw new InvalidOperationException("Invalid HTTP URL.");
                }
                document[item.Key] = item.Value;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temp, serializer.Serialize(document), new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temp, path, path + ".before-config-edit.bak");
                else File.Move(temp, path);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
            return Read(target);
        }
    }
}
