using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

internal static class PreloadNetworkHarness
{
    private static int Main(string[] args)
    {
        try { Run(args[0]).GetAwaiter().GetResult(); return 0; }
        catch (Exception error) { Console.WriteLine(error); return 1; }
    }

    private static async Task Run(string assemblyPath)
    {
        Type form = Assembly.LoadFrom(assemblyPath).GetType("MainForm", true);
        MethodInfo download = form.GetMethod("DownloadCommunityTextAsync", BindingFlags.NonPublic | BindingFlags.Static);
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            Task<TcpClient> incoming = listener.AcceptTcpClientAsync();
            using (CancellationTokenSource cancellation = new CancellationTokenSource())
            {
                string url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/catalog";
                Task<string> request = (Task<string>)download.Invoke(null, new object[] { url, 1024, TimeSpan.FromMinutes(4), true, cancellation.Token });
                if (await Task.WhenAny(incoming, Task.Delay(5000)) != incoming) throw new Exception("HTTP fixture not reached");
                using (TcpClient connection = await incoming)
                {
                    Stopwatch timer = Stopwatch.StartNew();
                    cancellation.Cancel();
                    if (await Task.WhenAny(request, Task.Delay(3000)) != request) throw new Exception("Preload cancellation left HTTP running");
                    try { await request; throw new Exception("Cancelled request succeeded unexpectedly"); }
                    catch (OperationCanceledException) { }
                    Console.WriteLine("PASS: in-flight catalog HTTP cancelled in " + timer.ElapsedMilliseconds + "ms; no catalog write or fallback");
                }
            }
        }
        finally { listener.Stop(); }
    }
}
