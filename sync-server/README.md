# 织影同步服务

自己搭的小服务：一个账号，**电脑和手机各存一份设置**。设置、Emby 账号、hosts、各项开关都会加密后存到这里；换设备新装织影后，登录同步账号就能还原。

- 加密在织影本机完成（同步密码 → 加密钥匙），服务器只保存密文，看不到你的账号密码和密钥。
- **同步密码忘了就无法还原云端数据**，请记好。
- 每个平台（电脑 / 手机）默认保留最近 20 个历史版本，可以在织影里回退。

## 一、群晖 Docker 部署（推荐）

1. 在群晖里新建文件夹 `docker/weave-sync`，把本目录（`sync-server`）里的 4 个文件放进去：`app.py`、`Dockerfile`、`docker-compose.yml`、`requirements.txt`。
2. 打开 **Container Manager → 项目 → 新增**：
   - 项目名称：`weave-sync`
   - 路径：选 `docker/weave-sync`
   - 来源：使用现有的 `docker-compose.yml`
3. 点下一步直到完成。第一次会自己构建镜像（基础镜像走你 Docker 自带的镜像加速、pip 走清华源）。
4. 构建完成后访问 `http://群晖IP:8765/api/ping`，看到 `{"app":"weave-sync","ok":true,...}` 就成功了。

只用命令行的话：

```bash
cd /volume1/docker/weave-sync
sudo docker compose up -d --build
```

## 二、普通 Linux 服务器

```bash
mkdir -p /opt/weave-sync && cd /opt/weave-sync
# 把 app.py Dockerfile docker-compose.yml requirements.txt 放进来
docker compose up -d --build
```

放在公网上请务必套 HTTPS（Nginx / Caddy 反代到 8765 端口）。Caddy 示例（把域名换成自己的）：

```
sync.example.com {
    reverse_proxy 127.0.0.1:8765
}
```

## 三、在织影里使用

1. **设置 → 同步与备份**，填同步服务地址（如 `192.168.1.10:8765` 或 `https://sync.example.com`）、用户名、同步密码，点「注册新账号」。
   - 默认只有**第一个账号**能注册；想让别人也注册，把 `docker-compose.yml` 里的 `REGISTER_OPEN` 改成 `1` 再重启。
2. 注册成功后，这台设备的设置会立刻上传。电脑、手机各自上传各自的。
3. 换设备 / 新装：织影登录页底部点「已经有同步账号？一键还原设置」，填同步服务地址和账号，就会取回**这台设备类型**（电脑或手机）的全部设置并自动进入。
4. 自动同步：改了设置会自动上传；打开应用时如果云端更新就自动取回。两边都改过会提示你选「用云端」还是「用本机」。

## 备份和升级

- 所有数据都在 `data/` 文件夹（`sync.db` 和 `secret.key`），备份这个文件夹即可。
- 升级：替换 `app.py`，再 `docker compose up -d --build`。

## 接口（给想自己对接的人）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康检查 |
| GET | `/api/salt?user=` | 取用户的盐 |
| POST | `/api/register` | 注册 |
| POST | `/api/login` | 登录，返回 token |
| GET/PUT | `/api/profile/{desktop\|mobile}` | 取 / 存加密后的设置 |
| GET | `/api/profile/{p}/meta` | 当前版本号 |
| GET | `/api/profile/{p}/history` | 历史版本 |
