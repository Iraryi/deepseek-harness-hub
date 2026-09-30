using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class EnhancementSettings
{
    internal static string FilePath { get { return Path.Combine(AppPaths.DataDir, "enhancements.json"); } }

    private static string Hash(byte[] bytes)
    {
        using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "");
    }

    private static Dictionary<string, object> Defaults()
    {
        return new Dictionary<string, object> {
            { "schemaVersion", 1 }, { "enabled", true }, { "conversationWidth", 0 },
            { "plainTextPaste", false }, { "showSessionIds", false }
        };
    }

    private static Dictionary<string, object> Parse(byte[] bytes)
    {
        Dictionary<string, object> values = bytes.Length == 0 ? Defaults() : new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));
        if (values == null) throw new InvalidOperationException("Enhancement settings are unreadable; the original is preserved.");
        foreach (KeyValuePair<string, object> item in Defaults()) if (!values.ContainsKey(item.Key)) values[item.Key] = item.Value;
        Validate(values);
        return values;
    }

    private static void Validate(Dictionary<string, object> values)
    {
        if (!(values["schemaVersion"] is int) || (int)values["schemaVersion"] != 1) throw new InvalidOperationException("Unsupported enhancement settings version.");
        foreach (string key in new string[] { "enabled", "plainTextPaste", "showSessionIds" })
            if (!(values[key] is bool)) throw new InvalidOperationException("Invalid enhancement boolean: " + key);
        object width = values["conversationWidth"];
        if (!(width is int) || ((int)width != 0 && ((int)width < 640 || (int)width > 2000))) throw new InvalidOperationException("Conversation width must be 0 (automatic) or 640–2000.");
    }

    public static Dictionary<string, object> Read()
    {
        byte[] bytes = File.Exists(FilePath) ? File.ReadAllBytes(FilePath) : new byte[0];
        return new Dictionary<string, object> { { "values", Parse(bytes) }, { "revision", Hash(bytes) }, { "restartRequired", false } };
    }

    public static Dictionary<string, object> Save(string revision, Dictionary<string, object> patch)
    {
        if (patch == null) throw new InvalidOperationException("Enhancement values are required.");
        string mutexName = "Local\\DSH.Enhancements." + Hash(Encoding.UTF8.GetBytes(Path.GetFullPath(FilePath).ToUpperInvariant()));
        using (Mutex gate = new Mutex(false, mutexName))
        {
            bool entered;
            try { entered = gate.WaitOne(5000); }
            catch (AbandonedMutexException) { entered = true; }
            if (!entered) throw new InvalidOperationException("Enhancement settings are busy.");
            try
            {
                byte[] original = File.Exists(FilePath) ? File.ReadAllBytes(FilePath) : new byte[0];
                if (revision != Hash(original)) throw new InvalidOperationException("Settings changed in another window. Reload before saving.");
                Dictionary<string, object> values = Parse(original);
                Dictionary<string, object> allowed = Defaults();
                foreach (KeyValuePair<string, object> item in patch)
                {
                    if (!allowed.ContainsKey(item.Key)) throw new InvalidOperationException("Unknown enhancement: " + item.Key);
                    values[item.Key] = item.Value;
                }
                Validate(values);
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                string temporary = FilePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(values), new UTF8Encoding(false));
                    if (File.Exists(FilePath)) File.Replace(temporary, FilePath, FilePath + ".before-edit.bak");
                    else File.Move(temporary, FilePath);
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
                Dictionary<string, object> result = Read();
                result["restartRequired"] = true;
                return result;
            }
            finally { gate.ReleaseMutex(); }
        }
    }

    public static string Bootstrap(string script)
    {
        return "window.__dshEnhancements=" + new JavaScriptSerializer().Serialize(Read()["values"]) + ";\n" + script;
    }
}
