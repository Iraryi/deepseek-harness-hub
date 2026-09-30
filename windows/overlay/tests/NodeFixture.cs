using System.Reflection;
[assembly: AssemblyProduct("Overlay test fixture - never execute as Node")]
[assembly: AssemblyFileVersion("24.0.0.0")]
[assembly: AssemblyInformationalVersion("24.0.0")]
internal static class NodeFixture
{
    private static int Main() { return 99; }
}
