using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class CatalogRefreshHarness
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2 && args.Length != 4 && !(args.Length == 5 && args[4] == "--live")) throw new ArgumentException("Expected launcher, isolated data directory, optional baseline/live catalogs and --live");
        string data = Path.GetFullPath(args[1]);
        if (Directory.Exists(data)) throw new InvalidOperationException("Test data directory must not already exist");
        Directory.CreateDirectory(Path.Combine(data, "hub"));
        Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_DATA_DIR", data);
        Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_OFFLINE", "1");
        Assembly assembly = Assembly.LoadFrom(Path.GetFullPath(args[0]));
        Type configType = assembly.GetType("AppConfig", true);
        Type formType = assembly.GetType("MainForm", true);
        object config = Activator.CreateInstance(configType, true);
        using (IDisposable form = (IDisposable)Activator.CreateInstance(formType, new object[] { config, true, true }))
        {
            SynchronizationContext.SetSynchronizationContext(null);
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = 32 * 1024 * 1024;
            MethodInfo regression = formType.GetMethod("DshmkCatalogCapabilitiesRegressed", BindingFlags.Static | BindingFlags.NonPublic);
            Dictionary<string, object> large = Catalog(600, "2026-08-22T00:00:00Z");
            Dictionary<string, object> curated = Catalog(250, "2026-09-29T00:00:00Z");
            Require(!(bool)regression.Invoke(null, new object[] { large, curated }), "New complete curated subset must replace the larger old snapshot");
            Require((bool)regression.Invoke(null, new object[] { curated, large }), "A larger older snapshot must not replace newer data");
            Dictionary<string, object> incomplete = Catalog(250, "2026-09-29T00:00:00Z");
            incomplete["stats"] = new Dictionary<string, object> { { "fetched", 600 } };
            Require((bool)regression.Invoke(null, new object[] { large, incomplete }), "Truncated payload must remain rejected");
            Dictionary<string, object> duplicate = Catalog(250, "2026-09-29T00:00:00Z");
            ((object[])duplicate["repositories"])[1] = ((object[])duplicate["repositories"])[0];
            Require((bool)regression.Invoke(null, new object[] { large, duplicate }), "Duplicate identities must not establish completeness");
            Require((bool)regression.Invoke(null, new object[] { large, Catalog(1, "2026-09-29T00:00:00Z") }), "Unexpectedly tiny snapshots remain rejected");
            if (args.Length >= 4)
            {
                object baseline = serializer.DeserializeObject(File.ReadAllText(args[2]));
                object live = serializer.DeserializeObject(File.ReadAllText(args[3]));
                Require(!(bool)regression.Invoke(null, new object[] { baseline, live }), "Captured current DSHMK catalog must pass the production policy");
            }
            Dictionary<string, object> cached = (Dictionary<string, object>)serializer.DeserializeObject(
                "{\"schemaVersion\":1,\"generatedAt\":\"2026-09-01T00:00:00Z\",\"repositories\":[{\"repositoryId\":1,\"url\":\"https://github.com/example/plugin\",\"name\":\"cached-plugin\"}]}");
            formType.GetField("_dshmkCatalogCache", PrivateInstance).SetValue(form, cached);
            formType.GetField("_dshmkCatalogCacheUntilUtc", PrivateInstance).SetValue(form, DateTime.UtcNow.AddHours(1));
            formType.GetField("_dshmkCatalogSourceMode", PrivateInstance).SetValue(form, "live");
            MethodInfo query = formType.GetMethod("QueryDshmkCatalogAsync", PrivateInstance);
            Dictionary<string, object> payload = new Dictionary<string, object> { { "pageSize", 24 } };
            Dictionary<string, object> page = Query(query, form, payload).GetAwaiter().GetResult();
            Require((string)page["generatedAt"] == "2026-09-01T00:00:00Z", "Normal query must use the current snapshot");

            TaskCompletionSource<Dictionary<string, object>> transfer = new TaskCompletionSource<Dictionary<string, object>>();
            formType.GetField("_dshmkCatalogRefreshTask", PrivateInstance).SetValue(form, transfer.Task);
            payload["refresh"] = true;
            Task<Dictionary<string, object>> first = Query(query, form, payload);
            Task<Dictionary<string, object>> second = Query(query, form, payload);
            Require(!first.IsCompleted && !second.IsCompleted, "Force refresh must await the shared transfer, not return cached data");
            Dictionary<string, object> fresh = new Dictionary<string, object>(cached);
            fresh["generatedAt"] = "2026-09-29T00:00:00Z";
            transfer.SetResult(fresh);
            Require((string)first.GetAwaiter().GetResult()["generatedAt"] == (string)fresh["generatedAt"], "First refresh must return transferred data");
            Require((string)second.GetAwaiter().GetResult()["generatedAt"] == (string)fresh["generatedAt"], "Concurrent refresh must share transferred data");

            page = Query(query, form, payload).GetAwaiter().GetResult();
            Require((string)page["sourceMode"] == "cache", "Offline failure must not report a live response");
            Require(((string)page["refreshError"]).Length > 0, "Offline failure must be visible");
            Require((string)page["generatedAt"] == "2026-09-01T00:00:00Z", "Failure must retain the original source timestamp");
            Require((int)page["total"] == 1, "Failure must retain the usable inventory");
            File.WriteAllText(Path.Combine(data, "hub", "dshmk-catalog.json"), serializer.Serialize(curated));
            formType.GetField("_dshmkCatalogCache", PrivateInstance).SetValue(form, null);
            payload["refresh"] = false;
            page = Query(query, form, payload).GetAwaiter().GetResult();
            Require((string)page["generatedAt"] == "2026-09-29T00:00:00Z", "Restart must choose fresh cache over larger bundled snapshot");
            if (args.Length == 5)
            {
                Environment.SetEnvironmentVariable("DEEPSEEK_HARNESS_OFFLINE", null);
                payload["refresh"] = true;
                page = Query(query, form, payload).GetAwaiter().GetResult();
                Require((string)page["sourceMode"] == "live", "Real online refresh must replace cached provenance");
                Require(string.IsNullOrEmpty((string)page["refreshError"]), "Real online refresh must not retain an error");
                Console.WriteLine("LIVE: " + page["total"] + " repositories; generated " + page["generatedAt"]);
            }
            Console.WriteLine("PASS: cache, forced refresh, concurrent transfer, offline recovery, provenance timestamps");
        }
    }

    private static Dictionary<string, object> Catalog(int count, string generatedAt)
    {
        object[] repositories = new object[count];
        for (int index = 0; index < count; index++)
            repositories[index] = new Dictionary<string, object> { { "repositoryId", index + 1 }, { "url", "https://github.com/example/plugin-" + index }, { "name", "plugin-" + index } };
        return new Dictionary<string, object> { { "schemaVersion", 1 }, { "generatedAt", generatedAt }, { "stats", new Dictionary<string, object> { { "fetched", count } } }, { "repositories", repositories } };
    }

    private static Task<Dictionary<string, object>> Query(MethodInfo method, object form, Dictionary<string, object> payload)
    {
        return (Task<Dictionary<string, object>>)method.Invoke(form, new object[] { payload });
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
