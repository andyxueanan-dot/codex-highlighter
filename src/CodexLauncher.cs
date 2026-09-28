using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

namespace CodexHighlighter
{
    internal enum CodexOpenResult { Connected, Started, WaitingForNextLaunch }

    // Opening the app has no close/kill operation. Background watching never calls this.
    internal interface ICodexLaunchTarget
    {
        int FindPort();
        bool IsRunning();
        void Focus();
        void Attach(int port);
        void LaunchAndWatch();
        void WaitForNextLaunch();
    }

    internal static class CodexLauncher
    {
        internal static CodexOpenResult Open(ICodexLaunchTarget target)
        {
            // A slow/missing debugging endpoint must not delay opening the window.
            target.Focus();
            int port = target.FindPort();
            if (port > 0)
            {
                target.Attach(port);
                return CodexOpenResult.Connected;
            }
            // Count processes even before a window exists, including another launch
            // that raced with the endpoint probe. Never restart an existing process.
            if (target.IsRunning())
            {
                target.WaitForNextLaunch();
                return CodexOpenResult.WaitingForNextLaunch;
            }
            target.LaunchAndWatch();
            return CodexOpenResult.Started;
        }
    }

    // Store apps should be activated through their registered Windows identity.
    // Keep the normal profile: never substitute --user-data-dir or another account.
    internal static class PackagedCodexActivation
    {
        internal static string AppId(string executable)
        {
            string app = Path.GetDirectoryName(Path.GetFullPath(executable));
            if (!string.Equals(Path.GetFileName(app), "app", StringComparison.OrdinalIgnoreCase)) return null;
            string package = Path.GetDirectoryName(app);
            if (!string.Equals(Path.GetFileName(Path.GetDirectoryName(package)), "WindowsApps",
                StringComparison.OrdinalIgnoreCase)) return null;
            if (!string.Equals(Path.GetFileName(executable), "ChatGPT.exe", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(Path.GetFileName(executable), "Codex.exe", StringComparison.OrdinalIgnoreCase)) return null;
            Match match = Regex.Match(Path.GetFileName(package),
                @"^OpenAI\.Codex_[0-9.]+_(?:x64|arm64|x86|neutral)_[^_]*_([a-z0-9]+)$",
                RegexOptions.IgnoreCase);
            return match.Success ? "OpenAI.Codex_" + match.Groups[1].Value + "!App" : null;
        }

        [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
        private class ActivationManager { }

        [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IActivationManager
        {
            [PreserveSig]
            int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        }

        [DllImport("ole32.dll")]
        private static extern int CoAllowSetForegroundWindow(
            [MarshalAs(UnmanagedType.IUnknown)] object instance, IntPtr reserved);

        internal static bool TryActivate(string executable, string arguments)
        {
            string appId = AppId(executable);
            if (appId == null) return false;
            object manager = new ActivationManager();
            try
            {
                CoAllowSetForegroundWindow(manager, IntPtr.Zero);
                uint pid;
                int result = ((IActivationManager)manager).ActivateApplication(appId, arguments, 0, out pid);
                if (result < 0) Marshal.ThrowExceptionForHR(result);
                Log.Write("Windows app activation accepted: " + appId + ", pid=" + pid);
                return true;
            }
            finally { Marshal.FinalReleaseComObject(manager); }
        }
    }

    internal sealed class LaunchRequestSignal : IDisposable
    {
        internal const string Name = "Local\\CodexHighlighter-Open-Codex-v1";
        private readonly EventWaitHandle handle;

        internal LaunchRequestSignal(string name)
        {
            handle = new EventWaitHandle(false, EventResetMode.AutoReset, name);
        }

        internal void Request() { handle.Set(); }
        internal bool Take() { return handle.WaitOne(0); }
        public void Dispose() { handle.Dispose(); }
    }
}
