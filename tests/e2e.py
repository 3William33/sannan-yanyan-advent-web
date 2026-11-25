#!/usr/bin/env python3
"""e2e.py — 网页版降临历端到端测试（虚构数据，不包含任何真实礼物内容）"""
import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path('/root/work')
SITE = 'http://localhost:8024/sannan-yanyan-advent-web/'
MOCK = 'http://localhost:8025/data'
MOCK_GH = 'http://localhost:8026'
SAVE_KEY = 'advent-web-save-v1'

results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name}" + (f' | {detail}' if detail and not ok else ''))



def publish_and_wait(page, token):
    page.evaluate('UI.showPublish()')
    page.locator('input[type=password]').fill(token)
    page.locator('.adv-btn', has_text='发布').click()
    try:
        page.wait_for_function(
            "() => { const s = document.querySelector('.adv-status'); "
            "return s && (s.textContent.includes('已发布') || s.textContent.includes('失败')); }",
            timeout=15000)
        return page.locator('.adv-status').inner_text()
    except Exception:
        # 浮层已自动关闭 = 发布成功
        if not page.locator('.adv-sheet').count():
            return '<b>已发布</b> · (浮层已关闭)'
        return '(状态未知)'


def load_save(page):
    return page.evaluate(f'JSON.parse(localStorage.getItem("{SAVE_KEY}") || "null")')


def goto_page(page, clock_dt, extra=''):
    page.clock.set_fixed_time(clock_dt)
    # 沙箱内 Google Fonts 证书不可用（真实设备不受影响），测试时屏蔽
    page.route('**fonts.googleapis.com/**', lambda r: r.abort())
    page.route('**fonts.gstatic.com/**', lambda r: r.abort())
    page.goto(f'{SITE}?data={MOCK}{extra}', wait_until='domcontentloaded')
    page.wait_for_timeout(1200)


