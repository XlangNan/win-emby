"""织影同步服务：一个账号，电脑 / 手机各存一份设置（端到端加密，服务器只存密文）。
接口都是 JSON；数据放在 /data（SQLite）。"""
import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from functools import wraps

from flask import Flask, g, jsonify, request, send_from_directory

DATA = os.environ.get("DATA_DIR", "/data")
os.makedirs(DATA, exist_ok=True)
DB = os.path.join(DATA, "sync.db")
REGISTER_OPEN = os.environ.get("REGISTER_OPEN", "0") == "1"   # 默认：只有第一个账号能注册；设成 1 允许任何人注册
KEEP = int(os.environ.get("KEEP_VERSIONS", "20"))             # 每个平台保留多少个历史版本
TOKEN_DAYS = 180
PLATFORMS = ("desktop", "mobile")
MAX_BLOB = 4 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BLOB + 4096


def secret() -> bytes:
    p = os.path.join(DATA, "secret.key")
    if not os.path.exists(p):
        with open(p, "wb") as f:
            f.write(secrets.token_bytes(32))
    with open(p, "rb") as f:
        return f.read()


SECRET = secret()


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB, timeout=10)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_e):
    d = g.pop("db", None)
    if d is not None:
        d.close()


def init_db() -> None:
    c = sqlite3.connect(DB)
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS users(
          name TEXT PRIMARY KEY, salt TEXT NOT NULL, auth_hash TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS tokens(
          hash TEXT PRIMARY KEY, user TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, device TEXT);
        CREATE TABLE IF NOT EXISTS profiles(
          user TEXT NOT NULL, platform TEXT NOT NULL, version INTEGER NOT NULL, blob TEXT NOT NULL,
          device TEXT, updated INTEGER NOT NULL, PRIMARY KEY(user, platform, version));
        """
    )
    c.commit()
    c.close()


init_db()

# ───────── 登录限流（同一 IP + 用户名 5 分钟内最多 10 次失败） ─────────
_fails: dict = {}


def too_many(key: str) -> bool:
    now = time.time()
    lst = [t for t in _fails.get(key, []) if now - t < 300]
    _fails[key] = lst
    return len(lst) >= 10


def add_fail(key: str) -> None:
    _fails.setdefault(key, []).append(time.time())


def hash_auth(auth_key: str, salt: str) -> str:
    return hashlib.scrypt(auth_key.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32).hex()


def fake_salt(user: str) -> str:
    return hmac.new(SECRET, ("salt:" + user).encode(), hashlib.sha256).hexdigest()[:32]


def tok_hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def need_login(fn):
    @wraps(fn)
    def w(*a, **k):
        h = request.headers.get("Authorization", "")
        t = h[7:] if h.startswith("Bearer ") else ""
        if not t:
            return jsonify(error="未登录"), 401
        r = db().execute("SELECT user, expires FROM tokens WHERE hash=?", (tok_hash(t),)).fetchone()
        if not r or r["expires"] < time.time():
            return jsonify(error="登录已失效，请重新登录"), 401
        g.user = r["user"]
        g.tok = tok_hash(t)
        return fn(*a, **k)

    return w


@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp


@app.route("/api/<path:_p>", methods=["OPTIONS"])
def options(_p):
    return ("", 204)


@app.get("/api/ping")
def ping():
    n = db().execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    return jsonify(ok=True, app="weave-sync", users=n, register=REGISTER_OPEN or n == 0)


@app.get("/api/salt")
def salt():
    user = (request.args.get("user") or "").strip().lower()
    r = db().execute("SELECT salt FROM users WHERE name=?", (user,)).fetchone()
    return jsonify(salt=r["salt"] if r else fake_salt(user))


def new_token(user: str, device: str) -> str:
    t = secrets.token_urlsafe(32)
    now = int(time.time())
    db().execute("INSERT INTO tokens(hash,user,created,expires,device) VALUES(?,?,?,?,?)",
                 (tok_hash(t), user, now, now + TOKEN_DAYS * 86400, device))
    db().execute("DELETE FROM tokens WHERE expires<?", (now,))
    db().commit()
    return t


@app.post("/api/register")
def register():
    j = request.get_json(silent=True) or {}
    user = (j.get("user") or "").strip().lower()
    auth = j.get("authKey") or ""
    salt_hex = j.get("salt") or ""
    if not (2 <= len(user) <= 32) or len(auth) < 20 or len(salt_hex) != 32:
        return jsonify(error="用户名要 2 到 32 个字符"), 400
    n = db().execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    if n > 0 and not REGISTER_OPEN:
        return jsonify(error="这个同步服务不开放注册（服务器上设置 REGISTER_OPEN=1 才能多人注册）"), 403
    if db().execute("SELECT 1 FROM users WHERE name=?", (user,)).fetchone():
        return jsonify(error="这个用户名已经有人用了"), 409
    db().execute("INSERT INTO users(name,salt,auth_hash,created) VALUES(?,?,?,?)", (user, salt_hex, hash_auth(auth, salt_hex), int(time.time())))
    db().commit()
    return jsonify(token=new_token(user, j.get("device") or ""))


@app.post("/api/login")
def login():
    j = request.get_json(silent=True) or {}
    user = (j.get("user") or "").strip().lower()
    auth = j.get("authKey") or ""
    key = f"{request.remote_addr}:{user}"
    if too_many(key):
        return jsonify(error="尝试次数太多，5 分钟后再试"), 429
    r = db().execute("SELECT salt, auth_hash FROM users WHERE name=?", (user,)).fetchone()
    ok = bool(r) and hmac.compare_digest(hash_auth(auth, r["salt"]), r["auth_hash"])
    if not ok:
        add_fail(key)
        return jsonify(error="用户名或密码不对"), 401
    return jsonify(token=new_token(user, j.get("device") or ""))


@app.post("/api/logout")
@need_login
def logout():
    db().execute("DELETE FROM tokens WHERE hash=?", (g.tok,))
    db().commit()
    return jsonify(ok=True)


def plat(p: str):
    return p if p in PLATFORMS else None


def latest(user: str, p: str):
    return db().execute("SELECT version, updated, device FROM profiles WHERE user=? AND platform=? ORDER BY version DESC LIMIT 1", (user, p)).fetchone()


@app.get("/api/profile/<p>/meta")
@need_login
def meta(p):
    if not plat(p):
        return jsonify(error="平台只能是 desktop 或 mobile"), 400
    r = latest(g.user, p)
    return jsonify(version=r["version"] if r else 0, updated=r["updated"] if r else 0, device=(r["device"] if r else "") or "")


@app.get("/api/profile/<p>")
@need_login
def get_profile(p):
    if not plat(p):
        return jsonify(error="平台只能是 desktop 或 mobile"), 400
    v = request.args.get("version", type=int)
    q = "SELECT version, blob, updated, device FROM profiles WHERE user=? AND platform=? " + ("AND version=?" if v else "ORDER BY version DESC LIMIT 1")
    r = db().execute(q, (g.user, p, v) if v else (g.user, p)).fetchone()
    if not r:
        return jsonify(version=0, blob="", updated=0, device="")
    return jsonify(version=r["version"], blob=r["blob"], updated=r["updated"], device=r["device"] or "")


@app.put("/api/profile/<p>")
@need_login
def put_profile(p):
    if not plat(p):
        return jsonify(error="平台只能是 desktop 或 mobile"), 400
    j = request.get_json(silent=True) or {}
    blob = j.get("blob") or ""
    if not blob or len(blob) > MAX_BLOB:
        return jsonify(error="内容为空或太大"), 400
    cur = latest(g.user, p)
    cv = cur["version"] if cur else 0
    base = j.get("baseVersion")
    if base is not None and base != cv and not j.get("force"):
        return jsonify(error="云端有更新的版本", conflict=True, version=cv, updated=cur["updated"] if cur else 0), 409
    nv = cv + 1
    now = int(time.time())
    db().execute("INSERT INTO profiles(user,platform,version,blob,device,updated) VALUES(?,?,?,?,?,?)", (g.user, p, nv, blob, (j.get("device") or "")[:60], now))
    db().execute("DELETE FROM profiles WHERE user=? AND platform=? AND version<=?", (g.user, p, nv - KEEP))
    db().commit()
    return jsonify(version=nv, updated=now)


@app.get("/api/profile/<p>/history")
@need_login
def history(p):
    if not plat(p):
        return jsonify(error="平台只能是 desktop 或 mobile"), 400
    rows = db().execute("SELECT version, updated, device FROM profiles WHERE user=? AND platform=? ORDER BY version DESC", (g.user, p)).fetchall()
    return jsonify(items=[dict(version=r["version"], updated=r["updated"], device=r["device"] or "") for r in rows])


# ───────── 网页管理界面 ─────────
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


@app.get("/")
def index():
    r = send_from_directory(WEB, "index.html")
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/web/<path:f>")
def web_file(f):
    r = send_from_directory(WEB, f)
    r.headers["Cache-Control"] = "no-cache"
    return r


def is_admin(user: str) -> bool:
    r = db().execute("SELECT name FROM users ORDER BY created, rowid LIMIT 1").fetchone()
    return bool(r) and r["name"] == user


@app.get("/api/me")
@need_login
def me():
    now = int(time.time())
    rows = db().execute("SELECT hash, device, created, expires FROM tokens WHERE user=? AND expires>? ORDER BY created DESC", (g.user, now)).fetchall()
    return jsonify(user=g.user, admin=is_admin(g.user),
                   sessions=[dict(id=r["hash"][:16], device=r["device"] or "", created=r["created"], expires=r["expires"], current=r["hash"] == g.tok) for r in rows])


@app.delete("/api/session/<sid>")
@need_login
def del_session(sid):
    db().execute("DELETE FROM tokens WHERE user=? AND substr(hash,1,16)=?", (g.user, sid))
    db().commit()
    return jsonify(ok=True)


@app.delete("/api/profile/<p>/<int:v>")
@need_login
def del_version(p, v):
    if not plat(p):
        return jsonify(error="平台只能是 desktop 或 mobile"), 400
    cur = latest(g.user, p)
    if cur and cur["version"] == v:
        return jsonify(error="最新版本不能删（要清空请先上传一份新的）"), 400
    db().execute("DELETE FROM profiles WHERE user=? AND platform=? AND version=?", (g.user, p, v))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/admin/users")
@need_login
def admin_users():
    if not is_admin(g.user):
        return jsonify(error="只有第一个账号（管理员）能看"), 403
    rows = db().execute("SELECT name, created FROM users ORDER BY created, rowid").fetchall()
    out = []
    for r in rows:
        d = {}
        for p in PLATFORMS:
            x = latest(r["name"], p)
            d[p] = dict(version=x["version"], updated=x["updated"]) if x else None
        out.append(dict(name=r["name"], created=r["created"], **d))
    return jsonify(items=out)


@app.delete("/api/admin/users/<name>")
@need_login
def admin_del_user(name):
    if not is_admin(g.user):
        return jsonify(error="只有第一个账号（管理员）能删"), 403
    if name == g.user:
        return jsonify(error="不能删自己"), 400
    for t in ("users", "tokens", "profiles"):
        db().execute(f"DELETE FROM {t} WHERE " + ("name" if t == "users" else "user") + "=?", (name,))
    db().commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8765")))
