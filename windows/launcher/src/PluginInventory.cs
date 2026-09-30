using System;
using System.Collections.Generic;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal sealed class PluginInventory
{
    internal readonly List<Dictionary<string, object>> Items = new List<Dictionary<string, object>>();
    internal readonly List<Dictionary<string, object>> Warnings = new List<Dictionary<string, object>>();

    internal static PluginInventory Scan(string primaryHome, string[] homes, string[] anchors, List<Dictionary<string, object>> receipts)
    {
        PluginInventory result = new PluginInventory();
        Dictionary<string, Dictionary<string, object>> profiles = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        HashSet<string> visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string home in homes)
        {
            string normalized = Path.GetFullPath(home);
            if (!visited.Add(normalized)) continue;
            string profileRoot = Path.Combine(normalized, "profiles");
            if (!Directory.Exists(profileRoot)) continue;
            try
            {
                foreach (string directory in Directory.GetDirectories(profileRoot))
                {
                    string profile = Path.GetFileName(directory);
                    if (profile == "node_modules" || profile.StartsWith(".")) continue;
                    string path = Path.Combine(directory, "package.json");
                    if (!FilePresent(path)) continue;
                    try
                    {
                        Dictionary<string, object> manifest = ReadObject(path);
                        object dependencies;
                        if (manifest.TryGetValue("dependencies", out dependencies) && !(dependencies is Dictionary<string, object>))
                            throw new InvalidDataException("Profile dependencies must be an object.");
                        if (dependencies is Dictionary<string, object>)
                            foreach (object specifier in ((Dictionary<string, object>)dependencies).Values)
                                if (!(specifier is string)) throw new InvalidDataException("Dependency specifiers must be strings.");
                        object dsh;
                        if (manifest.TryGetValue("dsh", out dsh) && !(dsh is Dictionary<string, object>))
                            throw new InvalidDataException("DSH metadata must be an object.");
                        object declaredProfile;
                        if (dsh is Dictionary<string, object> && ((Dictionary<string, object>)dsh).TryGetValue("profile", out declaredProfile) && !(declaredProfile is Dictionary<string, object>))
                            throw new InvalidDataException("DSH profile metadata must be an object.");
                        Dictionary<string, object> profileConfig = Object(Object(manifest, "dsh"), "profile");
                        object declaredBundles;
                        if (profileConfig != null && profileConfig.TryGetValue("bundles", out declaredBundles))
                        {
                            object[] bundles = declaredBundles as object[];
                            if (bundles == null) throw new InvalidDataException("Profile bundles must be an array.");
                            foreach (object bundle in bundles) if (!(bundle is string)) throw new InvalidDataException("Profile bundle names must be strings.");
                        }
                        profiles.Add(directory, manifest);
                    }
                    catch (Exception ex) { result.Warn(path, ex.Message); }
                }
            }
            catch (Exception ex) { result.Warn(profileRoot, ex.Message); }
        }

        HashSet<string> claimed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> receipt in receipts)
        {
            Dictionary<string, object> item = new Dictionary<string, object>(receipt);
            string profile = Text(item, "profile");
            if (profile.Length == 0) profile = "web";
            item["origin"] = "hub";
            item["homePath"] = primaryHome;
            item["inventoryState"] = "record-only";
            if (Regex.IsMatch(profile, "^[a-zA-Z0-9_-]+$") && (Text(item, "uninstallMethod") == "profile-package" || Text(item, "uninstallMethod") == "profile-bundle"))
            {
                item["profile"] = profile;
                string directory = Path.Combine(Path.GetFullPath(primaryHome), "profiles", profile);
                Dictionary<string, object> manifest;
                HashSet<string> names = ReceiptPackages(item);
                bool validNames = names.Count > 0;
                foreach (string name in names) if (!IsPackageName(name)) validNames = false;
                if (!profiles.TryGetValue(directory, out manifest))
                {
                    item["inventoryState"] = FilePresent(Path.Combine(directory, "package.json")) ? "unverified" : "missing";
                    item["removable"] = false;
                }
                else if (validNames)
                {
                    HashSet<string> declared = DeclaredPackages(manifest);
                    int present = 0;
                    foreach (string name in names)
                    {
                        if (declared.Contains(name)) present++;
                        claimed.Add(directory + "|" + name);
                    }
                    item["inventoryState"] = present == names.Count ? "declared" : present == 0 ? "missing" : "partial";
                    if (present != names.Count) item["removable"] = false;
                }
                else
                {
                    item["inventoryState"] = "unverified";
                    item["removable"] = false;
                }
                item["componentPath"] = Path.Combine(directory, "package.json");
            }
            else
            {
                item["removable"] = false;
                item["uninstallBlock"] = "unsupported";
            }
            if (Text(item, "inventoryState") != "declared" && Text(item, "inventoryState") != "record-only") item["uninstallBlock"] = "unverified";
            result.Items.Add(item);
        }

        List<string> directories = new List<string>(profiles.Keys);
        directories.Sort(StringComparer.OrdinalIgnoreCase);
        foreach (string directory in directories)
        {
            Dictionary<string, object> manifest = profiles[directory];
            Dictionary<string, object> dependencies = Object(manifest, "dependencies");
            HashSet<string> bundles = Bundles(manifest);
            List<string> names = new List<string>(DeclaredPackages(manifest));
            names.Sort(StringComparer.OrdinalIgnoreCase);
            foreach (string name in names)
            {
                if (claimed.Contains(directory + "|" + name)) continue;
                if (!IsPackageName(name))
                {
                    result.Warn(Path.Combine(directory, "package.json"), "Unsupported package reference: " + name);
                    continue;
                }
                string home = Path.GetDirectoryName(Path.GetDirectoryName(directory));
                Dictionary<string, object> installed = null;
                List<string> lookup = new List<string> { directory, Path.GetDirectoryName(directory), home };
                if (string.Equals(Path.GetFullPath(home), Path.GetFullPath(primaryHome), StringComparison.OrdinalIgnoreCase)) lookup.AddRange(anchors);
                foreach (string anchor in lookup)
                {
                    string file = Path.Combine(anchor, "node_modules", name.Replace('/', Path.DirectorySeparatorChar), "package.json");
                    if (!FilePresent(file)) continue;
                    try { installed = ReadObject(file); }
                    catch (Exception ex) { result.Warn(file, ex.Message); }
                    break;
                }
                string kind = bundles.Contains(name) ? "bundle" : installed != null && Object(installed, "dsh") != null ? "plugin" : "dependency";
                result.Items.Add(new Dictionary<string, object>
                {
                    { "id", StableId(directory, name) }, { "name", name }, { "kind", kind },
                    { "version", installed == null ? dependencies == null ? "" : Text(dependencies, name) : Text(installed, "version") },
                    { "installedAt", "" }, { "profile", Path.GetFileName(directory) }, { "homePath", home },
                    { "packageNames", new string[] { name } }, { "workspacePath", "" },
                    { "componentPath", Path.Combine(directory, "package.json") },
                    { "origin", "profile" }, { "inventoryState", installed == null ? "unresolved" : "present" },
                    { "removable", false }
                });
            }
        }
        foreach (Dictionary<string, object> item in result.Items)
        {
            if (Text(item, "origin") != "hub") continue;
            string profile = Text(item, "profile");
            if (profile.Length == 0) profile = "web";
            HashSet<string> names = ReceiptPackages(item);
            foreach (Dictionary<string, object> other in result.Items)
            {
                if (ReferenceEquals(item, other) || Text(other, "origin") != "hub") continue;
                string otherProfile = Text(other, "profile");
                if (otherProfile.Length == 0) otherProfile = "web";
                if (!string.Equals(profile, otherProfile, StringComparison.OrdinalIgnoreCase) || !names.Overlaps(ReceiptPackages(other))) continue;
                item["removable"] = false;
                item["uninstallBlock"] = "shared";
                break;
            }
        }
        return result;
    }

    internal static HashSet<string> ReceiptPackages(Dictionary<string, object> item)
    {
        HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        object raw;
        if (item.TryGetValue("packageNames", out raw))
        {
            System.Collections.IEnumerable values = raw as System.Collections.IEnumerable;
            if (values != null && !(raw is string)) foreach (object value in values) if (value is string && ((string)value).Length > 0) names.Add((string)value);
        }
        string bundle = Text(item, "bundle");
        if (bundle.Length > 0) names.Add(bundle);
        return names;
    }

    private static bool IsPackageName(string name)
    {
        return Regex.IsMatch(name, "^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$");
    }

    private static HashSet<string> DeclaredPackages(Dictionary<string, object> manifest)
    {
        HashSet<string> names = Bundles(manifest);
        Dictionary<string, object> dependencies = Object(manifest, "dependencies");
        if (dependencies != null) foreach (string name in dependencies.Keys) names.Add(name);
        return names;
    }

    private static HashSet<string> Bundles(Dictionary<string, object> manifest)
    {
        HashSet<string> bundles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, object> profile = Object(Object(manifest, "dsh"), "profile");
        object raw;
        if (profile != null && profile.TryGetValue("bundles", out raw) && raw is object[])
            foreach (object value in (object[])raw) if (value is string) bundles.Add((string)value);
        return bundles;
    }

    private static Dictionary<string, object> ReadObject(string path)
    {
        using (SafeFileHandle handle = CreateFile(ExtendedPath(path), 0x80000000, 7, IntPtr.Zero, 3, 0x80, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new IOException("Cannot read manifest: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            using (FileStream stream = new FileStream(handle, FileAccess.Read))
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
            {
                if (stream.Length > 4 * 1024 * 1024) throw new InvalidDataException("Manifest exceeds 4 MiB.");
                JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
                Dictionary<string, object> result = serializer.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                if (result == null) throw new InvalidDataException("Manifest must be a JSON object.");
                return result;
            }
        }
    }

    private static bool FilePresent(string path)
    {
        uint attributes = GetFileAttributes(ExtendedPath(path));
        return attributes != uint.MaxValue && (attributes & 0x10) == 0;
    }

    private static string ExtendedPath(string path)
    {
        string full = Path.IsPathRooted(path) ? path : Path.GetFullPath(path);
        if (full.StartsWith(@"\\?\")) return full;
        return full.StartsWith(@"\\") ? @"\\?\UNC\" + full.Substring(2) : @"\\?\" + full;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetFileAttributesW")]
    private static extern uint GetFileAttributes(string path);

    private void Warn(string path, string message)
    {
        Warnings.Add(new Dictionary<string, object> { { "path", path }, { "message", message } });
    }

    private static Dictionary<string, object> Object(Dictionary<string, object> source, string key)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
    }

    private static string Text(Dictionary<string, object> source, string key)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) && value is string ? (string)value : "";
    }

    private static string StableId(string directory, string name)
    {
        using (SHA256 hash = SHA256.Create())
            return "profile-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(directory.ToLowerInvariant() + "|" + name))).Replace("-", "").ToLowerInvariant();
    }
}
