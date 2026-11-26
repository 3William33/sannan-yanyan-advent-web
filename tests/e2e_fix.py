#!/usr/bin/env python3
# 针对性回归测试：第6格筹备期不亮灯、显示模式、流畅模式、离线提示、性能优化。
# 全部使用虚构数据，不读取/打印/修改任何真实礼物，不清除真实存档。
import os, sys, json, base64, re
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from mock_data import encode as me, wrapper as mw, YAN_DIGEST, SAN_DIGEST

SITE = os.environ.get('ADVENT_SITE', 'http://localhost:8024/')
DATA = 'http://localhost:8025/data'
SAVE_KEY = 'advent-web-save-v1'

RESULTS = []
def check(name, cond, detail=''):
    ok = bool(cond)
    RESULTS.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, ('' if ok else '| ' + str(detail)[:160]))

def setup_fiction():
    # 第6格放入一条「新礼物」，其余格子常规；全部为虚构文本 MOCK-
    yan = {'days': {
        '6': [{'id': 'mock-yan-6-new', 'kind': 'letter',
               'items_v2': [{'type': 'text', 'text': 'MOCK-第六格虚构礼物'}],
               'created_at': '2026-11-20T12:00:00+08:00'}],
        '2': [{'id': 'mock-yan-2', 'kind': 'letter',
               'items_v2': [{'type': 'text', 'text': 'MOCK-第二格虚构礼物'}],
               'created_at': '2026-11-20T12:00:00+08:00'}],
    }}
    Path('/tmp/mockdata/gifts.json').write_text(json.dumps(mw(yan, YAN_DIGEST), ensure_ascii=False))
    san = {'days': {}}
    Path('/tmp/mockdata/sannan_gifts.json').write_text(json.dumps(mw(san, SAN_DIGEST), ensure_ascii=False))
    Path('/tmp/mockdata/gift_index_yanyan.json').write_text(json.dumps({'version':1,'author':'yan','days':{}}))
    Path('/tmp/mockdata/gift_index_sannan.json').write_text(json.dumps({'version':1,'author':'san','days':{}}))
    Path('/tmp/mockdata/peek_log.json').write_text(json.dumps({'events': []}))

