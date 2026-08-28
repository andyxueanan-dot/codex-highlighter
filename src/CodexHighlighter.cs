using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Codex Highlighter")]
[assembly: AssemblyDescription("Persistent yellow text highlighting for the Codex desktop transcript")]
[assembly: AssemblyProduct("Codex Highlighter")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace CodexHighlighter
{
    internal static class Program
    {
        private const string MutexName = "Local\\CodexHighlighter-7E6D1E2B-61EE-4F85-90DD-6B6791A5A61D";

        [STAThread]
        private static int Main(string[] args)
        {
            if (HasArgument(args, "--self-test"))
            {
                return SelfTest.Run(
                    GetArgumentValue(args, "--self-test-output"),
                    HasArgument(args, "--skip-codex-check"));
            }

            bool created;
            using (Mutex mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    MessageBox.Show(
                        "Codex Highlighter 已经在运行。请查看系统托盘中的黄色图标。",
                        "Codex Highlighter",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return 0;
                }

                try
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new HighlighterApplicationContext(
                        HasArgument(args, "--startup")));
                    return 0;
                }
                catch (Exception exception)
                {
                    Log.Write("Fatal error", exception);
                    MessageBox.Show(
                        "Codex Highlighter 无法启动。\r\n\r\n" + exception.Message +
                        "\r\n\r\n日志：" + AppPaths.LogFile,
                        "Codex Highlighter",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    return 1;
                }
            }
        }

        private static bool HasArgument(string[] args, string name)
        {
            foreach (string value in args)
            {
                if (string.Equals(value, name, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string GetArgumentValue(string[] args, string name)
        {
            for (int index = 0; index + 1 < args.Length; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[index + 1];
                }
            }
            return null;
        }
    }

    internal static class AppPaths
    {
        internal static readonly string Root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CodexHighlighter");
        internal static readonly string DataFile = Path.Combine(Root, "highlights.json");
        internal static readonly string PortFile = Path.Combine(Root, "cdp-port.txt");
        internal static readonly string LogFile = Path.Combine(Root, "CodexHighlighter.log");

        internal static void Ensure()
        {
            Directory.CreateDirectory(Root);
        }
    }

    internal static class Log
    {
        private static readonly object Gate = new object();

        internal static void Write(string message)
        {
            Write(message, null);
        }

        internal static void Write(string message, Exception exception)
        {
            try
            {
                AppPaths.Ensure();
                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message;
                if (exception != null) line += "\r\n" + exception;
                lock (Gate)
                {
                    if (File.Exists(AppPaths.LogFile) &&
                        new FileInfo(AppPaths.LogFile).Length > 2 * 1024 * 1024)
                    {
                        string previous = AppPaths.LogFile + ".1";
                        if (File.Exists(previous)) File.Delete(previous);
                        File.Move(AppPaths.LogFile, previous);
                    }
                    File.AppendAllText(AppPaths.LogFile, line + "\r\n", Encoding.UTF8);
                }
            }
            catch
            {
            }
        }
    }

    internal sealed class HighlighterApplicationContext : ApplicationContext
    {
        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem reconnectItem;
        private readonly ToolStripMenuItem reinjectItem;
        private readonly System.Windows.Forms.Timer startupTimer;
        private readonly System.Windows.Forms.Timer uiTimer;
        private readonly HighlighterHost host;
        private readonly bool startupMode;
        private HighlightManagerForm managerForm;
        private bool connecting;

        internal HighlighterApplicationContext(bool startInBackground)
        {
            AppPaths.Ensure();
            startupMode = startInBackground;
            host = new HighlighterHost();

            ContextMenuStrip menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("状态：正在启动");
            statusItem.Enabled = false;
            reconnectItem = new ToolStripMenuItem("连接或重启 Codex", null, OnReconnect);
            reinjectItem = new ToolStripMenuItem("重新加载高亮功能", null, OnReinject);
            ToolStripMenuItem manageData = new ToolStripMenuItem("管理高亮数据", null, OnManageData);
            ToolStripMenuItem openFolder = new ToolStripMenuItem("打开高亮数据目录", null, OnOpenFolder);
            ToolStripMenuItem exit = new ToolStripMenuItem("退出高亮器", null, OnExit);
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(reconnectItem);
            menu.Items.Add(reinjectItem);
            menu.Items.Add(manageData);
            menu.Items.Add(openFolder);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exit);

            trayIcon = new NotifyIcon();
            trayIcon.Icon = CreateYellowIcon();
            trayIcon.Text = "Codex Highlighter - 正在启动";
            trayIcon.ContextMenuStrip = menu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += OnShowStatus;

            startupTimer = new System.Windows.Forms.Timer();
            startupTimer.Interval = 250;
            startupTimer.Tick += OnStartup;
            startupTimer.Start();

            uiTimer = new System.Windows.Forms.Timer();
            uiTimer.Interval = 500;
            uiTimer.Tick += OnUiTick;
            uiTimer.Start();
        }

        private static Icon CreateYellowIcon()
        {
            Bitmap bitmap = new Bitmap(32, 32);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.Transparent);
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (Brush shadow = new SolidBrush(Color.FromArgb(70, 0, 0, 0)))
                {
                    graphics.FillEllipse(shadow, 4, 5, 25, 25);
                }
                using (Brush yellow = new SolidBrush(Color.FromArgb(255, 235, 59)))
                using (Pen border = new Pen(Color.FromArgb(90, 75, 0), 2))
                {
                    graphics.FillEllipse(yellow, 3, 3, 25, 25);
                    graphics.DrawEllipse(border, 3, 3, 25, 25);
                }
                using (Pen marker = new Pen(Color.FromArgb(55, 55, 55), 3))
                {
                    marker.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                    marker.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                    graphics.DrawLine(marker, 10, 21, 22, 9);
                }
            }
            IntPtr handle = bitmap.GetHicon();
            Icon icon = Icon.FromHandle(handle).Clone() as Icon;
            bitmap.Dispose();
            return icon;
        }

        private void OnStartup(object sender, EventArgs eventArgs)
        {
            startupTimer.Stop();
            if (startupMode) host.StartWatching();
            else ConnectInteractive();
        }

        private void ConnectInteractive()
        {
            if (connecting) return;
            connecting = true;
            reconnectItem.Enabled = false;
            statusItem.Text = "状态：正在连接";
            try
            {
                host.EnsureConnected(true);
            }
            catch (Exception exception)
            {
                Log.Write("Connection failed", exception);
                MessageBox.Show(
                    "连接 Codex 失败。\r\n\r\n" + exception.Message +
                    "\r\n\r\n可以从托盘菜单再次连接。",
                    "Codex Highlighter",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            finally
            {
                connecting = false;
                reconnectItem.Enabled = true;
            }
        }

        private void OnReconnect(object sender, EventArgs eventArgs)
        {
            ConnectInteractive();
        }

        private void OnReinject(object sender, EventArgs eventArgs)
        {
            try
            {
                host.ForceReinject();
            }
            catch (Exception exception)
            {
                Log.Write("Manual reinjection failed", exception);
                MessageBox.Show(
                    "重新加载失败：" + exception.Message,
                    "Codex Highlighter",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private void OnOpenFolder(object sender, EventArgs eventArgs)
        {
            AppPaths.Ensure();
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + AppPaths.Root + "\"")
            {
                UseShellExecute = true
            });
        }

        private void OnManageData(object sender, EventArgs eventArgs)
        {
            if (managerForm == null || managerForm.IsDisposed)
            {
                managerForm = new HighlightManagerForm(host);
            }
            managerForm.Show();
            if (managerForm.WindowState == FormWindowState.Minimized)
            {
                managerForm.WindowState = FormWindowState.Normal;
            }
            managerForm.BringToFront();
            managerForm.Activate();
            managerForm.RefreshData();
        }

        private void OnShowStatus(object sender, EventArgs eventArgs)
        {
            MessageBox.Show(
                host.Status + "\r\n\r\n高亮数据：" + AppPaths.DataFile,
                "Codex Highlighter",
                MessageBoxButtons.OK,
                host.IsActive ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }

        private void OnUiTick(object sender, EventArgs eventArgs)
        {
            string status = host.Status;
            statusItem.Text = "状态：" + status;
            reinjectItem.Enabled = host.IsConnected;
            string tooltip = "Codex Highlighter - " + status;
            trayIcon.Text = tooltip.Length <= 63 ? tooltip : tooltip.Substring(0, 63);
        }

        private void OnExit(object sender, EventArgs eventArgs)
        {
            ExitThread();
        }

        protected override void ExitThreadCore()
        {
            startupTimer.Stop();
            uiTimer.Stop();
            if (managerForm != null && !managerForm.IsDisposed) managerForm.Close();
            host.Dispose();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class HighlighterHost : IDisposable
    {
        private const string Version = "1.2.0";
        private const int DefaultPort = 9460;
        private const int HealthyMonitorInterval = 15000;
        private const int DisconnectedMonitorInterval = 5000;
        private readonly object statusGate = new object();
        private readonly CdpClient cdp = new CdpClient();
        private readonly HighlightDataStore store = new HighlightDataStore();
        private readonly HashSet<string> initializedTargets = new HashSet<string>(StringComparer.Ordinal);
        private readonly string injectorScript;
        private System.Threading.Timer monitorTimer;
        private int monitorBusy;
        private int immediateMonitorRequested;
        private int monitorAttempts;
        private int consecutiveFailures;
        private int recoveryBusy;
        private int port;
        private bool disposed;
        private bool watchForCodex;
        private DateTime nextRecoveryUtc = DateTime.MinValue;
        private string status = "等待连接";
        private bool active;
        private bool connected;

        internal HighlighterHost()
        {
            injectorScript = ResourceLoader.ReadText("CodexHighlighter.highlighter.js") +
                "\n//# sourceURL=codex-highlighter.js";
        }

        internal string Status
        {
            get { lock (statusGate) return status; }
        }

        internal bool IsActive
        {
            get { lock (statusGate) return active; }
        }

        internal bool IsConnected
        {
            get { lock (statusGate) return connected; }
        }

        private void SetStatus(string value, bool isConnected, bool isActive)
        {
            lock (statusGate)
            {
                status = value;
                connected = isConnected;
                active = isActive;
            }
        }

        internal void EnsureConnected(bool interactive)
        {
            ThrowIfDisposed();
            watchForCodex = true;
            int existingPort = FindExistingPort();
            if (existingPort > 0)
            {
                port = existingPort;
                SavePort(port);
                StartMonitor();
                MonitorNow();
                return;
            }

            string executable = CodexInstallLocator.Find();
            bool running = CodexProcessManager.IsRunning(executable);
            if (running)
            {
                if (!interactive)
                {
                    SetStatus("Codex 需要重启后连接", false, false);
                    return;
                }
                DialogResult result = MessageBox.Show(
                    "启用真实文本高亮需要让 Codex 以本机调试端口重新启动。\r\n\r\n" +
                    "重启只会关闭并重新打开 Codex，不会修改官方安装文件或删除任务。现在重启吗？",
                    "Codex Highlighter",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button1);
                if (result != DialogResult.Yes)
                {
                    SetStatus("等待用户重启 Codex", false, false);
                    return;
                }
                SetStatus("正在关闭 Codex", false, false);
                CodexProcessManager.Close(executable);
            }

            port = SelectFreePort(DefaultPort);
            SetStatus("正在启动 Codex", false, false);
            Log.Write("Launching Codex with loopback CDP port " + port);
            CodexProcessManager.Launch(executable, port);
            DateTime deadline = DateTime.UtcNow.AddSeconds(45);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(350);
                if (cdp.EndpointReady(port)) break;
                Application.DoEvents();
            }
            if (!cdp.EndpointReady(port))
            {
                SetStatus("连接超时", false, false);
                throw new InvalidOperationException("Codex 没有在 45 秒内开放本机调试端口。");
            }
            Log.Write("Codex CDP endpoint is ready on port " + port);
            SavePort(port);
            StartMonitor();
            MonitorNow();
        }

        internal void StartWatching()
        {
            ThrowIfDisposed();
            watchForCodex = true;
            int existingPort = FindExistingPort();
            port = existingPort > 0
                ? existingPort
                : ReadPort(AppPaths.PortFile);
            if (port <= 0) port = DefaultPort;
            if (existingPort > 0)
            {
                SavePort(port);
                SetStatus("正在连接 Codex", true, false);
            }
            else
            {
                SetStatus("等待 Codex 启动", false, false);
            }
            StartMonitor();
        }

        private int FindExistingPort()
        {
            List<int> candidates = new List<int>();
            AddPort(candidates, ReadPort(AppPaths.PortFile));
            string codeFaceState = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodeFace",
                "state.json");
            AddPort(candidates, ReadPortFromJson(codeFaceState));
            AddPort(candidates, 9341);
            AddPort(candidates, DefaultPort);
            foreach (int candidate in candidates)
            {
                if (cdp.EndpointReady(candidate)) return candidate;
            }
            return 0;
        }

        private static void AddPort(List<int> ports, int value)
        {
            if (value > 0 && value <= 65535 && !ports.Contains(value)) ports.Add(value);
        }

        private static int ReadPort(string path)
        {
            try
            {
                int value;
                if (File.Exists(path) && int.TryParse(File.ReadAllText(path).Trim(), out value))
                {
                    return value;
                }
            }
            catch
            {
            }
            return 0;
        }

        private static int ReadPortFromJson(string path)
        {
            try
            {
                if (!File.Exists(path)) return 0;
                JavaScriptSerializer serializer = Json.CreateSerializer();
                Dictionary<string, object> value = serializer.DeserializeObject(File.ReadAllText(path))
                    as Dictionary<string, object>;
                if (value == null || !value.ContainsKey("port")) return 0;
                return Convert.ToInt32(value["port"]);
            }
            catch
            {
                return 0;
            }
        }

        private static void SavePort(int value)
        {
            AppPaths.Ensure();
            File.WriteAllText(AppPaths.PortFile, value.ToString(), Encoding.ASCII);
        }

        private static int SelectFreePort(int preferred)
        {
            for (int candidate = preferred; candidate <= preferred + 100; candidate++)
            {
                TcpListener listener = null;
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, candidate);
                    listener.Start();
                    return candidate;
                }
                catch (SocketException)
                {
                }
                finally
                {
                    if (listener != null) listener.Stop();
                }
            }
            throw new InvalidOperationException("找不到可用的本机调试端口。");
        }

        private void StartMonitor()
        {
            Log.Write("Starting renderer monitor on CDP port " + port);
            if (monitorTimer == null)
            {
                monitorTimer = new System.Threading.Timer(
                    MonitorTick, null, 0, Timeout.Infinite);
            }
            else
            {
                monitorTimer.Change(0, Timeout.Infinite);
            }
        }

        internal void MonitorNow()
        {
            if (disposed || monitorTimer == null) return;
            Interlocked.Exchange(ref immediateMonitorRequested, 1);
            if (Interlocked.CompareExchange(ref monitorBusy, 0, 0) == 0)
            {
                monitorTimer.Change(0, Timeout.Infinite);
            }
        }

        private void ScheduleNextMonitor()
        {
            if (disposed || monitorTimer == null) return;
            int delay = Interlocked.Exchange(ref immediateMonitorRequested, 0) != 0
                ? 0
                : IsConnected
                    ? HealthyMonitorInterval
                    : DisconnectedMonitorInterval;
            try
            {
                monitorTimer.Change(delay, Timeout.Infinite);
            }
            catch (ObjectDisposedException)
            {
            }
        }

        private void MonitorTick(object state)
        {
            if (disposed || Interlocked.Exchange(ref monitorBusy, 1) != 0) return;
            int attempt = Interlocked.Increment(ref monitorAttempts);
            try
            {
                if (!IsConnected)
                {
                    string executable = CodexInstallLocator.Find();
                    if (!CodexProcessManager.IsRunning(executable))
                    {
                        consecutiveFailures = 0;
                        SetStatus("等待 Codex 启动", false, false);
                        return;
                    }
                }
                if (attempt <= 3) Log.Write("Monitor attempt " + attempt + " started");
                List<CdpTarget> targets = cdp.GetTargets(port);
                targets.RemoveAll(delegate(CdpTarget target)
                {
                    return !IsMainRendererTarget(target);
                });
                if (targets.Count == 0)
                {
                    SetStatus("等待 Codex 窗口", false, false);
                    return;
                }
                if (attempt <= 3) Log.Write("Monitor found " + targets.Count + " Codex renderer target(s)");

                string bestData = store.Load();
                DataStamp bestStamp = HighlightDataStore.Stamp(bestData);
                HashSet<string> liveTargetIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (CdpTarget target in targets)
                {
                    liveTargetIds.Add(target.Id);
                    bool isNewTarget = !initializedTargets.Contains(target.Id);
                    if (attempt <= 3 || isNewTarget)
                    {
                        Log.Write("Checking renderer " + target.Id + " " + target.Url);
                    }

                    RendererSyncState renderer = ReadRendererSyncState(target);
                    if (renderer == null || !string.Equals(renderer.Version, Version, StringComparison.Ordinal))
                    {
                        Log.Write("Injecting highlighter into renderer " + target.Id);
                        cdp.Evaluate(target, injectorScript);
                        renderer = ReadRendererSyncState(target);
                    }
                    if (renderer == null)
                    {
                        throw new InvalidOperationException(
                            "Highlighter renderer state was unavailable after injection.");
                    }

                    if (bestStamp.Valid && IsFileNewer(bestStamp, renderer))
                    {
                        string quoted = Json.CreateSerializer().Serialize(bestData);
                        cdp.Evaluate(target,
                            "window.__CODEX_HIGHLIGHTER__?.importData(" + quoted + ")");
                        renderer = ReadRendererSyncState(target) ?? renderer;
                    }
                    else if (!bestStamp.Valid || IsRendererNewer(renderer, bestStamp))
                    {
                        object exportedValue = cdp.Evaluate(target,
                            "window.__CODEX_HIGHLIGHTER__?.exportData?.() || ''");
                        string exported = exportedValue as string;
                        string newer = store.Newer(bestData, exported);
                        if (!string.Equals(newer, bestData, StringComparison.Ordinal))
                        {
                            bestData = newer;
                            bestStamp = HighlightDataStore.Stamp(bestData);
                        }
                    }
                    initializedTargets.Add(target.Id);
                }
                initializedTargets.IntersectWith(liveTargetIds);

                if (!string.IsNullOrEmpty(bestData)) store.SaveIfNewer(bestData);
                int count = store.Count(bestData);
                consecutiveFailures = 0;
                if (attempt <= 3) Log.Write("Monitor attempt " + attempt + " completed");
                SetStatus("已启用（" + count + " 处高亮）", true, true);
            }
            catch (Exception exception)
            {
                HandleMonitorFailure(exception);
            }
            finally
            {
                Interlocked.Exchange(ref monitorBusy, 0);
                ScheduleNextMonitor();
            }
        }

        private static bool IsMainRendererTarget(CdpTarget target)
        {
            if (target == null || string.IsNullOrEmpty(target.Url)) return false;
            if (!target.Url.StartsWith("app://", StringComparison.OrdinalIgnoreCase)) return false;
            return target.Url.IndexOf("initialRoute=%2Favatar-overlay",
                StringComparison.OrdinalIgnoreCase) < 0 &&
                target.Url.IndexOf("initialRoute=/avatar-overlay",
                StringComparison.OrdinalIgnoreCase) < 0;
        }

        private RendererSyncState ReadRendererSyncState(CdpTarget target)
        {
            object raw = cdp.Evaluate(target,
                "window.__CODEX_HIGHLIGHTER__?.syncState?.() || null");
            Dictionary<string, object> value = raw as Dictionary<string, object>;
            if (value == null) return null;
            try
            {
                RendererSyncState state = new RendererSyncState();
                state.Version = value.ContainsKey("version")
                    ? Convert.ToString(value["version"])
                    : string.Empty;
                state.Revision = value.ContainsKey("revision")
                    ? Convert.ToInt64(value["revision"])
                    : 0;
                state.UpdatedAt = value.ContainsKey("updatedAt")
                    ? Convert.ToInt64(value["updatedAt"])
                    : 0;
                state.Count = value.ContainsKey("count")
                    ? Convert.ToInt32(value["count"])
                    : 0;
                return state;
            }
            catch
            {
                return null;
            }
        }

        private static bool IsFileNewer(DataStamp file, RendererSyncState renderer)
        {
            return file.UpdatedAt > renderer.UpdatedAt ||
                file.UpdatedAt == renderer.UpdatedAt && file.Revision > renderer.Revision;
        }

        private static bool IsRendererNewer(RendererSyncState renderer, DataStamp file)
        {
            return renderer.UpdatedAt > file.UpdatedAt ||
                renderer.UpdatedAt == file.UpdatedAt && renderer.Revision > file.Revision;
        }

        private void HandleMonitorFailure(Exception exception)
        {
            int failures = Interlocked.Increment(ref consecutiveFailures);
            if (failures == 1 || failures % 10 == 0)
            {
                Log.Write("Monitor connection failed (attempt " + failures + ")", exception);
            }
            SetStatus("Codex 连接中断，等待自动恢复", false, false);
            if (!watchForCodex || failures < 3 || DateTime.UtcNow < nextRecoveryUtc)
            {
                return;
            }
            if (Interlocked.Exchange(ref recoveryBusy, 1) != 0) return;
            try
            {
                string executable = CodexInstallLocator.Find();
                if (!CodexProcessManager.IsRunning(executable))
                {
                    consecutiveFailures = 0;
                    SetStatus("等待 Codex 启动", false, false);
                    return;
                }

                nextRecoveryUtc = DateTime.UtcNow.AddSeconds(45);
                SetStatus("正在自动恢复 Codex 高亮", false, false);
                Log.Write("Recovering Codex after its debugging endpoint disappeared");
                CodexProcessManager.Close(executable);
                port = SelectFreePort(DefaultPort);
                CodexProcessManager.Launch(executable, port);

                DateTime deadline = DateTime.UtcNow.AddSeconds(45);
                while (!disposed && DateTime.UtcNow < deadline && !cdp.EndpointReady(port))
                {
                    Thread.Sleep(350);
                }
                if (disposed) return;
                if (!cdp.EndpointReady(port))
                {
                    throw new TimeoutException("自动恢复后 Codex 未在 45 秒内开放调试端口。");
                }

                SavePort(port);
                consecutiveFailures = 0;
                monitorAttempts = 0;
                initializedTargets.Clear();
                SetStatus("自动恢复成功，正在注入", true, false);
                Log.Write("Codex automatic recovery succeeded on port " + port);
                Interlocked.Exchange(ref immediateMonitorRequested, 1);
            }
            catch (Exception recoveryException)
            {
                nextRecoveryUtc = DateTime.UtcNow.AddSeconds(60);
                SetStatus("自动恢复失败，可从托盘手动重连", false, false);
                Log.Write("Codex automatic recovery failed", recoveryException);
            }
            finally
            {
                Interlocked.Exchange(ref recoveryBusy, 0);
            }
        }

        internal void ForceReinject()
        {
            ThrowIfDisposed();
            if (port <= 0 || !cdp.EndpointReady(port))
            {
                throw new InvalidOperationException("Codex 当前没有可用的本机调试连接。");
            }
            foreach (CdpTarget target in cdp.GetTargets(port))
            {
                if (!IsMainRendererTarget(target)) continue;
                try
                {
                    cdp.Evaluate(target,
                        "window.__CODEX_HIGHLIGHTER__ && window.__CODEX_HIGHLIGHTER__.cleanup()");
                }
                catch
                {
                }
                cdp.Evaluate(target, injectorScript);
                initializedTargets.Add(target.Id);
            }
            MonitorNow();
        }

        internal string ReadHighlightData()
        {
            return store.Load();
        }

        internal void ReplaceHighlightData(string value)
        {
            ThrowIfDisposed();
            store.SaveReplacement(value);
            MonitorNow();
        }

        private void ThrowIfDisposed()
        {
            if (disposed) throw new ObjectDisposedException("HighlighterHost");
        }

        public void Dispose()
        {
            disposed = true;
            if (monitorTimer != null)
            {
                monitorTimer.Dispose();
                monitorTimer = null;
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(2);
            while (Interlocked.CompareExchange(ref monitorBusy, 0, 0) != 0 &&
                DateTime.UtcNow < deadline)
            {
                Thread.Sleep(40);
            }
            try
            {
                if (port > 0 && cdp.EndpointReady(port))
                {
                    foreach (CdpTarget target in cdp.GetTargets(port))
                    {
                        if (!IsMainRendererTarget(target))
                        {
                            continue;
                        }
                        cdp.Evaluate(target,
                            "window.__CODEX_HIGHLIGHTER__ && " +
                            "window.__CODEX_HIGHLIGHTER__.cleanup()");
                    }
                }
            }
            catch (Exception exception)
            {
                Log.Write("Could not clean up injected highlighter during exit", exception);
            }
            SetStatus("已退出", false, false);
        }
    }

    internal static class CodexInstallLocator
    {
        internal static string Find()
        {
            string running = FindFromRunningProcess();
            if (!string.IsNullOrEmpty(running)) return running;

            string installRoot = FindAppxInstallRoot();
            if (!string.IsNullOrEmpty(installRoot))
            {
                string appxExecutable = Path.Combine(installRoot, "app", "ChatGPT.exe");
                if (File.Exists(appxExecutable)) return Path.GetFullPath(appxExecutable);
            }

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[]
            {
                Path.Combine(local, "Programs", "Codex", "Codex.exe"),
                Path.Combine(local, "Programs", "Codex", "ChatGPT.exe"),
                Path.Combine(local, "OpenAI", "Codex", "Codex.exe")
            };
            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
            throw new FileNotFoundException("没有找到 Codex 桌面应用。请先从官方渠道安装 Codex。");
        }

        private static string FindFromRunningProcess()
        {
            foreach (Process process in Process.GetProcessesByName("ChatGPT"))
            {
                try
                {
                    string path = process.MainModule.FileName;
                    if (path.IndexOf("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return Path.GetFullPath(path);
                    }
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return null;
        }

        private static string FindAppxInstallRoot()
        {
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string powershell = Path.Combine(
                windows,
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = powershell;
            info.Arguments = "-NoProfile -NonInteractive -Command \"" +
                "(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue).InstallLocation\"";
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (Process process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd().Trim();
                if (!process.WaitForExit(7000))
                {
                    process.Kill();
                    return null;
                }
                return Directory.Exists(output) ? output : null;
            }
        }
    }

    internal static class CodexProcessManager
    {
        internal static bool IsRunning(string executable)
        {
            List<Process> roots = RootProcesses(executable);
            bool running = roots.Count > 0;
            DisposeProcesses(roots);
            return running;
        }

        private static List<Process> MatchingProcesses(string executable)
        {
            List<Process> result = new List<Process>();
            string expected = Path.GetFullPath(executable);
            foreach (Process process in Process.GetProcessesByName("ChatGPT"))
            {
                try
                {
                    string actual = Path.GetFullPath(process.MainModule.FileName);
                    if (string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add(process);
                        continue;
                    }
                }
                catch
                {
                }
                process.Dispose();
            }
            return result;
        }

        private static List<Process> RootProcesses(string executable)
        {
            List<Process> roots = new List<Process>();
            foreach (Process process in MatchingProcesses(executable))
            {
                try
                {
                    if (!process.HasExited && process.MainWindowHandle != IntPtr.Zero)
                    {
                        roots.Add(process);
                        continue;
                    }
                }
                catch (InvalidOperationException)
                {
                }
                process.Dispose();
            }
            return roots;
        }

        private static void DisposeProcesses(List<Process> processes)
        {
            foreach (Process process in processes) process.Dispose();
        }

        internal static void Close(string executable)
        {
            List<Process> roots = RootProcesses(executable);
            if (roots.Count == 0) return;
            List<int> rootIds = new List<int>();
            foreach (Process process in roots)
            {
                try
                {
                    rootIds.Add(process.Id);
                    if (!process.HasExited) process.CloseMainWindow();
                }
                catch (InvalidOperationException)
                {
                }
            }
            DisposeProcesses(roots);

            DateTime deadline = DateTime.UtcNow.AddSeconds(12);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(200);
                if (AllExited(rootIds)) return;
            }

            Exception terminationError = null;
            foreach (int processId in rootIds)
            {
                Process process = null;
                try
                {
                    process = Process.GetProcessById(processId);
                    if (!process.HasExited) process.Kill();
                }
                catch (ArgumentException)
                {
                    // The process no longer exists. That is success.
                }
                catch (InvalidOperationException)
                {
                    // The process exited between HasExited and Kill. That is success.
                }
                catch (System.ComponentModel.Win32Exception exception)
                {
                    terminationError = exception;
                }
                finally
                {
                    if (process != null) process.Dispose();
                }
            }

            deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(200);
                if (AllExited(rootIds)) return;
            }

            if (terminationError != null)
            {
                throw new InvalidOperationException(
                    "Windows 拒绝关闭 Codex 主窗口。请从 Codex 菜单退出应用，再从托盘重新连接。",
                    terminationError);
            }
            throw new InvalidOperationException(
                "Codex 主窗口在 17 秒内没有退出。请手动退出 Codex，再从托盘重新连接。");
        }

        private static bool AllExited(List<int> processIds)
        {
            foreach (int processId in processIds)
            {
                Process process = null;
                try
                {
                    process = Process.GetProcessById(processId);
                    if (!process.HasExited) return false;
                }
                catch (ArgumentException)
                {
                    // PID is gone.
                }
                catch (InvalidOperationException)
                {
                    // Process exited while it was being inspected.
                }
                finally
                {
                    if (process != null) process.Dispose();
                }
            }
            return true;
        }

        internal static void Launch(string executable, int port)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = executable;
            info.Arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + port;
            info.WorkingDirectory = Path.GetDirectoryName(executable);
            info.UseShellExecute = false;
            Process.Start(info);
        }
    }

    internal sealed class CdpTarget
    {
        internal string Id;
        internal string Title;
        internal string Url;
        internal string WebSocketUrl;
    }

    internal sealed class RendererSyncState
    {
        internal string Version;
        internal long Revision;
        internal long UpdatedAt;
        internal int Count;
    }

    internal sealed class CdpClient
    {
        private int messageId;

        internal bool EndpointReady(int port)
        {
            try
            {
                return GetTargets(port).Count > 0;
            }
            catch
            {
                return false;
            }
        }

        internal List<CdpTarget> GetTargets(int port)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(
                "http://127.0.0.1:" + port + "/json/list");
            request.Proxy = null;
            request.Timeout = 1800;
            request.ReadWriteTimeout = 1800;
            request.KeepAlive = false;
            string json;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                json = reader.ReadToEnd();
            }

            object[] values = Json.CreateSerializer().DeserializeObject(json) as object[];
            List<CdpTarget> result = new List<CdpTarget>();
            if (values == null) return result;
            foreach (object raw in values)
            {
                Dictionary<string, object> value = raw as Dictionary<string, object>;
                if (value == null || !value.ContainsKey("webSocketDebuggerUrl")) continue;
                string socketUrl = Convert.ToString(value["webSocketDebuggerUrl"]);
                Uri uri;
                if (!Uri.TryCreate(socketUrl, UriKind.Absolute, out uri)) continue;
                bool loopback = string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(uri.Host, "::1", StringComparison.OrdinalIgnoreCase);
                if (!loopback || uri.Port != port || !string.Equals(uri.Scheme, "ws", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("拒绝连接非本机 CDP WebSocket：" + socketUrl);
                }
                CdpTarget target = new CdpTarget();
                target.Id = Value(value, "id");
                target.Title = Value(value, "title");
                target.Url = Value(value, "url");
                target.WebSocketUrl = socketUrl;
                result.Add(target);
            }
            return result;
        }

        private static string Value(Dictionary<string, object> dictionary, string key)
        {
            return dictionary.ContainsKey(key) ? Convert.ToString(dictionary[key]) : string.Empty;
        }

        internal object Evaluate(CdpTarget target, string expression)
        {
            int id = Interlocked.Increment(ref messageId);
            Dictionary<string, object> parameters = new Dictionary<string, object>();
            parameters["expression"] = expression;
            parameters["awaitPromise"] = true;
            parameters["returnByValue"] = true;
            Dictionary<string, object> request = new Dictionary<string, object>();
            request["id"] = id;
            request["method"] = "Runtime.evaluate";
            request["params"] = parameters;
            string requestJson = Json.CreateSerializer().Serialize(request);

            using (RawWebSocket socket = RawWebSocket.Connect(target.WebSocketUrl, 8000))
            {
                socket.SendText(requestJson);
                while (true)
                {
                    string text = socket.ReceiveText();
                    Dictionary<string, object> response =
                        Json.CreateSerializer().DeserializeObject(text) as Dictionary<string, object>;
                    if (response == null || !response.ContainsKey("id") ||
                        Convert.ToInt32(response["id"]) != id) continue;
                    if (response.ContainsKey("error"))
                    {
                        throw new InvalidOperationException("CDP 执行失败：" +
                            Json.CreateSerializer().Serialize(response["error"]));
                    }
                    Dictionary<string, object> result = response.ContainsKey("result")
                        ? response["result"] as Dictionary<string, object>
                        : null;
                    if (result == null) return null;
                    if (result.ContainsKey("exceptionDetails"))
                    {
                        throw new InvalidOperationException("注入脚本发生异常：" +
                            Json.CreateSerializer().Serialize(result["exceptionDetails"]));
                    }
                    Dictionary<string, object> runtimeResult = result.ContainsKey("result")
                        ? result["result"] as Dictionary<string, object>
                        : null;
                    return runtimeResult != null && runtimeResult.ContainsKey("value")
                        ? runtimeResult["value"]
                        : null;
                }
            }
        }
    }

    internal sealed class RawWebSocket : IDisposable
    {
        private const string WebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        private readonly TcpClient client;
        private readonly NetworkStream stream;
        private readonly RandomNumberGenerator random = RandomNumberGenerator.Create();
        private bool disposed;

        private RawWebSocket(TcpClient value)
        {
            client = value;
            stream = value.GetStream();
        }

        internal static RawWebSocket Connect(string url, int timeoutMilliseconds)
        {
            Uri uri = new Uri(url);
            if (!string.Equals(uri.Scheme, "ws", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("仅允许未加密的本机 CDP WebSocket。");
            }
            bool loopback = string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "::1", StringComparison.OrdinalIgnoreCase);
            if (!loopback) throw new InvalidOperationException("拒绝连接非本机 WebSocket。");

            TcpClient client = new TcpClient();
            IAsyncResult pending = client.BeginConnect(uri.Host, uri.Port, null, null);
            try
            {
                if (!pending.AsyncWaitHandle.WaitOne(timeoutMilliseconds))
                {
                    client.Close();
                    throw new TimeoutException("连接 CDP WebSocket 超时。");
                }
                client.EndConnect(pending);
            }
            finally
            {
                pending.AsyncWaitHandle.Close();
            }
            client.NoDelay = true;
            client.ReceiveTimeout = timeoutMilliseconds;
            client.SendTimeout = timeoutMilliseconds;
            RawWebSocket socket = new RawWebSocket(client);
            try
            {
                socket.Handshake(uri);
                return socket;
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }

        private void Handshake(Uri uri)
        {
            byte[] nonce = new byte[16];
            random.GetBytes(nonce);
            string key = Convert.ToBase64String(nonce);
            string path = string.IsNullOrEmpty(uri.PathAndQuery) ? "/" : uri.PathAndQuery;
            string request = "GET " + path + " HTTP/1.1\r\n" +
                "Host: " + uri.Host + ":" + uri.Port + "\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Key: " + key + "\r\n" +
                "Sec-WebSocket-Version: 13\r\n\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(request);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();

            string headers = ReadHeaders(64 * 1024);
            string[] lines = headers.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0 || lines[0].IndexOf(" 101 ", StringComparison.Ordinal) < 0)
            {
                throw new IOException("CDP WebSocket 握手失败：" +
                    (lines.Length > 0 ? lines[0] : "empty response"));
            }
            string accept = null;
            foreach (string line in lines)
            {
                int colon = line.IndexOf(':');
                if (colon <= 0) continue;
                if (string.Equals(line.Substring(0, colon).Trim(),
                    "Sec-WebSocket-Accept", StringComparison.OrdinalIgnoreCase))
                {
                    accept = line.Substring(colon + 1).Trim();
                    break;
                }
            }
            string expected;
            using (SHA1 sha1 = SHA1.Create())
            {
                expected = Convert.ToBase64String(
                    sha1.ComputeHash(Encoding.ASCII.GetBytes(key + WebSocketGuid)));
            }
            if (!string.Equals(accept, expected, StringComparison.Ordinal))
            {
                throw new IOException("CDP WebSocket 握手校验失败。");
            }
        }

        private string ReadHeaders(int maximumBytes)
        {
            List<byte> bytes = new List<byte>();
            int matched = 0;
            byte[] marker = new byte[] { 13, 10, 13, 10 };
            while (bytes.Count < maximumBytes)
            {
                int value = stream.ReadByte();
                if (value < 0) throw new EndOfStreamException("CDP WebSocket 握手响应提前结束。");
                byte current = (byte)value;
                bytes.Add(current);
                if (current == marker[matched])
                {
                    matched++;
                    if (matched == marker.Length) return Encoding.ASCII.GetString(bytes.ToArray());
                }
                else
                {
                    matched = current == marker[0] ? 1 : 0;
                }
            }
            throw new InvalidDataException("CDP WebSocket 握手头过大。");
        }

        internal void SendText(string text)
        {
            SendFrame(0x1, Encoding.UTF8.GetBytes(text));
        }

        private void SendFrame(byte opcode, byte[] payload)
        {
            if (payload.Length > 4 * 1024 * 1024)
            {
                throw new InvalidDataException("WebSocket 发送内容超过 4 MiB 限制。");
            }
            using (MemoryStream frame = new MemoryStream())
            {
                frame.WriteByte((byte)(0x80 | opcode));
                if (payload.Length <= 125)
                {
                    frame.WriteByte((byte)(0x80 | payload.Length));
                }
                else if (payload.Length <= ushort.MaxValue)
                {
                    frame.WriteByte((byte)(0x80 | 126));
                    frame.WriteByte((byte)((payload.Length >> 8) & 0xff));
                    frame.WriteByte((byte)(payload.Length & 0xff));
                }
                else
                {
                    frame.WriteByte((byte)(0x80 | 127));
                    ulong length = (ulong)payload.Length;
                    for (int shift = 56; shift >= 0; shift -= 8)
                    {
                        frame.WriteByte((byte)((length >> shift) & 0xff));
                    }
                }
                byte[] mask = new byte[4];
                random.GetBytes(mask);
                frame.Write(mask, 0, mask.Length);
                for (int index = 0; index < payload.Length; index++)
                {
                    frame.WriteByte((byte)(payload[index] ^ mask[index % 4]));
                }
                byte[] bytes = frame.ToArray();
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();
            }
        }

        internal string ReceiveText()
        {
            using (MemoryStream message = new MemoryStream())
            {
                bool started = false;
                while (true)
                {
                    WebSocketFrame frame = ReadFrame();
                    if (frame.Opcode == 0x8) throw new IOException("CDP WebSocket 已关闭。");
                    if (frame.Opcode == 0x9)
                    {
                        SendFrame(0xA, frame.Payload);
                        continue;
                    }
                    if (frame.Opcode == 0xA) continue;
                    if (frame.Opcode == 0x1) started = true;
                    else if (frame.Opcode != 0x0 || !started) continue;
                    message.Write(frame.Payload, 0, frame.Payload.Length);
                    if (message.Length > 4 * 1024 * 1024)
                    {
                        throw new InvalidDataException("CDP 响应超过 4 MiB 限制。");
                    }
                    if (frame.Final) return Encoding.UTF8.GetString(message.ToArray());
                }
            }
        }

        private WebSocketFrame ReadFrame()
        {
            byte[] header = ReadExact(2);
            bool final = (header[0] & 0x80) != 0;
            byte opcode = (byte)(header[0] & 0x0f);
            bool masked = (header[1] & 0x80) != 0;
            ulong length = (ulong)(header[1] & 0x7f);
            if (length == 126)
            {
                byte[] extended = ReadExact(2);
                length = (ulong)((extended[0] << 8) | extended[1]);
            }
            else if (length == 127)
            {
                byte[] extended = ReadExact(8);
                length = 0;
                foreach (byte value in extended) length = (length << 8) | value;
            }
            if (length > 4 * 1024 * 1024)
            {
                throw new InvalidDataException("CDP WebSocket 帧超过 4 MiB 限制。");
            }
            byte[] mask = masked ? ReadExact(4) : null;
            byte[] payload = ReadExact((int)length);
            if (mask != null)
            {
                for (int index = 0; index < payload.Length; index++)
                {
                    payload[index] ^= mask[index % 4];
                }
            }
            WebSocketFrame frame = new WebSocketFrame();
            frame.Final = final;
            frame.Opcode = opcode;
            frame.Payload = payload;
            return frame;
        }

        private byte[] ReadExact(int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = stream.Read(buffer, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException("CDP WebSocket 数据提前结束。");
                offset += read;
            }
            return buffer;
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            try { client.Close(); } catch { }
            stream.Dispose();
            random.Dispose();
        }

        private sealed class WebSocketFrame
        {
            internal bool Final;
            internal byte Opcode;
            internal byte[] Payload;
        }
    }

    internal sealed class HighlightDataStore
    {
        private readonly object gate = new object();

        internal string Load()
        {
            lock (gate)
            {
                try
                {
                    if (!File.Exists(AppPaths.DataFile)) return null;
                    string value = File.ReadAllText(AppPaths.DataFile, Encoding.UTF8);
                    return Stamp(value).Valid ? value : null;
                }
                catch (Exception exception)
                {
                    Log.Write("Could not load highlight data", exception);
                    return null;
                }
            }
        }

        internal string Newer(string left, string right)
        {
            DataStamp leftStamp = Stamp(left);
            DataStamp rightStamp = Stamp(right);
            if (!rightStamp.Valid) return leftStamp.Valid ? left : null;
            if (!leftStamp.Valid) return right;
            if (rightStamp.UpdatedAt > leftStamp.UpdatedAt) return right;
            if (rightStamp.UpdatedAt == leftStamp.UpdatedAt && rightStamp.Revision > leftStamp.Revision)
            {
                return right;
            }
            return left;
        }

        internal void SaveIfNewer(string value)
        {
            DataStamp incoming = Stamp(value);
            if (!incoming.Valid) return;
            lock (gate)
            {
                string current = null;
                try
                {
                    if (File.Exists(AppPaths.DataFile))
                    {
                        current = File.ReadAllText(AppPaths.DataFile, Encoding.UTF8);
                    }
                }
                catch
                {
                }
                if (!string.Equals(Newer(current, value), value, StringComparison.Ordinal)) return;
                AppPaths.Ensure();
                string temporary = AppPaths.DataFile + ".tmp";
                File.WriteAllText(temporary, value, new UTF8Encoding(false));
                File.Copy(temporary, AppPaths.DataFile, true);
                File.Delete(temporary);
            }
        }

        internal void SaveReplacement(string value)
        {
            DataStamp incoming = Stamp(value);
            if (!incoming.Valid)
            {
                throw new InvalidDataException("高亮数据格式无效、数量过多或文件超过 5 MiB。");
            }
            lock (gate)
            {
                AppPaths.Ensure();
                string temporary = AppPaths.DataFile + ".tmp";
                File.WriteAllText(temporary, value, new UTF8Encoding(false));
                File.Copy(temporary, AppPaths.DataFile, true);
                File.Delete(temporary);
            }
        }

        internal int Count(string value)
        {
            return Stamp(value).Count;
        }

        internal static DataStamp Stamp(string value)
        {
            DataStamp stamp = new DataStamp();
            if (string.IsNullOrEmpty(value) || value.Length > 5 * 1024 * 1024) return stamp;
            try
            {
                Dictionary<string, object> root =
                    Json.CreateSerializer().DeserializeObject(value) as Dictionary<string, object>;
                if (root == null || !root.ContainsKey("highlights")) return stamp;
                object[] highlights = root["highlights"] as object[];
                if (highlights == null || highlights.Length > 2000) return stamp;
                stamp.Valid = true;
                stamp.UpdatedAt = root.ContainsKey("updatedAt")
                    ? Convert.ToInt64(root["updatedAt"])
                    : 0;
                stamp.Revision = root.ContainsKey("revision")
                    ? Convert.ToInt64(root["revision"])
                    : 0;
                stamp.Count = highlights.Length;
                return stamp;
            }
            catch
            {
                return stamp;
            }
        }
    }

    internal struct DataStamp
    {
        internal bool Valid;
        internal long UpdatedAt;
        internal long Revision;
        internal int Count;
    }

    internal static class Json
    {
        internal static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = 8 * 1024 * 1024;
            serializer.RecursionLimit = 100;
            return serializer;
        }
    }

    internal static class ResourceLoader
    {
        internal static string ReadText(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(name))
            {
                if (stream == null) throw new InvalidOperationException("缺少嵌入资源：" + name);
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
        }
    }

    internal static class SelfTest
    {
        internal static int Run(string outputPath, bool skipCodexCheck)
        {
            List<string> lines = new List<string>();
            try
            {
                string script = ResourceLoader.ReadText("CodexHighlighter.highlighter.js");
                Require(script.Length > 10000, "注入脚本长度异常");
                Require(script.Contains("CSS.highlights"), "注入脚本缺少 CSS Highlights API");
                Require(script.Contains("__CODEX_HIGHLIGHTER__"), "注入脚本缺少状态标记");
                lines.Add("PASS embedded-script");

                string sample = "{\"version\":1,\"revision\":2,\"updatedAt\":3," +
                    "\"highlights\":[{\"id\":\"x\",\"exact\":\"hello\"}]}";
                DataStamp stamp = HighlightDataStore.Stamp(sample);
                Require(stamp.Valid && stamp.Count == 1 && stamp.Revision == 2,
                    "高亮数据校验失败");
                lines.Add("PASS data-validation");

                object[] imported = HighlightManagerForm.GetHighlights(sample, true);
                Require(imported.Length == 1, "数据管理器无法读取合法记录");
                string cleared = HighlightManagerForm.BuildUpdatedDocument(sample, new object[0]);
                DataStamp clearedStamp = HighlightDataStore.Stamp(cleared);
                Require(clearedStamp.Valid && clearedStamp.Count == 0 && clearedStamp.Revision == 3,
                    "数据管理器无法生成新版文档");
                lines.Add("PASS data-manager-json-operations");

                using (HighlighterHost managerHost = new HighlighterHost())
                using (HighlightManagerForm managerForm = new HighlightManagerForm(managerHost))
                {
                    managerForm.CreateControl();
                    managerForm.RefreshData();
                    Require(managerForm.Controls.Count >= 3, "数据管理窗口未正确构造");
                }
                lines.Add("PASS data-manager-window");

                if (skipCodexCheck)
                {
                    lines.Add("SKIP codex-integration-check");
                }
                else
                {
                    string executable = CodexInstallLocator.Find();
                    Require(File.Exists(executable), "没有找到 Codex 可执行文件");
                    lines.Add("PASS codex-locator " + executable);
                    Require(CodexProcessManager.IsRunning(executable),
                        "没有识别到当前 Codex 主窗口进程");
                    lines.Add("PASS codex-root-process");
                }

                int port = TestFreePort();
                Require(port > 0, "无法分配本机端口");
                lines.Add("PASS loopback-port " + port);
                lines.Add("SELF-TEST PASSED");
                WriteOutput(outputPath, lines);
                return 0;
            }
            catch (Exception exception)
            {
                lines.Add("SELF-TEST FAILED");
                lines.Add(exception.ToString());
                WriteOutput(outputPath, lines);
                return 1;
            }
        }

        private static int TestFreePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void WriteOutput(string outputPath, List<string> lines)
        {
            string text = string.Join(Environment.NewLine, lines.ToArray());
            if (!string.IsNullOrEmpty(outputPath))
            {
                File.WriteAllText(outputPath, text, Encoding.UTF8);
            }
            else
            {
                MessageBox.Show(text, "Codex Highlighter Self-Test");
            }
        }
    }
}
