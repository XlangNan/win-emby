using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Weave.Emby;

public sealed class Item
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string? CollectionType { get; set; }
    public int? ProductionYear { get; set; }
    public long? RunTimeTicks { get; set; }
    public Dictionary<string, string>? ImageTags { get; set; }
    // 界面绑定用
    [JsonIgnore] public string Poster { get; set; } = "";
    [JsonIgnore] public string Sub => ProductionYear?.ToString() ?? "";
}

public sealed class ItemsResult
{
    public List<Item> Items { get; set; } = new();
    public int TotalRecordCount { get; set; }
}

public sealed class EmbyClient
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public Settings S { get; }

    public EmbyClient(Settings s) { S = s; }

    public bool LoggedIn => !string.IsNullOrEmpty(S.Token) && !string.IsNullOrEmpty(S.Server);

    public static string NormalizeServer(string input)
    {
        var s = input.Trim().TrimEnd('/');
        if (s.Length == 0) return "";
        if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            s = "http://" + s;
        // 没写端口的 http 地址默认 Emby 的 8096
        if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !System.Text.RegularExpressions.Regex.IsMatch(s, @"^http://[^/?#]*:\d+(?:[/?#]|$)"))
        {
            var i = s.IndexOfAny(new[] { '/', '?', '#' }, 7);
            s = i < 0 ? s + ":8096" : s.Insert(i, ":8096");
        }
        return s;
    }

    private string AuthHeader() =>
        $"MediaBrowser Client=\"Weave\", Device=\"Windows\", DeviceId=\"{S.DeviceId}\", Version=\"0.1.0\"" +
        (string.IsNullOrEmpty(S.Token) ? "" : $", Token=\"{S.Token}\"");

    private HttpRequestMessage Req(HttpMethod m, string path)
    {
        var r = new HttpRequestMessage(m, S.Server + path);
        r.Headers.TryAddWithoutValidation("X-Emby-Authorization", AuthHeader());
        if (!string.IsNullOrEmpty(S.Token)) r.Headers.TryAddWithoutValidation("X-Emby-Token", S.Token);
        r.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return r;
    }

    public async Task LoginAsync(string server, string user, string pass)
    {
        S.Server = NormalizeServer(server);
        S.Token = "";
        var r = Req(HttpMethod.Post, "/emby/Users/AuthenticateByName");
        r.Content = new StringContent(JsonSerializer.Serialize(new { Username = user, Pw = pass }), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(r);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new Exception("用户名或密码不对");
        if (!res.IsSuccessStatusCode) throw new Exception($"服务器返回 {(int)res.StatusCode}");
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        S.Token = doc.RootElement.GetProperty("AccessToken").GetString() ?? "";
        S.UserId = doc.RootElement.GetProperty("User").GetProperty("Id").GetString() ?? "";
        S.UserName = user;
        S.Save();
    }

    public void Logout() { S.Token = ""; S.Save(); }

    private async Task<T> GetAsync<T>(string path)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Get, path));
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) { Logout(); throw new Exception("登录已过期，请重新登录"); }
        if (!res.IsSuccessStatusCode) throw new Exception($"服务器返回 {(int)res.StatusCode}");
        var t = await res.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(t, Json) ?? throw new Exception("返回内容为空");
    }

    public string ImageUrl(Item it, int width = 300)
    {
        if (it.ImageTags != null && it.ImageTags.TryGetValue("Primary", out var tag))
            return $"{S.Server}/emby/Items/{it.Id}/Images/Primary?maxWidth={width}&tag={tag}&api_key={S.Token}";
        return "";
    }

    private List<Item> WithPosters(ItemsResult r, int width = 300)
    {
        foreach (var i in r.Items) i.Poster = ImageUrl(i, width);
        return r.Items;
    }

    /// <summary>媒体库（电影 / 剧集 / 音乐……）</summary>
    public async Task<List<Item>> ViewsAsync()
    {
        var r = await GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Views");
        return WithPosters(r);
    }

    /// <summary>继续观看</summary>
    public async Task<List<Item>> ResumeAsync() =>
        WithPosters(await GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Items/Resume?Limit=24&MediaTypes=Video&Fields=ProductionYear"));

    /// <summary>某个媒体库里的内容</summary>
    public async Task<ItemsResult> LibraryAsync(string parentId, int start = 0, int limit = 120)
    {
        var r = await GetAsync<ItemsResult>(
            $"/emby/Users/{S.UserId}/Items?ParentId={parentId}&SortBy=SortName&SortOrder=Ascending&StartIndex={start}&Limit={limit}&Fields=ProductionYear");
        WithPosters(r);
        return r;
    }
}
