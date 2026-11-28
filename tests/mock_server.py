#!/usr/bin/env python3
"""mock_server.py — 本地测试服务器：虚构数据源(:8025) + 模拟 GitHub Contents API(:8026)

- 只使用 tests/mock_data.py 生成的虚构数据，绝不包含真实礼物内容
- 模拟 raw.githubusercontent.com 的 CORS 行为
- 模拟 GitHub API 的 sha 冲突（可触发一次 409 以测试重试合并）
"""
import base64
import json
import os
import re
import sys
import tempfile
from flask import Flask, request, make_response, jsonify

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else str(os.path.join(tempfile.gettempdir(), 'mockdata'))
GH_DIR = sys.argv[2] if len(sys.argv) > 2 else str(os.path.join(tempfile.gettempdir(), 'mockgh'))
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(GH_DIR, exist_ok=True)

app = Flask(__name__)
CONFLICT_TRIGGER = os.path.join(GH_DIR, 'conflict_sannan_gifts_once')


@app.after_request
def cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-GitHub-Api-Version'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS'
    return resp


# ── 虚构数据源（模拟 raw.githubusercontent.com）─────────────────────────

@app.route('/data/<path:name>')
def data_file(name):
    safe = os.path.normpath(name).strip('/')
    if '..' in safe.split('/'):
        return make_response('bad path', 400)
    published = os.path.join(GH_DIR, safe.replace('/', os.sep))
    path = published if os.path.exists(published) else os.path.join(DATA_DIR, safe.replace('/', os.sep))
    if not os.path.exists(path):
        return make_response('not found', 404)
    with open(path, 'rb') as f:
        resp = make_response(f.read())
        resp.headers['Content-Type'] = 'application/json; charset=utf-8'
        resp.headers['Cache-Control'] = 'max-age=300'
        return resp


# ── 模拟 GitHub Contents API ───────────────────────────────────────────

def _repo_path(path):
    safe = os.path.normpath(path).strip('/')
    if '..' in safe.split('/'):
        return None
    return os.path.join(GH_DIR, safe.replace('/', os.sep))


@app.route('/repos/<owner>/<repo>/contents/<path:path>', methods=['GET', 'PUT', 'OPTIONS'])
def contents(owner, repo, path):
    if request.method == 'OPTIONS':
        return make_response('', 204)
    dest = _repo_path(path)
    if dest is None:
        return jsonify(message='bad path'), 400

    if request.method == 'GET':
        ref = request.args.get('ref')
        if not os.path.exists(dest):
            fallback = os.path.join(DATA_DIR, os.path.normpath(path).strip('/').replace('/', os.sep))
            if os.path.exists(fallback):
                with open(fallback, 'rb') as f:
                    content = f.read()
                return jsonify({
                    'name': os.path.basename(path), 'path': path, 'sha': _sha(content),
                    'content': base64.b64encode(content).decode(), 'encoding': 'base64',
                })
            return jsonify(message='Not Found'), 404
        with open(dest, 'rb') as f:
            content = f.read()
        sha = base64.b64encode(content).decode()[:0] or _sha(content)
        return jsonify({
            'name': os.path.basename(dest),
            'path': path,
            'sha': _sha(content),
            'content': base64.b64encode(content).decode(),
            'encoding': 'base64',
        })

    # PUT
    body = request.get_json(force=True)
    # Token 校验（模拟 401）
    if request.headers.get('Authorization') != 'Bearer test-token':
        return jsonify(message='Bad credentials'), 401
    content = base64.b64decode(body['content'])
    existing = None
    if os.path.exists(dest):
        with open(dest, 'rb') as f:
            existing = f.read()

    # 模拟并发冲突：对 sannan_gifts.json 的第一次 PUT 返回 409
    if path == 'sannan_gifts.json' and os.path.exists(CONFLICT_TRIGGER):
        os.unlink(CONFLICT_TRIGGER)
        return jsonify(message='conflict'), 409

    if existing is not None and body.get('sha') != _sha(existing):
        return jsonify(message='sha mismatch'), 409

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(content)
    return jsonify({'content': base64.b64encode(content).decode(), 'sha': _sha(content)})


def _sha(content):
    import hashlib
    return hashlib.sha1(b'blob %d\0' % len(content) + content).hexdigest()


# 记录访问日志（不含任何礼物内容，只有路径与查询）
LOG = os.path.join(GH_DIR, 'access_log.txt')

@app.before_request
def log_req():
    with open(LOG, 'a') as f:
        f.write(f'{request.method} {request.path}?{request.query_string.decode()[:80]}\n')


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8025 + (1 if os.environ.get('MOCK_GH') else 0), threaded=True)
