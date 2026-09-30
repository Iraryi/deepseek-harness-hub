using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

internal static class MobileConnectionHarness
{
    private static int assertions;

    private static int Main(string[] args)
    {
        try
        {
            Run(args);
            Console.WriteLine("PASS: " + assertions + " native controller assertions; loopback fixtures only.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static void Check(bool value, string message)
    {
        assertions++;
        if (!value) throw new Exception(message);
    }

    private static void Run(string[] args)
    {
        MobileConnection mobile = new MobileConnection();
        try
        {
            Check(!(bool)mobile.Status()["running"], "Status before Start must be stopped.");
            Check(Child(mobile) == null, "Status must not spawn Node.");
            Check(!(bool)mobile.Stop()["running"], "Stop before Start is safe.");
            try { mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, false, args[3]); throw new Exception("Consent was bypassed."); }
            catch (InvalidOperationException) { assertions++; }
            Check(Child(mobile) == null, "Missing consent must not spawn Node.");
            try { mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, true); throw new Exception("DSH auth was bypassed."); }
            catch (InvalidOperationException error) { Check(error.Message.Contains("upstream_auth_required"), "Missing DSH auth must be actionable."); }
            Check(Child(mobile) == null, "Failed Start must clean up Node.");
            for (int iteration = 0; iteration < 2; iteration++)
            {
                Dictionary<string, object> status = mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, true, args[3]);
                Check((bool)status["running"], "Explicit Start must listen.");
                Check((bool)mobile.Status()["running"], "Live Status must round-trip to Node.");
                int childId = Child(mobile).Id;
                Dictionary<string, object> grant = mobile.Pair();
                Uri link = new Uri((string)grant["url"]);
                Check(link.Fragment.Length == 44, "Pair must produce a real secret.");
                string origin = link.GetLeftPart(UriPartial.Authority);
                using (WebClient client = new WebClient())
                {
                    client.Encoding = Encoding.UTF8;
                    client.Headers["Origin"] = origin;
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    string body = new JavaScriptSerializer().Serialize(new { secret = link.Fragment.Substring(1), consent = true, name = "Native fixture phone" });
                    string result = client.UploadString(origin + "/__mobile/pair", body);
                    Check(result.Contains("true"), "Native-issued pairing link must actually pair.");
                }
                IList devices = (IList)mobile.Status()["devices"];
                Check(devices.Count == 1, "Paired device must be visible through native status.");
                string deviceId = (string)((Dictionary<string, object>)devices[0])["id"];
                Check(((IList)mobile.Revoke(deviceId)["devices"]).Count == 0, "Native revoke must remove the device.");
                Check(!(bool)mobile.Stop()["running"], "Stop must return stopped status.");
                Check(Child(mobile) == null, "Stop must release the process handle.");
                Check(!Alive(childId), "Stop must await Node exit.");
                Check(!(bool)mobile.Stop()["running"], "Repeated Stop is safe.");
            }
            mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, true, args[3]);
            Process crashed = Child(mobile);
            crashed.Kill();
            crashed.WaitForExit();
            Check(!(bool)mobile.Status()["running"], "Status after an unexpected child exit must be stopped.");
            Check(Child(mobile) == null, "Crash Status must release the process handle.");
            mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, true, args[3]);
            int disposedChild = Child(mobile).Id;
            mobile.Dispose();
            mobile.Dispose();
            Check(!Alive(disposedChild), "Dispose must await Node exit.");
            Check(!(bool)mobile.Status()["running"], "Disposed Status is safe and stopped.");
            try { mobile.Start(args[0], args[1], args[2], "127.0.0.1", 0, true, args[3]); throw new Exception("Disposed controller restarted."); }
            catch (ObjectDisposedException) { assertions++; }
        }
        finally { mobile.Dispose(); }
    }

    private static Process Child(MobileConnection mobile)
    {
        return (Process)typeof(MobileConnection).GetField("process", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(mobile);
    }

    private static bool Alive(int processId)
    {
        try { using (Process child = Process.GetProcessById(processId)) return !child.HasExited; }
        catch (ArgumentException) { return false; }
    }
}
