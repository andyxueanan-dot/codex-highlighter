using System.Threading;

// No tray, files, or Codex access; only holds its executable open during an update test.
internal static class InstallerHold
{
    private static void Main() { Thread.Sleep(30000); }
}
