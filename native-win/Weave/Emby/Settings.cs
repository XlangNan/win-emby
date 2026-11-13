using System.IO;
using System.Text.Json;

namespace Weave.Emby;

/// <summary>本机保存的登录信息：%APPDATA%\Weave\settings.json</summary>
public sealed class Settings
{
    public string Server { get; set; } = "";
    public string UserName { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Token { get; set; } = "";
    public string DeviceId { get; set; } = Guid.NewGuid().ToString("N");

    private static string PathOf => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Weave", "settings.json");

    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(PathOf)) ?? new Settings(); }
        catch { return new Settings(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(PathOf)!);
            File.WriteAllText(PathOf, JsonSerializer.Serialize(this));
        }
        catch { /* 保存失败不影响使用 */ }
    }
}
