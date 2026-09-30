using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

internal static class OverlayBinding
{
    private const string Identity = "DSH.Overlay.6E4AA8A1-93AD-47D7-AD79-75FA9A01DCBE";
    private static string BindingPath { get { return Path.GetFullPath(Path.Combine(AppPaths.ExeDir, "..", "overlay-binding.json")); } }
    internal static bool Present { get { return File.Exists(BindingPath); } }

    internal static string Value(string name)
    {
        if (!Present) return null;
        Dictionary<string, object> document = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(BindingPath));
        object schema;
        object identity;
        object rawPaths;
        if (document == null || !document.TryGetValue("Schema", out schema) || !(schema is int) || (int)schema != 1
            || !document.TryGetValue("AppId", out identity) || (string)identity != Identity
            || !document.TryGetValue("Paths", out rawPaths)) throw new InvalidOperationException("Invalid Overlay binding. Repair the add-on; base DSH is unchanged.");
        Dictionary<string, object> paths = rawPaths as Dictionary<string, object>;
        if (paths == null || !paths.ContainsKey(name) || !(paths[name] is string) || !Path.IsPathRooted((string)paths[name])
            || !paths.ContainsKey("InstallRoot") || !string.Equals(Path.GetFullPath((string)paths["InstallRoot"]).TrimEnd('\\'), Path.GetDirectoryName(BindingPath).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Overlay paths no longer match their binding. Run Overlay repair.");
        return Path.GetFullPath((string)paths[name]);
    }

    internal static string BoundPath(string name, string configured)
    {
        string bound = Value(name);
        if (bound == null) return configured;
        if (!string.IsNullOrWhiteSpace(configured) && !string.Equals(Path.GetFullPath(configured).TrimEnd('\\'), bound.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Overlay " + name + " differs from its binding. Repair Overlay instead of falling back to another installation.");
        return bound;
    }

    internal static string ImportArguments()
    {
        if (!Present) return "";
        Value("RuntimeRoot");
        string resolver = Path.Combine(Path.GetDirectoryName(BindingPath), "resolver.mjs");
        if (!File.Exists(resolver)) throw new InvalidOperationException("Overlay resolver missing. Repair Overlay.");
        return " --import \"" + new Uri(resolver).AbsoluteUri + "\" ";
    }
}