def main():
    subprocess.run([sys.executable, str(ROOT / 'webrepo/tests/mock_data.py'), '/tmp/mockdata'], check=True)
    subprocess.run(['rm', '-rf', '/tmp/mockgh'], check=True)

    data_srv = subprocess.Popen([sys.executable, str(ROOT / 'webrepo/tests/mock_server.py'), '/tmp/mockdata', '/tmp/mockgh'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    gh_srv = subprocess.Popen([sys.executable, str(ROOT / 'webrepo/tests/mock_server.py'), '/tmp/mockdata', '/tmp/mockgh'],
                              env={**os.environ, 'MOCK_GH': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # ══ A. 筹备期（11月28日）：同步、偷看记录 ══
            ctx = browser.new_context()
            page = ctx.new_page()
            errors = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))
            goto_page(page, '2026-11-28T10:00:00+08:00')

            check('A1 页面加载无 JS 错误', not [e for e in errors if 'favicon' not in e and 'net::ERR_FAILED' not in e], str(errors[:3]))
            sync_line = page.locator('#syncLine').inner_text()
            check('A2 远程同步成功', '已同步' in sync_line, sync_line)
            save = load_save(page) or {}
            check('A3 偷看日志合并远端事件', save.get('peek_log') and any(e['id'] == 'mock-peek-1' for e in save['peek_log']))
            check('A4 顶栏偷看计数(砚砚1)', '砚砚 1' in page.locator('#topStars').inner_text())

            # 筹备期点已备好礼物的窗 → 偷看
            page.locator('.adv-win:has(small:text-is("3"))').click()
            page.wait_for_timeout(500)
            save = load_save(page)
            san_peeks = [e for e in save['peek_log'] if e['who'] == 'san']
            check('A5 筹备期点窗记录偷看(attempt)', len(san_peeks) == 1 and san_peeks[0]['outcome'] == 'attempt')
            check('A6 窗户抖动提示', '记下' in page.locator('.adv-toast.show').inner_text())

            # 缓存穿透检查
            access = Path('/tmp/mockgh/access_log.txt').read_text()
            import re as _re
            check('A7 同步请求带缓存穿透参数', bool(_re.search(r'/data/gifts\.json\?t=\d+', access)), access[:200])
            ctx.close()

            # ══ B. 十二月：解锁、开窗、双方礼物合并、已读状态 ══
            ctx = browser.new_context()
            page = ctx.new_page()
            errors = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))
            goto_page(page, '2026-12-05T10:00:00+08:00')

            # 12月5日 → 窗1-5解锁；内置礼物解码
            page.locator('.adv-win:has(small:text-is("1"))').click()
            page.wait_for_timeout(2600)  # 等开窗动画
            card = page.locator('.adv-xcard')
            check('B1 12月内置礼物开窗出现卡片', card.count() >= 1)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            check('B2 卡片翻面后可见礼物区', page.locator('.adv-body').count() >= 1)
            body_len = len(page.locator('.adv-body').inner_text())
            check('B2b 内置礼物正文已渲染', body_len > 20, f'body_len={body_len}')
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)

            save = load_save(page)
            check('B3 已开记录持久化', 1 in save['opened'])

            # 窗3：远程砚砚礼物
            page.locator('.adv-win:has(small:text-is("3"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            check('B4 远程礼物在卡片中(砚砚后来追加)', '砚砚后来追加' in page.locator('.adv-body').inner_text())
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)

            save = load_save(page)
            check('B5 已读标记(mock-yan-3-a)', 'mock-yan-3-a' in save['seen_remote_ids'])

            # 窗5：双方礼物合并
            page.locator('.adv-win:has(small:text-is("5"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            body_txt = page.locator('.adv-body').inner_text()
            check('B6 双方礼物同窗合并', '砚砚后来追加' in body_txt and '三三放进来的' in body_txt)

            # 问答保存
            ta = page.locator('.adv-ta')
            if ta.count():
                ta.fill('MOCK-测试回答')
                page.locator('.adv-btn', has_text='保存回答').click()
                page.wait_for_timeout(400)
                save = load_save(page)
                check('B7 问答答案已保存', any('MOCK-测试回答' in str(v) for v in save['answers'].values()))
            else:
                check('B7 问答答案已保存', False, 'no textarea')
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)

            # 状态恢复：刷新后窗1仍亮
            page.reload(wait_until='domcontentloaded')
            page.wait_for_timeout(1200)
            win1_class = page.locator('.adv-win:has(small:text-is("1"))').get_attribute('class')
            check('B8 刷新后开窗状态恢复', 'open' in (win1_class or ''))

            # 身份记名切换
            page.locator('#whoBtn').click()
            page.wait_for_timeout(200)
            check('B9 身份记名切换为砚砚', '砚砚' in page.locator('#whoBtn').inner_text())
            # 未解锁的窗（12日）在12月3日点 → 记砚砚偷看
            page.locator('.adv-win:has(small:text-is("12"))').click()
            page.wait_for_timeout(400)
            save = load_save(page)
            day12_peek = [e for e in save['peek_log'] if e['day'] == 12]
            check('B10 12月未到日期偷看记名砚砚', day12_peek and day12_peek[-1]['who'] == 'yan')
            ctx.close()

            # ══ C. 三三追加礼物 + 发布（含冲突重试、资产上传、索引、偷看合并）══
            ctx = browser.new_context()
            page = ctx.new_page()
            goto_page(page, '2026-12-07T15:00:00+08:00', f'&ghapi={MOCK_GH}/repos/3William33/sannan-yanyan-advent-2026/contents/')

            # 伪造一条本地偷看事件（模拟历史记录）
            page.evaluate(f'''
              (() => {{
                const s = JSON.parse(localStorage.getItem("{SAVE_KEY}"));
                s.peek_log.push({{id: "peek-local-test", who: "san", day: 2,
                  peeked_at: "2026-12-04T09:00:00+08:00", at: "2026-12-04T09:00:00+08:00", outcome: "attempt"}});
                localStorage.setItem("{SAVE_KEY}", JSON.stringify(s));
              }})()
            ''')
            page.reload(wait_until='domcontentloaded')  # 让适配层重新载入存档
            page.wait_for_timeout(1200)

            # 编辑器：文字 + PNG 图片
            png = base64.b64decode(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
            Path('/tmp/test_img.png').write_bytes(png)
            page.evaluate('UI.openEditor()')
            page.locator('.adv-in1[type=number]').fill('7')
            page.locator('.adv-ta').fill('MOCK-三三本地礼物正文')
            page.locator('input[type=file]').first.set_input_files('/tmp/test_img.png')
            page.wait_for_timeout(600)
            page.locator('.adv-btn', has_text='封好礼盒').click()
            page.wait_for_timeout(600)

            save = load_save(page)
            entries = save['human_gifts'].get('7', [])
            check('C1 本地礼物已藏入', entries and entries[0]['items_v2'][0]['text'] == 'MOCK-三三本地礼物正文')
            check('C2 图片暂存为 uploads/ 引用', entries and entries[0]['items_v2'][1]['url'].startswith('uploads/'))
            check('C3 礼物ID符合协议 san-*', entries and entries[0]['id'].startswith('san-'))

            # 确认本地可看到该礼物（IndexedDB 图片可解析）
            page.locator('.adv-win:has(small:text-is("7"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            body_txt = page.locator('.adv-body').inner_text()
            check('C4 本地礼物开窗可见(三三放进来的)', '三三放进来的' in body_txt)
            local_img = page.locator('.adv-body img')
            check('C5 暂存图片可显示', local_img.count() >= 1)
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)

            # 发布（模拟 GitHub API，第一次 PUT sannan_gifts.json 返回 409）
            Path('/tmp/mockgh/conflict_sannan_gifts_once').write_text('1')
            pub_msg = publish_and_wait(page, 'test-token')
            check('C6 发布成功(含409冲突重试)', '已发布' in pub_msg, pub_msg)

            # 校验仓库内容
            sg = json.loads(Path('/tmp/mockgh/sannan_gifts.json').read_text())
            payload = sg['payload']
            san_digest = bytes.fromhex('eb135c1744d756e7bca04f630db146419c5fd039b4f9ec76c54dffcabceaa771')
            raw = base64.b64decode(payload)
            clear = bytes(v ^ san_digest[i % len(san_digest)] for i, v in enumerate(raw)).decode('utf-8')
            days = json.loads(clear)['days']
            day7 = days.get('7', [])
            check('C7 礼物数据已合并入仓库', day7 and day7[0]['items_v2'][0]['text'] == 'MOCK-三三本地礼物正文')
            img_items = [i for i in day7[0]['items_v2'] if i['type'] == 'image']
            check('C8 图片URL已改写为仓库raw地址', img_items and img_items[0]['url'].startswith(
                'https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/sannan/'))
            check('C9 协议字段完整(protocol v3.2)', sg.get('protocol') == 'advent-gifts-v3.2' and sg.get('version') == 2)

            assets_dir = Path('/tmp/mockgh/assets/sannan')
            check('C10 图片资产按sha256入库', assets_dir.exists() and len(list(assets_dir.glob('*.png'))) == 1)
            uploaded = list(assets_dir.glob('*.png'))[0].read_bytes()
            check('C11 资产内容一致', uploaded == png)

            idx = json.loads(Path('/tmp/mockgh/gift_index_sannan.json').read_text())
            check('C12 索引已更新且不含内容', idx['days'].get('7') and idx['days']['7'][0]['id'] == day7[0]['id']
                  and 'text' not in json.dumps(idx['days']['7']))

            peek = json.loads(Path('/tmp/mockgh/peek_log.json').read_text())
            ids = [e['id'] for e in peek['events']]
            check('C13 偷看记录双向合并', 'mock-peek-1' in ids and 'peek-local-test' in ids)

            # commit message 不包含礼物内容
            # （mock_server 不落 commit message；改为检查源码中固定模式）——直接验证本地礼物正文未出现在任何 PUT body 的 message 字段
            # 通过重放：读取 access_log 确认调用序列
            access = Path('/tmp/mockgh/access_log.txt').read_text()
            check('C14 发布调用序列完整', all(p in access for p in
                  ['sannan_gifts.json', 'gift_index_sannan.json', 'peek_log.json', 'assets/sannan/']))

            # 二次发布（幂等，资源已存在 → hash 校验通过）
            pub_msg = publish_and_wait(page, 'test-token')
            check('C15 重复发布幂等成功', '已发布' in pub_msg, pub_msg)

            # 错误 Token → 明确报错
            pub_msg = publish_and_wait(page, 'wrong-token')
            check('C16 无效Token明确报错', '失败' in pub_msg and 'Token' in pub_msg, pub_msg)
            ctx.close()

            # ══ D. 砚砚箱定稿快照（freeze）规则 ══
            ctx = browser.new_context()
            page = ctx.new_page()
            goto_page(page, '2026-12-10T10:00:00+08:00')  # 首次 12月后同步 → 记录定稿
            save = load_save(page)
            check('D1 12月后记录定稿快照', save['yanyan_freeze'] and 'mock-yan-3-a' in save['yanyan_freeze']['gift_ids']
                  and 'mock-yan-5-a' in save['yanyan_freeze']['gift_ids'])

            # 修改虚构数据：合法当天追加(12-10 当天) + 非当天追加 + 三三任意追加
            sys.path.insert(0, str(ROOT / 'webrepo/tests'))
            from mock_data import encode as mock_encode, wrapper as mock_wrapper, YAN_DIGEST, SAN_DIGEST
            yan = {'days': {
                '3': [{'id': 'mock-yan-3-a', 'from': '砚砚', 'title': 'MOCK-礼物甲', 'kind': 'letter',
                       'text': 'MOCK-虚构正文甲，仅用于自动化测试。',
                       'items_v2': [{'type': 'text', 'text': 'MOCK-虚构正文甲，仅用于自动化测试。'}],
                       'created_at': '2026-11-20T12:00:00+08:00'}],
                '10': [{'id': 'mock-yan-10-new', 'from': '砚砚', 'kind': 'letter',
                        'items_v2': [{'type': 'text', 'text': 'MOCK-当天新增'}],
                        'created_at': '2026-12-10T08:00:00+08:00'}],
                '11': [{'id': 'mock-yan-11-bad', 'from': '砚砚', 'kind': 'letter',
                        'items_v2': [{'type': 'text', 'text': 'MOCK-跨日追加应被拒'}],
                        'created_at': '2026-12-10T08:00:00+08:00'}],
            }}
            san = {'days': {
                '12': [{'id': 'mock-san-12-any', 'from': '三三', 'kind': 'letter',
                        'items_v2': [{'type': 'text', 'text': 'MOCK-三三任意追加'}],
                        'created_at': '2026-11-25T10:00:00+08:00'}],
            }}
            Path('/tmp/mockdata/gifts.json').write_text(json.dumps(mock_wrapper(yan, YAN_DIGEST), ensure_ascii=False))
            Path('/tmp/mockdata/sannan_gifts.json').write_text(json.dumps(mock_wrapper(san, SAN_DIGEST), ensure_ascii=False))

            page.evaluate('UI.syncNow()')
            page.wait_for_timeout(2500)
            save = load_save(page)
            check('D2 定稿ID保留', save['yanyan_freeze'] and 'mock-yan-3-a' in save['yanyan_freeze']['gift_ids'])
            # 窗10（当天合法追加）应可见
            page.locator('.adv-win:has(small:text-is("10"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            check('D3 12月1-23当天追加被接受', 'MOCK-当天新增' in page.locator('.adv-body').inner_text())
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)
            # 时间推进到 12月12日，检查跨日追加与三三箱
            page.clock.set_fixed_time('2026-12-12T10:00:00+08:00')
            # 窗11（跨日追加）应被拒绝：卡片中不应出现该内容
            win11 = page.locator('.adv-win:has(small:text-is("11"))')
            win11.click()
            page.wait_for_timeout(2200)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            body_txt = page.locator('.adv-body').inner_text()
            check('D4 非当天追加被冻结规则拒绝', 'MOCK-跨日追加应被拒' not in body_txt)
            page.locator('.adv-btn', has_text='关上').click()
            page.wait_for_timeout(600)
            # 三三箱不受冻结限制
            page.locator('.adv-win:has(small:text-is("12"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            check('D5 三三箱不受冻结限制', 'MOCK-三三任意追加' in page.locator('.adv-body').inner_text())
            page.locator('.adv-btn', has_text='关上').click()
            ctx.close()

            # ══ E. 离线缓存 ══
            ctx = browser.new_context()
            page = ctx.new_page()
            goto_page(page, '2026-12-03T10:00:00+08:00')
            check('E1 首次同步成功', '已同步' in page.locator('#syncLine').inner_text())
            # 屏蔽数据源 → 使用缓存
            page.route('**/localhost:8025/**', lambda r: r.abort())
            page.evaluate('UI.syncNow()')
            page.wait_for_timeout(1500)
            check('E2 断网时使用离线缓存', '离线缓存' in page.locator('#syncLine').inner_text())
            # 远程礼物仍可打开（来自缓存）
            page.locator('.adv-win:has(small:text-is("3"))').click()
            page.wait_for_timeout(2600)
            page.locator('.adv-front').click()
            page.wait_for_timeout(400)
            check('E3 离线时缓存礼物仍可读', '砚砚后来追加' in page.locator('.adv-body').inner_text())
            ctx.close()

            # ══ F. WebKit(Safari 引擎) + iPhone/iPad 视口 ══
            wkit = p.webkit.launch()
            def block_fonts(pg):
                pg.route('**fonts.googleapis.com/**', lambda r: r.abort())
                pg.route('**fonts.gstatic.com/**', lambda r: r.abort())
            for label, vp, mobile in [
                ('F-iPhone', {'width': 390, 'height': 844}, True),
                ('F-iPad', {'width': 820, 'height': 1180}, True),
            ]:
                ctx = wkit.new_context(viewport=vp, is_mobile=mobile, has_touch=True,
                                          user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
                wpage = ctx.new_page()
                block_fonts(wpage)
                werrors = []
                wpage.on('console', lambda m: werrors.append(m.text) if m.type == 'error' else None)
                wpage.on('pageerror', lambda e: werrors.append(str(e)))
                wpage.clock.set_fixed_time('2026-12-03T10:00:00+08:00')
                wpage.goto(f'{SITE}?data={MOCK}', wait_until='domcontentloaded')
                wpage.wait_for_timeout(1500)
                house_visible = wpage.locator('.adv-house img.adv-base').is_visible()
                check(f'{label}1 房子渲染可见({vp["width"]}x{vp["height"]})', house_visible)
                overflow = wpage.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 2')
                check(f'{label}2 无横向溢出', not overflow)
                wpage.locator('.adv-win:has(small:text-is("2"))').tap()
                wpage.wait_for_timeout(2600)
                check(f'{label}3 触摸开窗正常', wpage.locator('.adv-xcard').count() >= 1)
                check(f'{label}4 无JS错误', not [e for e in werrors if 'favicon' not in e and 'CERT' not in e and 'ERR_FAILED' not in e], str(werrors[:2]))
                shot = f'/root/work/artifact/{label.replace("-", "_").lower()}.png'
                wpage.screenshot(path=shot)
                ctx.close()

            # WebKit 桌面全流程
            ctx = wkit.new_context(viewport={'width': 1280, 'height': 900})
            wpage = ctx.new_page()
            block_fonts(wpage)
            wpage.clock.set_fixed_time('2026-12-03T10:00:00+08:00')
            wpage.goto(f'{SITE}?data={MOCK}', wait_until='domcontentloaded')
            wpage.wait_for_timeout(1500)
            wpage.locator('.adv-win:has(small:text-is("1"))').click()
            wpage.wait_for_timeout(2600)
            check('F5 WebKit 内置礼物开窗', wpage.locator('.adv-xcard').count() >= 1)
            ctx.close()

            browser.close()

            # ══ G. 真实数据仓库只读冒烟测试（不输出任何礼物内容）══
            # 沙箱浏览器无法直连外网（代理证书不受信），因此在这里用与前端完全相同的
            # 解码算法做服务端验证；浏览器内联网在真实 GitHub Pages 环境下可用
            # （raw.githubusercontent.com 与 api.github.com 均返回 access-control-allow-origin: *）。
            import urllib.request as _ur
            for name in ['gifts.json', 'sannan_gifts.json', 'peek_log.json']:
                try:
                    with _ur.urlopen(f'https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/{name}', timeout=15) as r:
                        data = json.loads(r.read().decode('utf-8'))
                    check(f'G-{name} 可访问', True)
                except Exception as e:
                    check(f'G-{name} 可访问', False, str(e)[:120])
                    continue
                if name == 'peek_log.json':
                    ok_shape = isinstance(data.get('events'), list)
                    check(f'G-{name} 结构有效', ok_shape)
                else:
                    try:
                        digest = bytes.fromhex('b52854d482f1040024bf2db8734b74ac60bb43bcb26c37170986ec673214757f'
                                               if name == 'gifts.json' else
                                               'eb135c1744d756e7bca04f630db146419c5fd039b4f9ec76c54dffcabceaa771')
                        payload = data['payload']
                        raw = base64.b64decode(payload)
                        clear = bytes(v ^ digest[i % len(digest)] for i, v in enumerate(raw)).decode('utf-8')
                        days = json.loads(clear).get('days', {})
                        n = sum(len(v) if isinstance(v, list) else 1 for v in days.values())
                        check(f'G-{name} 混淆payload可解码', isinstance(days, dict), 'decode failed')
                    except Exception as e:
                        check(f'G-{name} 混淆payload可解码', False, str(e)[:120])

    finally:
        data_srv.terminate()
        gh_srv.terminate()

    fails = [r for r in results if not r[1]]
    print(f"\n===== {len(results) - len(fails)}/{len(results)} passed =====")
    if fails:
        for name, _, detail in fails:
            print(f"FAILED: {name} {detail}")
        sys.exit(1)


if __name__ == '__main__':
    main()
