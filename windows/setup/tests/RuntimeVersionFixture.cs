using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class RuntimeVersionFixture
{
    private static int Main(string[] arguments)
    {
        if (arguments.Length == 3 && arguments[0] == "--watch-stage")
        {
            var timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < 15000)
            {
                foreach (string stage in Directory.GetDirectories(arguments[1], ".runtime-staging-*"))
                {
                    if (!File.Exists(Path.Combine(stage, "runtime-manifest.json"))) continue;
                    using (var held = File.Open(Path.Combine(stage, "main.js"), FileMode.Open, FileAccess.Read, FileShare.None))
                    {
                        File.WriteAllText(arguments[2], "ready");
                        Thread.Sleep(3500);
                    }
                    return 0;
                }
                Thread.Sleep(5);
            }
            return 2;
        }
        Console.WriteLine(arguments.Length == 1 ? "v22.19.0" : "10.0.0");
        return 0;
    }
}
