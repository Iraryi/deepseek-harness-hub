using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed class MobileConnection : IDisposable
{
    private readonly object gate = new object();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<Dictionary<string, object>>> pending = new ConcurrentDictionary<string, TaskCompletionSource<Dictionary<string, object>>>();
    private Process process;
    private bool disposed;

    internal Dictionary<string, object> Status()
    {
        lock (gate)
        {
            if (disposed || process == null) return StoppedStatus();
            if (process.HasExited)
            {
                CloseChild();
                return StoppedStatus();
            }
            return Send("status", null);
        }
    }

    internal Dictionary<string, object> Start(string nodeExecutable, string scriptPath, string upstreamUrl,
        string bindAddress, int port, bool trustedLanConsent, string upstreamAuthUrl = null, string upstreamCookie = null)
    {
        lock (gate)
        {
            if (disposed) throw new ObjectDisposedException("MobileConnection");
            if (process != null) throw new InvalidOperationException("already_running: Stop the mobile relay before starting again.");
            if (!trustedLanConsent) throw new InvalidOperationException("consent_required: Explicit trusted-LAN HTTP consent is required.");
            string node = ExistingAbsoluteFile(nodeExecutable, ".exe");
            string script = ExistingAbsoluteFile(scriptPath, ".mjs");
            ProcessStartInfo start = new ProcessStartInfo(node, "\"" + script + "\"");
            start.WorkingDirectory = Path.GetDirectoryName(script);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = new UTF8Encoding(false);
            start.StandardErrorEncoding = new UTF8Encoding(false);
            List<string> remove = new List<string>();
            foreach (DictionaryEntry entry in start.EnvironmentVariables)
            {
                string key = (string)entry.Key;
                if (Regex.IsMatch(key, "KEY|SECRET|TOKEN|PASSWORD", RegexOptions.IgnoreCase)
                    || key.Equals("NODE_OPTIONS", StringComparison.OrdinalIgnoreCase)
                    || key.Equals("NODE_PATH", StringComparison.OrdinalIgnoreCase)) remove.Add(key);
            }
            foreach (string key in remove) start.EnvironmentVariables.Remove(key);
            Process child = new Process();
            child.StartInfo = start;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += Receive;
            child.ErrorDataReceived += DrainError;
            child.Exited += ChildExited;
            try
            {
                if (!child.Start()) throw new InvalidOperationException("node_start_failed: Installed Node could not start.");
                process = child;
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                return Send("start", new Dictionary<string, object>
                {
                    { "upstreamUrl", upstreamUrl }, { "bindAddress", bindAddress }, { "port", port },
                    { "trustedLanConsent", trustedLanConsent }, { "upstreamAuthUrl", upstreamAuthUrl },
                    { "upstreamCookie", upstreamCookie }
                });
            }
            catch
            {
                if (process != null) CloseChild();
                else child.Dispose();
                throw;
            }
        }
    }

    internal Dictionary<string, object> Pair()
    {
        lock (gate) { return Send("pair", null); }
    }

    internal Dictionary<string, object> Revoke(string deviceId)
    {
        lock (gate)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) throw new ArgumentException("Device id is required.", "deviceId");
            return Send("revoke", new Dictionary<string, object> { { "deviceId", deviceId } });
        }
    }

    internal Dictionary<string, object> Stop()
    {
        lock (gate)
        {
            try
            {
                if (process != null && !process.HasExited) Send("stop", null);
            }
            finally { CloseChild(); }
            return StoppedStatus();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            try { Stop(); }
            finally { disposed = true; }
        }
    }

    private static string ExistingAbsoluteFile(string value, string extension)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value) || value.IndexOfAny(new[] { '"', '\r', '\n' }) >= 0
            || !string.Equals(Path.GetExtension(value), extension, StringComparison.OrdinalIgnoreCase) || !File.Exists(value))
            throw new ArgumentException("Provide explicit existing absolute Node executable and relay .mjs paths; no downloads are performed.");
        return Path.GetFullPath(value);
    }

    private Dictionary<string, object> Send(string command, Dictionary<string, object> arguments)
    {
        if (disposed) throw new ObjectDisposedException("MobileConnection");
        if (process == null || process.HasExited) throw new InvalidOperationException("not_running: Start the mobile relay first.");
        string id = Guid.NewGuid().ToString("N");
        Dictionary<string, object> request = arguments ?? new Dictionary<string, object>();
        request["id"] = id;
        request["command"] = command;
        TaskCompletionSource<Dictionary<string, object>> completion = new TaskCompletionSource<Dictionary<string, object>>();
        pending[id] = completion;
        try
        {
            string line = new JavaScriptSerializer().Serialize(request);
            if (line.Length > 32768) throw new ArgumentException("Mobile relay command exceeds the protocol size limit.");
            byte[] bytes = new UTF8Encoding(false).GetBytes(line + "\n");
            process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
            process.StandardInput.BaseStream.Flush();
            if (!completion.Task.Wait(15000))
            {
                CloseChild();
                throw new TimeoutException("relay_timeout: Mobile relay did not respond to " + command + "; its process was stopped.");
            }
            Dictionary<string, object> response = completion.Task.GetAwaiter().GetResult();
            object success;
            if (!response.TryGetValue("ok", out success) || !(success is bool) || !(bool)success)
            {
                object rawError;
                Dictionary<string, object> error = response.TryGetValue("error", out rawError) ? rawError as Dictionary<string, object> : null;
                throw new InvalidOperationException(error == null ? "relay_failed: Mobile relay failed." : Convert.ToString(error["code"]) + ": " + Convert.ToString(error["message"]));
            }
            return (Dictionary<string, object>)response["result"];
        }
        finally
        {
            TaskCompletionSource<Dictionary<string, object>> removed;
            pending.TryRemove(id, out removed);
        }
    }

    private void Receive(object sender, DataReceivedEventArgs args)
    {
        if (!object.ReferenceEquals(sender, process)) return;
        if (string.IsNullOrEmpty(args.Data)) return;
        try
        {
            if (args.Data.Length > 32768) throw new InvalidDataException("Oversized relay response.");
            Dictionary<string, object> response = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(args.Data);
            object rawId;
            TaskCompletionSource<Dictionary<string, object>> completion;
            if (response != null && response.TryGetValue("id", out rawId) && rawId is string && pending.TryGetValue((string)rawId, out completion))
                completion.TrySetResult(response);
        }
        catch (Exception)
        {
            FailPending("relay_protocol_failed: Invalid mobile relay response.");
        }
    }

    private void DrainError(object sender, DataReceivedEventArgs args)
    {
        if (args.Data == null) return;
    }

    private void ChildExited(object sender, EventArgs args)
    {
        if (!object.ReferenceEquals(sender, process)) return;
        FailPending("relay_exited: Mobile relay process exited.");
    }

    private void FailPending(string message)
    {
        foreach (TaskCompletionSource<Dictionary<string, object>> completion in pending.Values)
            completion.TrySetResult(new Dictionary<string, object>
            {
                { "ok", false }, { "error", new Dictionary<string, object> { { "code", "relay_unavailable" }, { "message", message } } }
            });
    }

    private void CloseChild()
    {
        Process child = process;
        if (child == null) return;
        process = null;
        child.OutputDataReceived -= Receive;
        child.ErrorDataReceived -= DrainError;
        child.Exited -= ChildExited;
        try
        {
            if (!child.HasExited)
            {
                child.StandardInput.Close();
                if (!child.WaitForExit(3000))
                {
                    child.Kill();
                    if (!child.WaitForExit(5000)) throw new TimeoutException("relay_cleanup_failed: Node did not exit after termination.");
                }
            }
        }
        finally
        {
            FailPending("relay_stopped: Mobile relay stopped.");
            child.Dispose();
        }
    }

    private static Dictionary<string, object> StoppedStatus()
    {
        return new Dictionary<string, object>
        {
            { "running", false }, { "bindAddress", null }, { "port", null }, { "url", null },
            { "upstreamUrl", null }, { "transport", "http-trusted-lan" },
            { "devices", new object[0] }, { "pairingExpiresAt", null }
        };
    }
}
