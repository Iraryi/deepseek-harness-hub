using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

internal static class PluginInventoryHarness
{
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--scan")
        {
            PluginInventory scan = PluginInventory.Scan(args[1], new string[] { args[1] }, new string[0], new List<Dictionary<string, object>>());
            Console.WriteLine(new JavaScriptSerializer().Serialize(scan.Items));
            return;
        }
        if (args.Length != 1 || Directory.Exists(args[0])) throw new ArgumentException("Pass a new isolated fixture directory");
        string root = Path.GetFullPath(args[0]);
        string primary = Path.Combine(root, "managed");
        string external = Path.Combine(root, "cli");
        string profile = Path.Combine(primary, "profiles", "web");
        Write(Path.Combine(profile, "package.json"), "{\"dependencies\":{\"external-plugin\":\"^1.0.0\",\"owned-plugin\":\"1.0.0\",\"missing-plugin\":\"1\"},\"dsh\":{\"profile\":{\"bundles\":[\"owned-plugin\",\"inbox-bundle\"]}}}");
        Write(Path.Combine(profile, "node_modules", "external-plugin", "package.json"), "{\"name\":\"external-plugin\",\"version\":\"1.2.0\",\"dsh\":{\"client\":{\"platform\":\"web\"}}}");
        Write(Path.Combine(profile, "node_modules", "transitive-helper", "package.json"), "{\"name\":\"transitive-helper\"}");
        Write(Path.Combine(primary, "profiles", "node_modules", "inbox-bundle", "package.json"), "{\"version\":\"2.0.0\"}");
        Write(Path.Combine(external, "profiles", "web", "package.json"), "{\"dependencies\":{\"external-plugin\":\"1.0.0\"}}");
        Write(Path.Combine(primary, "profiles", "broken", "package.json"), "{invalid");
        Write(Path.Combine(primary, "profiles", "invalid-deps", "package.json"), "{\"dependencies\":[]}");
        Write(Path.Combine(primary, "profiles", "custom", "package.json"), "{\"dependencies\":{\"@demo/plugin\":\"file:../local\",\"../../outside\":\"1\"}}");
        Dictionary<string, object> receipt = new Dictionary<string, object>
        {
            { "id", "owned" }, { "name", "Owned Setup" }, { "profile", "web" }, { "uninstallMethod", "profile-package" },
            { "packageNames", new string[] { "owned-plugin" } }, { "removable", true }, { "workspacePath", "preserved" }
        };
        List<Dictionary<string, object>> receipts = new List<Dictionary<string, object>> { receipt };
        Dictionary<string, byte[]> before = Directory.GetFiles(root, "*", SearchOption.AllDirectories).ToDictionary(path => path, File.ReadAllBytes);
        PluginInventory result = PluginInventory.Scan(primary, new string[] { primary, external, primary }, new string[0], receipts);
        Require(result.Warnings.Count == 3, "Malformed profiles and unsafe package references must be reported");
        Require(result.Items.Count == 6, "Include direct dependencies and bundle declarations once, not transitive files");
        Require(result.Items.Count(item => (string)item["name"] == "external-plugin") == 2, "Same package in two homes must remain distinct");
        Require(result.Items.Select(item => (string)item["id"]).Distinct().Count() == result.Items.Count, "Inventory ids must be unique across homes");
        Dictionary<string, object> discovered = result.Items.Find(item => (string)item["name"] == "external-plugin" && (string)item["homePath"] == primary);
        Require((string)discovered["version"] == "1.2.0", "Display installed version, not the declared range");
        Require((string)discovered["inventoryState"] == "present", "Report package files separately from runtime activation");
        Require(!(bool)discovered["removable"], "Do not invent a destructive adapter for external packages");
        Require(result.Items.Find(item => (string)item["id"] == "owned")["inventoryState"].Equals("declared"), "Reconcile receipts without duplicating packages");
        Require(!receipt.ContainsKey("origin"), "Scanning must not mutate receipt inputs");
        foreach (KeyValuePair<string, byte[]> pair in before) Require(File.ReadAllBytes(pair.Key).SequenceEqual(pair.Value), "Scanning changed a fixture file");
        Require(Directory.GetFiles(root, "*", SearchOption.AllDirectories).Length == before.Count, "Scanning created a file");
        PluginInventory repeat = PluginInventory.Scan(primary, new string[] { primary, external }, new string[0], receipts);
        Require(repeat.Items.Select(item => (string)item["id"]).SequenceEqual(result.Items.Select(item => (string)item["id"])), "Rescan identities must stay stable");
        Dictionary<string, object> sharedReceipt = new Dictionary<string, object>(receipt);
        sharedReceipt["id"] = "shared";
        sharedReceipt.Remove("profile");
        PluginInventory shared = PluginInventory.Scan(primary, new string[] { primary }, new string[0], new List<Dictionary<string, object>> { receipt, sharedReceipt });
        Require(shared.Items.Where(item => (string)item["origin"] == "hub").All(item => !(bool)item["removable"] && item["uninstallBlock"].Equals("shared")), "Shared default/web Profile ownership must disable removal before clicking");
        Require(shared.Items.Find(item => (string)item["id"] == "shared")["profile"].Equals("web"), "Display the same default Profile that removal uses");
        sharedReceipt["profile"] = "custom";
        PluginInventory separate = PluginInventory.Scan(primary, new string[] { primary }, new string[0], new List<Dictionary<string, object>> { receipt, sharedReceipt });
        Require((bool)separate.Items[0]["removable"], "Another Profile's receipt must not block this Profile");
        Dictionary<string, object> emptyReceipt = new Dictionary<string, object>(receipt);
        emptyReceipt["packageNames"] = new string[0];
        PluginInventory empty = PluginInventory.Scan(primary, new string[] { primary }, new string[0], new List<Dictionary<string, object>> { emptyReceipt });
        Require(!(bool)empty.Items[0]["removable"] && empty.Items[0]["uninstallBlock"].Equals("unverified"), "Missing target metadata cannot authorize removal");
        emptyReceipt["packageNames"] = new string[] { "../outside" };
        PluginInventory invalidTarget = PluginInventory.Scan(primary, new string[] { primary }, new string[0], new List<Dictionary<string, object>> { emptyReceipt });
        Require(!(bool)invalidTarget.Items[0]["removable"], "Invalid target references must not authorize removal");
        emptyReceipt["uninstallMethod"] = "profile-unknown";
        PluginInventory unsupported = PluginInventory.Scan(primary, new string[] { primary }, new string[0], new List<Dictionary<string, object>> { emptyReceipt });
        Require(!(bool)unsupported.Items[0]["removable"] && unsupported.Items[0]["uninstallBlock"].Equals("unsupported"), "Unknown removal methods must not appear actionable");
        Write(Path.Combine(profile, "node_modules", "external-plugin", "package.json"), "{invalid");
        Write(Path.Combine(primary, "node_modules", "external-plugin", "package.json"), "{\"version\":\"99.0.0\"}");
        PluginInventory corrupt = PluginInventory.Scan(primary, new string[] { primary }, new string[0], receipts);
        Require(corrupt.Items.Find(item => (string)item["name"] == "external-plugin")["inventoryState"].Equals("unresolved"), "A broken nearer package must not resolve to a different runtime version");
        Write(Path.Combine(profile, "package.json"), "{\"dependencies\":{\"owned-plugin\":\"1\"},\"dsh\":{\"profile\":false}}");
        PluginInventory unreadable = PluginInventory.Scan(primary, new string[] { primary }, new string[0], receipts);
        Require(unreadable.Items.Find(item => (string)item["id"] == "owned")["inventoryState"].Equals("unverified"), "Malformed metadata must not authorize removal");
        Write(Path.Combine(profile, "package.json"), "{\"dependencies\":{}}");
        PluginInventory removed = PluginInventory.Scan(primary, new string[] { primary }, new string[0], receipts);
        Dictionary<string, object> missing = removed.Items.Find(item => (string)item["id"] == "owned");
        Require((string)missing["inventoryState"] == "missing" && !(bool)missing["removable"], "External removal must invalidate the receipt's uninstall action");
        Require(!removed.Items.Any(item => (string)item["name"] == "external-plugin"), "External removal must appear on rescan");
        Console.WriteLine("PASS: two homes, profiles, external dependencies, bundles, deduplication, version, corrupt inputs, read-only scan, stable ids, external removal");
    }

    private static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, content);
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
