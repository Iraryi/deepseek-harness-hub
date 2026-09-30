using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed partial class MainForm
{
    private readonly MobileConnection _mobileConnection = new MobileConnection();

    private async void ApplyDesktopEnhancements()
    {
        try
        {
            string script = Path.Combine(AppPaths.ExeDir, "enhancements.js");
            if (!_hubMode && !_exitRequested && File.Exists(script) && _webView.CoreWebView2 != null)
                await _webView.CoreWebView2.ExecuteScriptAsync(EnhancementSettings.Bootstrap(File.ReadAllText(script)));
        }
        catch (Exception error) { AppendLog("Desktop enhancements not applied: " + error.Message); }
    }

    private static bool IsManagementOperation(string operation)
    {
        return operation == "manager-status" || operation == "enhancements-read" || operation == "enhancements-save"
            || operation == "mobile-status" || operation == "mobile-start" || operation == "mobile-stop"
            || operation == "mobile-pair" || operation == "mobile-revoke";
    }

    private async Task<object> HandleManagementOperationAsync(string operation, Dictionary<string, object> payload)
    {
        if (operation == "manager-status") return await ManagementStatusAsync();
        if (operation == "enhancements-read") return EnhancementSettings.Read();
        if (operation == "enhancements-save") return EnhancementSettings.Save(GetString(payload, "revision"), GetDictionary(payload, "values"));
        if (operation == "mobile-status") return await Task.Run<object>(delegate { return MobileStatus(); });
        if (operation == "mobile-start")
        {
            string repository = FindRepo();
            string node = FindNode(repository);
            string script = Path.Combine(AppPaths.ExeDir, "mobile", "relay.mjs");
            string address = DesktopEndpoint.Read(AppConfig.Load().Url);
            string origin = new Uri(address).GetLeftPart(UriPartial.Authority);
            string authentication = new Uri(address).Query.Length == 0 ? null : address;
            string bind = GetString(payload, "bindAddress");
            bool matched = false;
            foreach (Dictionary<string, object> entry in MobileInterfaces()) if ((string)entry["address"] == bind) matched = true;
            if (!matched) throw new InvalidOperationException("Select an available private IPv4 interface.");
            int port = GetInteger(payload, "port");
            if (port < 0 || port > 65535) throw new InvalidOperationException("Phone port must be 0 or 1–65535.");
            bool consent = GetBoolean(payload, "trustedLanConsent");
            return await Task.Run<object>(delegate {
                _mobileConnection.Start(node, script, origin, bind, port, consent, authentication);
                return MobileStatus();
            });
        }
        if (operation == "mobile-pair") return await Task.Run<object>(delegate { return _mobileConnection.Pair(); });
        if (operation == "mobile-revoke") return await Task.Run<object>(delegate { _mobileConnection.Revoke(GetString(payload, "deviceId")); return MobileStatus(); });
        if (operation == "mobile-stop") return await Task.Run<object>(delegate { _mobileConnection.Stop(); return MobileStatus(); });
        throw new InvalidOperationException("Unknown management operation.");
    }

    private Dictionary<string, object> MobileStatus()
    {
        Dictionary<string, object> status = _mobileConnection.Status();
        status["interfaces"] = MobileInterfaces();
        bool available = File.Exists(Path.Combine(AppPaths.ExeDir, "mobile", "relay.mjs"));
        status["available"] = available;
        status["reason"] = available ? "" : "Mobile relay files are not installed. Repair or update HUB.";
        return status;
    }

    private static List<Dictionary<string, object>> MobileInterfaces()
    {
        List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
        HashSet<string> addresses = new HashSet<string>();
        foreach (NetworkInterface network in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (network.OperationalStatus != OperationalStatus.Up || network.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            foreach (UnicastIPAddressInformation entry in network.GetIPProperties().UnicastAddresses)
            {
                if (entry.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                byte[] bytes = entry.Address.GetAddressBytes();
                bool privateAddress = bytes[0] == 10 || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] == 192 && bytes[1] == 168);
                string address = entry.Address.ToString();
                if (privateAddress && addresses.Add(address)) result.Add(new Dictionary<string, object> { { "address", address }, { "name", network.Name } });
            }
        }
        return result;
    }

    private async Task<object> ManagementStatusAsync()
    {
        string repository = FindRepo() ?? "";
        string node = FindNode(repository) ?? "";
        string address = DesktopEndpoint.Read(AppConfig.Load().Url);
        string origin = new Uri(address).GetLeftPart(UriPartial.Authority);
        bool reachable = false;
        using (HttpClientHandler handler = new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
        using (HttpClient client = new HttpClient(handler))
        {
            client.Timeout = TimeSpan.FromSeconds(2);
            try
            {
                using (HttpResponseMessage response = await client.GetAsync(origin, HttpCompletionOption.ResponseHeadersRead, _formLifetime.Token))
                    reachable = (int)response.StatusCode < 500;
            }
            catch (HttpRequestException) { }
            catch (OperationCanceledException) { }
        }
        string runtimeVersion = "unknown";
        foreach (string relative in new string[] { "node_modules/@deepseek-ai/dsh/package.json", "apps/cli/package.json", "package.json" })
        {
            string path = Path.Combine(repository, relative);
            if (repository.Length == 0 || !File.Exists(path)) continue;
            try
            {
                Dictionary<string, object> manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                runtimeVersion = GetString(manifest, "version");
                break;
            }
            catch (Exception error) { if (!(error is IOException || error is ArgumentException || error is InvalidOperationException)) throw; }
        }
        AssemblyInformationalVersionAttribute version = (AssemblyInformationalVersionAttribute)Attribute.GetCustomAttribute(typeof(MainForm).Assembly, typeof(AssemblyInformationalVersionAttribute));
        return new Dictionary<string, object> {
            { "schemaVersion", 1 }, { "distribution", OverlayBinding.Present ? "overlay" : "full" },
            { "launcherVersion", version == null ? "development" : version.InformationalVersion },
            { "runtimeVersion", runtimeVersion }, { "runtimePath", repository }, { "nodePath", node },
            { "dataPath", AppPaths.DataDir }, { "homePath", AppPaths.DshHome }, { "desktopUrl", origin },
            { "desktopReachable", reachable }, { "hubReady", _webUiVerified },
            { "checks", new object[] {
                ManagementCheck("runtime", "Runtime", repository.Length > 0, repository),
                ManagementCheck("node", "Node.js", File.Exists(node), node),
                ManagementCheck("desktop", "DSH endpoint", reachable, origin),
                ManagementCheck("data", "User data", Directory.Exists(AppPaths.DshHome), AppPaths.DshHome)
            } },
            { "capabilities", new object[] {
                ManagementCapability("enhancements", "Desktop enhancements", File.Exists(Path.Combine(AppPaths.ExeDir, "enhancements.js")), "Native web adapter; explicit restart applies preferences."),
                ManagementCapability("desktop-reload", "Restart DSH", File.Exists(Path.Combine(AppPaths.ExeDir, "dsh.exe")), "HUB remains open; running DSH tasks may be interrupted."),
                ManagementCapability("mobile", "Phone access", File.Exists(Path.Combine(AppPaths.ExeDir, "mobile", "relay.mjs")) && File.Exists(node), "Opt-in trusted-LAN HTTP with pairing and device revocation.")
            } }
        };
    }

    private static object ManagementCheck(string id, string label, bool ready, string detail)
    {
        return new Dictionary<string, object> { { "id", id }, { "label", label }, { "status", ready ? "ok" : "warning" }, { "detail", detail } };
    }

    private static object ManagementCapability(string id, string label, bool available, string detail)
    {
        return new Dictionary<string, object> { { "id", id }, { "label", label }, { "available", available }, { "detail", detail } };
    }

    private void DisposeManagement()
    {
        _mobileConnection.Dispose();
        if (!_hubMode)
        {
            try { DesktopEndpoint.Withdraw(); }
            catch (Exception ex) { AppendLog("Desktop discovery cleanup: " + ex.Message); }
        }
    }
}
