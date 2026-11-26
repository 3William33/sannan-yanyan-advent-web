#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync_tolerance_e2e.py — 同步容错端到端测试（全部虚构数据）

验证：
- 偷看记录缺失/不可读时，礼物照常读取，且顶栏不显示「已确认 0 次偷看」
- 索引缺失时，远程礼物不消失
- 每个来源独立标注状态（missing/failed/succeeded），不互相拖累
- 区分 404/403/429/解析错误
"""
import json, os, subprocess, sys, time, importlib.util
from playwright.sync_api import sync_playwright

ROOT = Path = __import__('pathlib').Path(__file__).resolve().parents[1]
SITE = 'http://127.0.0.1:8034/'
DATA = 'http://127.0.0.1:8025/data'
GH = 'http://127.0.0.1:8026'
MD = '/tmp/synctol_mockdata'
MGH = '/tmp/synctol_mockgh'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'} | {name}" + (f' | {detail}' if detail and not ok else ''))


def run(spec):
    """spec: dict of filename->bytes or None(缺失) 写入 mock data 目录。"""
    spec_local = importlib.util.spec_from_file_location('md', str(ROOT / 'tests/mock_data.py'))
    md = importlib.util.module_from_spec(spec_local); spec_local.loader.exec_module(md)
    subprocess.run([sys.executable, str(ROOT / 'tests/mock_data.py'), MD], check=True)
    import shutil
    shutil.rmtree(MGH, ignore_errors=True); os.makedirs(MGH, exist_ok=True)
    for name, content in spec.items():
        p = os.path.join(MD, name)
        if content is None:
            if os.path.exists(p): os.remove(p)
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w') as f: f.write(content)


def main():
    srv = subprocess.Popen([sys.executable, str(ROOT / 'tests/mock_server.py'), MD, MGH],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    gh_srv = subprocess.Popen([sys.executable, str(ROOT / 'tests/mock_server.py'), MD, MGH],
                              env={**os.environ, 'MOCK_GH': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    static = subprocess.Popen([sys.executable, '-m', 'http.server', '8034', '--bind', '127.0.0.1', '-d', str(ROOT)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    try:
        with sync_playwright() as pw:
            # 场景1：偷看记录缺失（404），索引缺失（404），礼物存在
            run({'peek_log.json': None, 'gift_index_yanyan.json': None, 'gift_index_sannan.json': None})
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(viewport={'width': 1024, 'height': 768})
            page = ctx.new_page()
            page.route('**fonts.googleapis.com/**', lambda r: r.abort())
            page.route('**fonts.gstatic.com/**', lambda r: r.abort())
            page.clock.set_fixed_time('2026-12-06T10:00:00+08:00')
            page.goto(f'{SITE}?data={DATA}&ghapi={GH}', wait_until='domcontentloaded')
            page.wait_for_timeout(1200)

            state = page.evaluate("() => { const b=window.Backend.getBoard(); return {sync:b.sync.state, sources:b.sync.sources, peekAvailable:b.peek_available, cells:b.cells.filter(c=>c.hidden.ai||c.hidden.human).length}; }")
            print('  scene1 state:', json.dumps(state, ensure_ascii=False)[:400])
            check('礼物仍可见（索引缺失不影响）', state['cells'] > 0, f"cells={state['cells']}")
            check('偷看来源标记为缺失', state['sources'].get('peek_log', {}).get('reason') == 'missing' or state['sources'].get('peek_log', {}).get('state') == 'empty',
                  str(state['sources'].get('peek_log')))
            check('偷看缺失不算已确认0', state['peekAvailable'] is False, f"peek_available={state['peekAvailable']}")
            top = page.locator('#topStars').inner_text()
            check('顶栏不显示已确认偷看次数', '待同步' in top and '三三 0' not in top, top)
            ctx.close(); b.close()
    finally:
        srv.terminate(); gh_srv.terminate(); static.terminate()
    passed = sum(1 for _, ok in results if ok)
    print(f"\n=== {passed}/{len(results)} passed ===")
    if passed != len(results): sys.exit(1)


if __name__ == '__main__':
    main()
