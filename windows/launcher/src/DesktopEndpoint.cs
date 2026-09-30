using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class DesktopEndpoint
{
    private static string PathName { get { return Path.Combine(AppPaths.DataDir, "desktop-endpoint.json"); } }
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DSH-HUB.desktop-endpoint.v1");

    public static void Publish(string address)
    {
        Validate(address);
        using (Process process = Process.GetCurrentProcess())
        {
            Dictionary<string, object> document = new Dictionary<string, object> {
                { "pid", process.Id }, { "started", process.StartTime.ToUniversalTime().Ticks.ToString() },
                { "address", Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(address), Entropy, DataProtectionScope.CurrentUser)) }
            };
            Directory.CreateDirectory(AppPaths.DataDir);
            string temporary = PathName + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(document), new UTF8Encoding(false));
                if (File.Exists(PathName)) File.Replace(temporary, PathName, null);
                else File.Move(temporary, PathName);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }

    public static string Read(string fallback)
    {
        if (!File.Exists(PathName)) { Validate(fallback); return fallback; }
        try
        {
            Dictionary<string, object> document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(PathName));
            using (Process process = Process.GetProcessById(Convert.ToInt32(document["pid"])))
            {
                if (process.HasExited || process.StartTime.ToUniversalTime().Ticks.ToString() != (string)document["started"]) { Validate(fallback); return fallback; }
                string address = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String((string)document["address"]), Entropy, DataProtectionScope.CurrentUser));
                Validate(address);
                return address;
            }
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is ArgumentException || error is InvalidOperationException || error is KeyNotFoundException || error is CryptographicException || error is System.ComponentModel.Win32Exception || error is FormatException || error is InvalidCastException)) throw;
            Validate(fallback);
            return fallback;
        }
    }

    public static void Withdraw()
    {
        if (!File.Exists(PathName)) return;
        Dictionary<string, object> document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(PathName));
        if (document != null && document.ContainsKey("pid") && Convert.ToInt32(document["pid"]) == Process.GetCurrentProcess().Id) File.Delete(PathName);
    }

    internal static void Validate(string address)
    {
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || uri.Scheme != "http" || !uri.IsLoopback || uri.UserInfo.Length != 0)
            throw new InvalidOperationException("Phone access requires a loopback HTTP DSH endpoint.");
    }
}
