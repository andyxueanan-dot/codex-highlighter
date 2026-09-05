using System;
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
            int port = target.FindPort();
            if (port > 0)
            {
                target.Attach(port);
                target.Focus();
                return CodexOpenResult.Connected;
            }
            // Count processes even before a window exists, including another launch
            // that raced with the endpoint probe. Never restart an existing process.
            if (target.IsRunning())
            {
                target.Focus();
                target.WaitForNextLaunch();
                return CodexOpenResult.WaitingForNextLaunch;
            }
            target.LaunchAndWatch();
            return CodexOpenResult.Started;
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
