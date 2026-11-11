# 织影 · 一起看 服务

多人同步看片的中转服务。零依赖（只要 Node 18+），不需要 npm install。

## 群晖 Docker 部署（复制粘贴）

1. 把整个 `party-server` 文件夹放到群晖的 `/volume1/docker/weave-party/`
2. 打开 `docker-compose.yml`，改两处：
   - `EMBY_URL`：群晖上能访问到 Emby 的地址，例如 `http://192.168.1.2:8096`
   - `ADMIN_PASSWORD`：管理网页密码
3. SSH 登录群晖，执行：

```bash
cd /volume1/docker/weave-party
sudo docker compose up -d --build
```

4. 浏览器打开 `http://群晖IP:8787/admin`，输入管理密码，能看到空的房间列表就成功了。
5. App：设置 → 一起看 → 填 `http://群晖IP:8787` → 保存 → 测试连接。

> 基础镜像默认走 `docker.m.daocloud.io`。如果拉取失败，把 `Dockerfile` 第 3 行的 `BASE` 换成别的国内镜像站即可。

## 不用 Docker（直接跑）

```bash
cd party-server
EMBY_URL=http://192.168.1.2:8096 ADMIN_PASSWORD=你的密码 node server.js
```

## 外网使用
朋友在外网加入，需要能访问到这个服务：把 8787 端口映射出去（或用反向代理 / 内网穿透），App 里填外网地址。

## 说明
- 登录验证：App 把 Emby 令牌发给本服务，本服务用 `EMBY_URL` 去 Emby 验证；令牌只缓存 5 分钟，不落盘。
- 房间只存在内存里，服务重启后清空。
- 管理网页：查看所有房间 / 成员 / 操作记录，可关闭房间、踢人、切换公开或私密。每 2 秒自动刷新。