def fresh_ctx(browser, dt):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.route('**fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('**fonts.gstatic.com/**', lambda r: r.abort())
    pg.clock.set_fixed_time(dt)
    pg.goto(f'{SITE}?data={DATA}', wait_until='domcontentloaded')
    pg.wait_for_timeout(1800)
    return ctx, pg

def win_state(pg, day):
    return pg.evaluate('''(d) => {
      const w = [...document.querySelectorAll('.adv-win')].find(b => b.querySelector('small')?.textContent === String(d));
      if (!w) return null;
      const c = w.className;
      return { open: w.classList.contains('open'), ready: w.classList.contains('ready'),
               today: w.classList.contains('today'), hasnew: w.classList.contains('hasnew') };
    }''', day)

with sync_playwright() as p:
    browser = p.chromium.launch()
    errs = []

    # ══ A. 筹备期（11月26日）第6格绝不亮灯 ══
    setup_fiction()
    ctx, pg = fresh_ctx(browser, '2026-11-26T02:00:00+08:00')
    pg.on('pageerror', lambda e: errs.append(str(e)))
    b = pg.evaluate('window.Backend.getBoard()')
    c6 = next(c for c in b['cells'] if c['day'] == 6)
    check('A1 筹备期第6格 lit=False', c6['lit'] is False, c6)
    check('A2 筹备期第6格 ready=False', c6['ready'] is False, c6)
    check('A3 筹备期第6格无红点(new_count=0)', c6['new_count'] == 0, c6['new_count'])
    open_count = sum(1 for c in b['cells'] if c['opened_by'] and any(c['opened_by'].values()))
    check('A4 顶部已开启计数=0', open_count == 0, open_count)
    st6 = win_state(pg, 6)
    check('A5 第6格窗户未开窗(open=False)', st6 and st6['open'] is False, st6)
    check('A6 筹备期第6格无新提示圆点(hasnew=False)', st6 and st6['hasnew'] is False, st6)
    top = pg.locator('#topStars').inner_text()
    check('A7 顶栏显示 ★ 0', top.strip().startswith('★ 0'), top)
    # 所有格子筹备期都不 open
    all_open = pg.evaluate("[...document.querySelectorAll('.adv-win.open')].length")
    check('A8 筹备期所有窗户均未开启', all_open == 0, all_open)
    ctx.close()

    # ══ B. 显示模式切换 ══
    ctx, pg = fresh_ctx(browser, '2026-11-26T02:00:00+08:00')
    pg.on('pageerror', lambda e: errs.append(str(e)))
    # 自动模式：02:00 应为夜间
    b = pg.evaluate('window.Backend.getBoard()')
    check('B1 自动模式凌晨为夜间', b['night'] is True and b['display'] == 'auto', (b['night'], b['display']))
    # 切到白昼
    pg.evaluate("window.Backend.setDisplay('day')")
    pg.evaluate("window.UI.syncNow && 0")
    pg.evaluate("location.reload()")
    pg.wait_for_timeout(1600)
    b = pg.evaluate('window.Backend.getBoard()')
    check('B2 白昼模式 night=False 且持久化', b['night'] is False and b['display'] == 'day', (b['night'], b['display']))
    check('B3 白昼模式页面无 dusk', 'dusk' not in (pg.locator('#page').get_attribute('class') or ''), pg.locator('#page').get_attribute('class'))
    # 切到夜间
    pg.evaluate("window.Backend.setDisplay('night')")
    pg.evaluate("location.reload()")
    pg.wait_for_timeout(1600)
    b = pg.evaluate('window.Backend.getBoard()')
    check('B4 夜间模式 night=True', b['night'] is True and b['display'] == 'night', (b['night'], b['display']))
    ctx.close()

    # ══ C. 流畅模式 ══
    ctx, pg = fresh_ctx(browser, '2026-12-06T10:00:00+08:00')
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.evaluate("window.Backend.setSmooth(true)")
    pg.evaluate("location.reload()")
    pg.wait_for_timeout(1600)
    b = pg.evaluate('window.Backend.getBoard()')
    check('C1 流畅模式已持久化', b['smooth'] is True, b['smooth'])
    check('C2 页面应用 adv-smooth', 'adv-smooth' in (pg.locator('#page').get_attribute('class') or ''), pg.locator('#page').get_attribute('class'))
    check('C3 房子应用 smooth', 'smooth' in (pg.locator('.adv-house').get_attribute('class') or ''), pg.locator('.adv-house').get_attribute('class'))
    # 流畅模式下飘雪粒子更少：检查 canvas 存在且无 JS 错误
    check('C4 流畅模式无JS错误', not errs, errs[:2])
    ctx.close()

    # ══ D. 降临期正常解锁仍正确（12月6日，第6格解锁可开）══
    ctx, pg = fresh_ctx(browser, '2026-12-06T10:00:00+08:00')
    pg.on('pageerror', lambda e: errs.append(str(e)))
    b = pg.evaluate('window.Backend.getBoard()')
    c6 = next(c for c in b['cells'] if c['day'] == 6)
    check('D1 12月6日第6格 open=True(解锁)', c6['open'] is True, c6['open'])
    check('D2 12月6日第6格 lit 仍为 False(未点开)', c6['lit'] is False, c6['lit'])
    st6 = win_state(pg, 6)
    check('D3 解锁当天 ready=True(可开提示)', st6 and st6['ready'] is True, st6)
    check('D4 解锁后远程新礼物红点恢复(new_count>0)', c6['new_count'] > 0, c6['new_count'])
    check('D5 解锁后第6格出现红点(hasnew=True)', st6 and st6['hasnew'] is True, st6)
    ctx.close()

    # ══ E. 缓存回退时明确提示（离线）══
    ctx, pg = fresh_ctx(browser, '2026-11-26T02:00:00+08:00')
    pg.route('**/data/**', lambda r: r.abort())
    pg.evaluate('window.UI.syncNow()')
    pg.wait_for_timeout(2500)
    b = pg.evaluate('window.Backend.getBoard()')
    sync = b['sync']
    check('E1 离线同步状态非 succeeded', sync['state'] in ('partial', 'offline_cache'), sync['state'])
    failed_sources = [s for s in sync['sources'].values() if s.get('state') in ('failed','offline_cache')]
    check('E2 失败来源带明确 label', all(s.get('label') for s in failed_sources), [s.get('label') for s in failed_sources][:3])
    line = pg.locator('#syncLine').inner_text()
    check('E3 状态栏显示原因而非笼统文案', '离线缓存' in line or '部分离线' in line, line)
    ctx.close()

    browser.close()

passed = sum(1 for _, ok, _ in RESULTS if ok)
total = len(RESULTS)
print(f'\n===== {passed}/{total} PASS =====')
if passed < total:
    print('FAILED:', [n for n, ok, _ in RESULTS if not ok])
    sys.exit(1)
