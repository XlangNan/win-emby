using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Weave.Emby;

public sealed class UserData
{
    public bool IsFavorite { get; set; }
    public bool Played { get; set; }
    public long? PlaybackPositionTicks { get; set; }
    public double? PlayedPercentage { get; set; }
    public int? UnplayedItemCount { get; set; }
}

public sealed class Person
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Role { get; set; }
    public string? Type { get; set; }
    public string? PrimaryImageTag { get; set; }
}

public sealed class Item
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string? CollectionType { get; set; }
    public int? ProductionYear { get; set; }
    public long? RunTimeTicks { get; set; }
    public string? Overview { get; set; }
    public double? CommunityRating { get; set; }
    public string? OfficialRating { get; set; }
    public int? IndexNumber { get; set; }
    public int? ParentIndexNumber { get; set; }
    public string? SeriesName { get; set; }
    public string? SeriesId { get; set; }
    public List<string>? Genres { get; set; }
    public List<Person>? People { get; set; }
    public Dictionary<string, string>? ImageTags { get; set; }
    public List<string>? BackdropImageTags { get; set; }
    public UserData? UserData { get; set; }

    public string Sub => Type == "Episode"
        ? $"{SeriesName}  S{ParentIndexNumber}E{IndexNumber}".Trim()
        : ProductionYear?.ToString() ?? "";
    public bool IsPlayable => Type is "Movie" or "Episode" or "Video" or "MusicVideo";
    public bool NeedsLibraryPage => Type is "Season" or "BoxSet" or "Folder" or "CollectionFolder" or "UserView" or "Playlist";
    public double Minutes => (RunTimeTicks ?? 0) / 600000000.0;
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

    public string ImageUrl(string id, string type, int width, string? tag)
    {
        if (string.IsNullOrEmpty(tag)) return "";
        return $"{S.Server}/emby/Items/{id}/Images/{type}?maxWidth={width}&tag={tag}&api_key={S.Token}";
    }

    public string ImageUrl(Item it, string type = "Primary", int width = 300)
    {
        string? tag = null;
        if (type == "Backdrop") tag = it.BackdropImageTags?.FirstOrDefault();
        else it.ImageTags?.TryGetValue(type, out tag);
        if (type == "Backdrop" && tag != null) return $"{S.Server}/emby/Items/{it.Id}/Images/Backdrop/0?maxWidth={width}&tag={tag}&api_key={S.Token}";
        return ImageUrl(it.Id, type, width, tag);
    }

    public string StreamUrl(string id) => $"{S.Server}/emby/Videos/{id}/stream?Static=true&api_key={S.Token}";

    private const string F = "ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,UserData,SeriesName,ParentIndexNumber,IndexNumber";

    public async Task<List<Item>> ViewsAsync() =>
        (await GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Views")).Items;

    public async Task<List<Item>> ResumeAsync() =>
        (await GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Items/Resume?Limit=24&MediaTypes=Video&Fields={F}")).Items;

    public Task<List<Item>> LatestAsync(string parentId, int limit = 18) =>
        GetAsync<List<Item>>($"/emby/Users/{S.UserId}/Items/Latest?ParentId={parentId}&Limit={limit}&Fields={F}");

    public Task<ItemsResult> LibraryAsync(string parentId, int start = 0, int limit = 100, string sort = "SortName", bool desc = false) =>
        GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Items?ParentId={parentId}&SortBy={sort}&SortOrder={(desc ? "Descending" : "Ascending")}&StartIndex={start}&Limit={limit}&Fields={F}");

    public Task<Item> ItemAsync(string id) =>
        GetAsync<Item>($"/emby/Users/{S.UserId}/Items/{id}?Fields=Overview,Genres,People,{F},BackdropImageTags");

    public async Task<List<Item>> SeasonsAsync(string seriesId) =>
        (await GetAsync<ItemsResult>($"/emby/Shows/{seriesId}/Seasons?UserId={S.UserId}&Fields={F}")).Items;

    public async Task<List<Item>> EpisodesAsync(string seriesId, string seasonId) =>
        (await GetAsync<ItemsResult>($"/emby/Shows/{seriesId}/Episodes?UserId={S.UserId}&SeasonId={seasonId}&Fields=Overview,{F}")).Items;

    public async Task<List<Item>> SimilarAsync(string id) =>
        (await GetAsync<ItemsResult>($"/emby/Items/{id}/Similar?UserId={S.UserId}&Limit=14&Fields={F}")).Items;

    public async Task<List<Item>> SearchAsync(string term) =>
        (await GetAsync<ItemsResult>($"/emby/Users/{S.UserId}/Items?SearchTerm={Uri.EscapeDataString(term)}&Recursive=true&IncludeItemTypes=Movie,Series,BoxSet&Limit=80&Fields={F}")).Items;

    private async Task SendAsync(HttpMethod m, string path)
    {
        using var res = await _http.SendAsync(Req(m, path));
        if (!res.IsSuccessStatusCode) throw new Exception($"服务器返回 {(int)res.StatusCode}");
    }
    public Task SetFavoriteAsync(string id, bool on) => SendAsync(on ? HttpMethod.Post : HttpMethod.Delete, $"/emby/Users/{S.UserId}/FavoriteItems/{id}");
    public Task SetPlayedAsync(string id, bool on) => SendAsync(on ? HttpMethod.Post : HttpMethod.Delete, $"/emby/Users/{S.UserId}/PlayedItems/{id}");
}
