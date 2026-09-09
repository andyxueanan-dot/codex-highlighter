using System;
using System.IO;
using System.Text;

namespace CodexHighlighter
{
    internal static class RetentionTests
    {
        internal static void Run()
        {
            string root = Path.Combine(Path.GetTempPath(), "HighlighterRetention-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                var store = new HighlightDataStore(root);
                var json = new StringBuilder("{\"version\":1,\"id\":\"auto-prune-123-abc\",\"highlights\":[");
                for (int i = 0; i < 1000; i++)
                {
                    if (i > 0) json.Append(',');
                    json.Append("{\"id\":\"").Append(i).Append("\",\"exact\":\"test\"}");
                }
                json.Append("]}");
                string value = json.ToString();
                string id = store.SaveRetentionBackup(value);
                if (File.ReadAllText(Path.Combine(root, id + ".json")) != value) throw new Exception("Backup content changed");
                if (store.SaveRetentionBackup(value) != id || Directory.GetFiles(root).Length != 1)
                    throw new Exception("Backup retry was not idempotent");
                foreach (string invalid in new[] { value.Replace("123-abc", "../other"),
                    value.Replace("test", "different"), "{\"highlights\":[]}" })
                {
                    bool rejected = false;
                    try { store.SaveRetentionBackup(invalid); }
                    catch (InvalidDataException) { rejected = true; }
                    if (!rejected) throw new Exception("Invalid/conflicting backup accepted");
                }
                if (File.ReadAllText(Path.Combine(root, id + ".json")) != value)
                    throw new Exception("Existing backup overwritten");
                Console.WriteLine("PASS retention disk backup, retry, validation, conflict protection");
            }
            finally
            {
                // Only this test's newly created directory and known direct files.
                foreach (string file in Directory.GetFiles(root)) File.Delete(file);
                Directory.Delete(root);
            }
        }
    }
}
