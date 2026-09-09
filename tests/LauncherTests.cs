using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace CodexHighlighter
{
    internal static class LauncherTests
    {
        private sealed class FakeTarget : ICodexLaunchTarget
        {
            internal bool Running;
            internal int Port;
            internal readonly List<string> Calls = new List<string>();
            public int FindPort() { Calls.Add("probe"); return Port; }
            public bool IsRunning() { Calls.Add("running"); return Running; }
            public void Focus() { Calls.Add("focus"); }
            public void Attach(int port) { Calls.Add("attach:" + port); }
            public void LaunchAndWatch() { Calls.Add("launch"); Running = true; }
            public void WaitForNextLaunch() { Calls.Add("wait"); }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
        }

        private static void CheckEndpoint(string url, bool expected)
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            Task server = Task.Run(() => {
                using (TcpClient client = listener.AcceptTcpClient())
                using (var stream = client.GetStream())
                {
                    client.ReceiveTimeout = 3000;
                    byte[] request = new byte[8192];
                    stream.Read(request, 0, request.Length);
                    string body = "[{\"id\":\"fixture\",\"type\":\"page\",\"url\":\"" + url +
                        "\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1:" + port + "/devtools/page/fixture\"}]";
                    byte[] payload = Encoding.UTF8.GetBytes(body);
                    byte[] headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + payload.Length +
                        "\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n");
                    stream.Write(headers, 0, headers.Length);
                    stream.Write(payload, 0, payload.Length);
                }
            });
            try
            {
                Require(new CdpClient().EndpointReady(port) == expected, "Wrong endpoint accepted: " + url);
                Require(server.Wait(4000), "Fixture endpoint stalled");
            }
            finally { listener.Stop(); }
        }

        private static int Main()
        {
            try
            {
                var cold = new FakeTarget();
                Require(CodexLauncher.Open(cold) == CodexOpenResult.Started, "Cold launch not requested");
                Require(string.Join(",", cold.Calls) == "probe,running,launch", "Cold launch happened more than once");
                cold.Calls.Clear();
                Require(CodexLauncher.Open(cold) == CodexOpenResult.WaitingForNextLaunch, "Starting process ignored");
                Require(!cold.Calls.Contains("launch"), "Double click launched a second process before window ready");

                var ready = new FakeTarget { Running = true, Port = 9487 };
                Require(CodexLauncher.Open(ready) == CodexOpenResult.Connected, "Existing port not reused");
                Require(string.Join(",", ready.Calls) == "probe,attach:9487,focus", "Ready window unexpectedly relaunched");
                var ordinary = new FakeTarget { Running = true };
                Require(CodexLauncher.Open(ordinary) == CodexOpenResult.WaitingForNextLaunch, "Ordinary instance not respected");
                Require(string.Join(",", ordinary.Calls) == "probe,running,focus,wait", "Ordinary instance restarted");
                ordinary.Port = 9488;
                ordinary.Calls.Clear();
                Require(CodexLauncher.Open(ordinary) == CodexOpenResult.Connected, "New port not rediscovered");
                Require(ordinary.Calls.Contains("attach:9488") && !ordinary.Calls.Contains("launch"), "Reconnection relaunched app");
                Console.WriteLine("PASS cold-open, repeated-open, existing-window, changed-port");

                string signalName = "Local\\CodexHighlighter-test-" + Guid.NewGuid().ToString("N");
                using (var owner = new LaunchRequestSignal(signalName))
                using (var second = new LaunchRequestSignal(signalName))
                {
                    Require(!owner.Take(), "Startup created an unsolicited launch");
                    second.Request(); second.Request();
                    Require(owner.Take() && !owner.Take(), "Duplicate requests did not coalesce");
                    second.Request();
                    Require(owner.Take(), "Subsequent launch request was lost");
                }
                Console.WriteLine("PASS single-instance launch signaling");
                using (Process process = Process.GetCurrentProcess())
                    Require(CodexProcessManager.IsRunning(process.MainModule.FileName), "Windowless process missed");
                Console.WriteLine("PASS process-without-main-window detection");
                CheckEndpoint("app://-/index.html", true);
                CheckEndpoint("app://-/index.html?initialRoute=%2Favatar-overlay", false);
                CheckEndpoint("https://example.test", false);
                CheckEndpoint("app://unrelated/index.html", false);
                Console.WriteLine("PASS Codex endpoint identity");
                RetentionTests.Run();
                return 0;
            }
            catch (Exception exception) { Console.Error.WriteLine(exception); return 1; }
        }
    }
}
