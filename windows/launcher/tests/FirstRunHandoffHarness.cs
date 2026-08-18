using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;

internal static class FirstRunHandoffHarness
{
    private const uint KillOnJobClose = 0x00002000;
    private const int ExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInfo
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimitInfo info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 10;
        string app = Path.GetFullPath(args[0]);
        string desktopPath = Path.Combine(app, "dsh.exe");
        string configPath = Path.Combine(app, "dsh-config.exe");
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

        ExtendedLimitInfo info = new ExtendedLimitInfo();
        info.BasicLimitInformation.LimitFlags = KillOnJobClose;
        if (!SetInformationJobObject(job, ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(ExtendedLimitInfo))))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
            throw new Win32Exception(Marshal.GetLastWin32Error());

        Directory.SetCurrentDirectory(app);
        Assembly assembly = Assembly.LoadFrom(configPath);
        Type type = assembly.GetType("ConfigForm", true);
        object form = Activator.CreateInstance(type, new object[] { true, false });
        MethodInfo method = type.GetMethod("SaveAndClose", BindingFlags.Instance | BindingFlags.NonPublic);
        method.Invoke(form, new object[] { true });
        PropertyInfo launchAfterClose = type.GetProperty("LaunchAfterClose", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        if (launchAfterClose == null || !(bool)launchAfterClose.GetValue(form, null)) return 13;
        Process startedBeforeConfigClosed = FindDesktop(desktopPath);
        if (startedBeforeConfigClosed != null)
        {
            startedBeforeConfigClosed.Dispose();
            return 15;
        }
        IDisposable disposable = form as IDisposable;
        if (disposable != null) disposable.Dispose();
        MethodInfo launchMethod = type.GetMethod("LaunchApplicationAfterClose", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
        if (launchMethod == null) return 14;
        launchMethod.Invoke(form, null);

        Process desktop = WaitForDesktop(desktopPath);
        if (desktop == null) return 11;
        bool inOuterJob;
        if (!IsProcessInJob(desktop.Handle, job, out inOuterJob))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return inOuterJob ? 12 : 0;
    }

    private static Process WaitForDesktop(string expectedPath)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            Process process = FindDesktop(expectedPath);
            if (process != null) return process;
            Thread.Sleep(100);
        }
        return null;
    }

    private static Process FindDesktop(string expectedPath)
    {
        foreach (Process process in Process.GetProcessesByName("dsh"))
        {
            try
            {
                if (string.Equals(process.MainModule.FileName, expectedPath, StringComparison.OrdinalIgnoreCase))
                    return process;
                process.Dispose();
            }
            catch
            {
                process.Dispose();
            }
        }
        return null;
    }
}
