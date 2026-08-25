using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace CodexHighlighter
{
    internal sealed class HighlightManagerForm : Form
    {
        private readonly HighlighterHost host;
        private readonly DataGridView grid;
        private readonly TextBox searchBox;
        private readonly Label countLabel;
        private readonly List<HighlightListItem> allItems = new List<HighlightListItem>();

        internal HighlightManagerForm(HighlighterHost value)
        {
            host = value;
            Text = "Codex Highlighter · 高亮数据管理";
            Icon = SystemIcons.Information;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1000, 650);
            MinimumSize = new Size(760, 460);
            Font = new Font("Segoe UI", 9F);

            FlowLayoutPanel toolbar = new FlowLayoutPanel();
            toolbar.Dock = DockStyle.Top;
            toolbar.Height = 48;
            toolbar.Padding = new Padding(10, 8, 10, 6);
            toolbar.WrapContents = false;

            Label searchLabel = new Label();
            searchLabel.Text = "搜索：";
            searchLabel.AutoSize = true;
            searchLabel.Margin = new Padding(0, 7, 2, 0);
            toolbar.Controls.Add(searchLabel);

            searchBox = new TextBox();
            searchBox.Width = 250;
            searchBox.Margin = new Padding(0, 3, 10, 0);
            searchBox.TextChanged += delegate { ApplyFilter(); };
            toolbar.Controls.Add(searchBox);

            toolbar.Controls.Add(CreateButton("刷新", OnRefresh));
            toolbar.Controls.Add(CreateButton("删除选中", OnDeleteSelected));
            toolbar.Controls.Add(CreateButton("清空全部", OnClearAll));
            toolbar.Controls.Add(CreateButton("导出 JSON", OnExport));
            toolbar.Controls.Add(CreateButton("导入 JSON", OnImport));

            countLabel = new Label();
            countLabel.AutoSize = true;
            countLabel.Margin = new Padding(12, 7, 0, 0);
            toolbar.Controls.Add(countLabel);

            grid = new DataGridView();
            grid.Dock = DockStyle.Fill;
            grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false;
            grid.AllowUserToResizeRows = false;
            grid.AutoGenerateColumns = false;
            grid.BackgroundColor = Color.White;
            grid.BorderStyle = BorderStyle.None;
            grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
            grid.ColumnHeadersHeight = 36;
            grid.EnableHeadersVisualStyles = false;
            grid.MultiSelect = true;
            grid.ReadOnly = true;
            grid.RowHeadersVisible = false;
            grid.RowTemplate.Height = 34;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.CellFormatting += OnCellFormatting;

            DataGridViewTextBoxColumn idColumn = new DataGridViewTextBoxColumn();
            idColumn.Name = "Id";
            idColumn.Visible = false;
            grid.Columns.Add(idColumn);

            DataGridViewTextBoxColumn colorColumn = new DataGridViewTextBoxColumn();
            colorColumn.Name = "Color";
            colorColumn.HeaderText = "颜色";
            colorColumn.Width = 75;
            grid.Columns.Add(colorColumn);

            DataGridViewTextBoxColumn quoteColumn = new DataGridViewTextBoxColumn();
            quoteColumn.Name = "Quote";
            quoteColumn.HeaderText = "高亮文字";
            quoteColumn.AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            quoteColumn.MinimumWidth = 260;
            grid.Columns.Add(quoteColumn);

            DataGridViewTextBoxColumn contextColumn = new DataGridViewTextBoxColumn();
            contextColumn.Name = "Context";
            contextColumn.HeaderText = "页面上下文";
            contextColumn.Width = 260;
            grid.Columns.Add(contextColumn);

            DataGridViewTextBoxColumn createdColumn = new DataGridViewTextBoxColumn();
            createdColumn.Name = "Created";
            createdColumn.HeaderText = "创建时间";
            createdColumn.Width = 155;
            grid.Columns.Add(createdColumn);

            Label hint = new Label();
            hint.Dock = DockStyle.Bottom;
            hint.Height = 34;
            hint.Padding = new Padding(12, 8, 0, 0);
            hint.ForeColor = Color.DimGray;
            hint.Text = "提示：删除或导入后，Codex 页面会在约 2 秒内同步。导入前建议先导出备份。";

            Controls.Add(grid);
            Controls.Add(hint);
            Controls.Add(toolbar);
            Shown += delegate { RefreshData(); };
        }

        private static Button CreateButton(string text, EventHandler handler)
        {
            Button button = new Button();
            button.Text = text;
            button.AutoSize = true;
            button.Height = 30;
            button.Margin = new Padding(3, 1, 3, 0);
            button.Click += handler;
            return button;
        }

        internal void RefreshData()
        {
            allItems.Clear();
            try
            {
                object[] highlights = GetHighlights(host.ReadHighlightData(), false);
                foreach (object raw in highlights)
                {
                    Dictionary<string, object> value = raw as Dictionary<string, object>;
                    if (value == null) continue;
                    HighlightListItem item = new HighlightListItem();
                    item.Id = StringValue(value, "id");
                    item.Color = NormalizeColor(StringValue(value, "color"));
                    item.Quote = CleanText(StringValue(value, "exact"));
                    item.Context = CleanText(StringValue(value, "contextKey"));
                    item.Created = CreatedTime(value);
                    if (item.Id.Length > 0 && item.Quote.Length > 0) allItems.Add(item);
                }
                allItems.Sort(delegate(HighlightListItem left, HighlightListItem right)
                {
                    return right.Created.CompareTo(left.Created);
                });
                ApplyFilter();
            }
            catch (Exception exception)
            {
                MessageBox.Show(this, "读取高亮数据失败：" + exception.Message,
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void ApplyFilter()
        {
            string query = searchBox.Text.Trim();
            grid.Rows.Clear();
            foreach (HighlightListItem item in allItems)
            {
                if (query.Length > 0 &&
                    item.Quote.IndexOf(query, StringComparison.CurrentCultureIgnoreCase) < 0 &&
                    item.Context.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }
                grid.Rows.Add(
                    item.Id,
                    ColorLabel(item.Color),
                    item.Quote,
                    item.Context,
                    item.Created == DateTime.MinValue
                        ? string.Empty
                        : item.Created.ToString("yyyy-MM-dd HH:mm:ss"));
            }
            countLabel.Text = "显示 " + grid.Rows.Count + " / 共 " + allItems.Count + " 条";
        }

        private void OnRefresh(object sender, EventArgs eventArgs)
        {
            RefreshData();
        }

        private void OnDeleteSelected(object sender, EventArgs eventArgs)
        {
            HashSet<string> ids = SelectedIds();
            if (ids.Count == 0)
            {
                MessageBox.Show(this, "请先选择要删除的高亮。", Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            DialogResult result = MessageBox.Show(this,
                "确定删除选中的 " + ids.Count + " 条高亮吗？",
                Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (result != DialogResult.Yes) return;
            try
            {
                string current = host.ReadHighlightData();
                List<object> kept = new List<object>();
                foreach (object raw in GetHighlights(current, false))
                {
                    Dictionary<string, object> value = raw as Dictionary<string, object>;
                    if (value == null || ids.Contains(StringValue(value, "id"))) continue;
                    kept.Add(value);
                }
                host.ReplaceHighlightData(BuildUpdatedDocument(current, kept.ToArray()));
                RefreshData();
            }
            catch (Exception exception)
            {
                ShowActionError("删除失败", exception);
            }
        }

        private void OnClearAll(object sender, EventArgs eventArgs)
        {
            if (allItems.Count == 0) return;
            DialogResult result = MessageBox.Show(this,
                "确定删除全部 " + allItems.Count + " 条高亮吗？此操作无法撤销。",
                Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (result != DialogResult.Yes) return;
            try
            {
                string current = host.ReadHighlightData();
                host.ReplaceHighlightData(BuildUpdatedDocument(current, new object[0]));
                RefreshData();
            }
            catch (Exception exception)
            {
                ShowActionError("清空失败", exception);
            }
        }

        private void OnExport(object sender, EventArgs eventArgs)
        {
            try
            {
                string current = host.ReadHighlightData();
                if (string.IsNullOrEmpty(current)) current = BuildUpdatedDocument(null, new object[0]);
                using (SaveFileDialog dialog = new SaveFileDialog())
                {
                    dialog.Title = "导出 Codex 高亮数据";
                    dialog.Filter = "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*";
                    dialog.FileName = "codex-highlights-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json";
                    if (dialog.ShowDialog(this) != DialogResult.OK) return;
                    File.WriteAllText(dialog.FileName, current, new UTF8Encoding(false));
                    MessageBox.Show(this, "已导出到：\r\n" + dialog.FileName,
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception exception)
            {
                ShowActionError("导出失败", exception);
            }
        }

        private void OnImport(object sender, EventArgs eventArgs)
        {
            try
            {
                using (OpenFileDialog dialog = new OpenFileDialog())
                {
                    dialog.Title = "导入 Codex 高亮数据";
                    dialog.Filter = "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*";
                    if (dialog.ShowDialog(this) != DialogResult.OK) return;
                    FileInfo file = new FileInfo(dialog.FileName);
                    if (file.Length > 5 * 1024 * 1024)
                    {
                        throw new InvalidDataException("导入文件不能超过 5 MiB。");
                    }
                    string imported = File.ReadAllText(dialog.FileName, Encoding.UTF8);
                    object[] highlights = GetHighlights(imported, true);
                    DialogResult result = MessageBox.Show(this,
                        "导入将用文件中的 " + highlights.Length + " 条记录替换当前数据。继续吗？",
                        Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                        MessageBoxDefaultButton.Button2);
                    if (result != DialogResult.Yes) return;
                    host.ReplaceHighlightData(BuildUpdatedDocument(host.ReadHighlightData(), highlights));
                    RefreshData();
                }
            }
            catch (Exception exception)
            {
                ShowActionError("导入失败", exception);
            }
        }

        private void ShowActionError(string action, Exception exception)
        {
            Log.Write(action, exception);
            MessageBox.Show(this, action + "：" + exception.Message,
                Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private HashSet<string> SelectedIds()
        {
            HashSet<string> result = new HashSet<string>(StringComparer.Ordinal);
            foreach (DataGridViewRow row in grid.SelectedRows)
            {
                string id = Convert.ToString(row.Cells["Id"].Value);
                if (!string.IsNullOrEmpty(id)) result.Add(id);
            }
            return result;
        }

        private void OnCellFormatting(object sender, DataGridViewCellFormattingEventArgs eventArgs)
        {
            if (grid.Columns[eventArgs.ColumnIndex].Name != "Color") return;
            string label = Convert.ToString(eventArgs.Value);
            Color color = ColorForLabel(label);
            eventArgs.CellStyle.BackColor = color;
            eventArgs.CellStyle.ForeColor = Color.FromArgb(35, 35, 35);
            eventArgs.CellStyle.SelectionBackColor = color;
            eventArgs.CellStyle.SelectionForeColor = Color.FromArgb(20, 20, 20);
        }

        internal static object[] GetHighlights(string json, bool strict)
        {
            if (string.IsNullOrEmpty(json)) return new object[0];
            DataStamp stamp = HighlightDataStore.Stamp(json);
            if (!stamp.Valid) throw new InvalidDataException("高亮 JSON 格式无效。");
            Dictionary<string, object> root =
                Json.CreateSerializer().DeserializeObject(json) as Dictionary<string, object>;
            object[] source = root["highlights"] as object[];
            if (!strict) return source ?? new object[0];

            List<object> valid = new List<object>();
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (object raw in source ?? new object[0])
            {
                Dictionary<string, object> value = raw as Dictionary<string, object>;
                if (value == null) continue;
                string id = StringValue(value, "id");
                string exact = StringValue(value, "exact");
                if (id.Length == 0 || id.Length > 128 || ids.Contains(id)) continue;
                if (exact.Trim().Length == 0 || exact.Length > 5000) continue;
                ids.Add(id);
                valid.Add(value);
            }
            if (valid.Count != source.Length)
            {
                throw new InvalidDataException("导入文件包含重复或无效的高亮记录。");
            }
            return valid.ToArray();
        }

        internal static string BuildUpdatedDocument(string current, object[] highlights)
        {
            DataStamp stamp = HighlightDataStore.Stamp(current);
            Dictionary<string, object> root = new Dictionary<string, object>();
            root["version"] = 1;
            root["revision"] = stamp.Valid ? stamp.Revision + 1 : 1;
            root["updatedAt"] = UnixMilliseconds();
            root["highlights"] = highlights ?? new object[0];
            return Json.CreateSerializer().Serialize(root);
        }

        private static long UnixMilliseconds()
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            return (long)(DateTime.UtcNow - epoch).TotalMilliseconds;
        }

        private static string StringValue(Dictionary<string, object> value, string key)
        {
            return value.ContainsKey(key) && value[key] != null
                ? Convert.ToString(value[key])
                : string.Empty;
        }

        private static string CleanText(string value)
        {
            return (value ?? string.Empty)
                .Replace("\r", " ")
                .Replace("\n", " ")
                .Trim();
        }

        private static DateTime CreatedTime(Dictionary<string, object> value)
        {
            try
            {
                if (!value.ContainsKey("createdAt")) return DateTime.MinValue;
                double milliseconds = Convert.ToDouble(value["createdAt"]);
                DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                return epoch.AddMilliseconds(milliseconds).ToLocalTime();
            }
            catch
            {
                return DateTime.MinValue;
            }
        }

        private static string NormalizeColor(string value)
        {
            switch ((value ?? string.Empty).ToLowerInvariant())
            {
                case "green":
                case "cyan":
                case "pink":
                case "purple":
                    return value.ToLowerInvariant();
                default:
                    return "yellow";
            }
        }

        private static string ColorLabel(string value)
        {
            switch (NormalizeColor(value))
            {
                case "green": return "绿色";
                case "cyan": return "青色";
                case "pink": return "粉色";
                case "purple": return "紫色";
                default: return "黄色";
            }
        }

        private static Color ColorForLabel(string label)
        {
            switch (label)
            {
                case "绿色": return Color.FromArgb(190, 243, 157);
                case "青色": return Color.FromArgb(164, 234, 238);
                case "粉色": return Color.FromArgb(244, 177, 230);
                case "紫色": return Color.FromArgb(205, 177, 240);
                default: return Color.FromArgb(255, 242, 133);
            }
        }

        private sealed class HighlightListItem
        {
            internal string Id;
            internal string Color;
            internal string Quote;
            internal string Context;
            internal DateTime Created;
        }
    }
}
