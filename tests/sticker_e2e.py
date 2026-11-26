#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sticker_e2e.py — 贴纸素材库端到端测试（全部虚构数据，无真实礼物内容）

覆盖：分类浏览 / 搜索 / 配色筛选 / 同图案切色 / 收藏 / 最近 / 添加 / 替换 /
删除复制 / 手账草稿保存与重开恢复 / 发布后渲染 / 桌面与移动布局 / 深浅色。
浏览器：Chromium 与 WebKit（真实 iPad Safari 无法在沙箱运行，明确标注）。
"""
import base64
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SITE = os.environ.get('ADVENT_SITE', 'http://127.0.0.1:8024/')
MOCK = 'http://127.0.0.1:8025/data'
GH = 'http://127.0.0.1:8026'
MOCKDATA = '/tmp/stk_mockdata'
MOCKGH = '/tmp/stk_mockgh'

RAW_PREFIX = 'https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name}" + (f' | {detail}' if detail and not ok else ''))


def png_bytes(color=(180, 60, 60, 255)):
    im = Image.new('RGBA', (40, 40), color)
    buf = io.BytesIO(); im.save(buf, format='PNG')
    return buf.getvalue()


def build_fiction_index():
    """构造虚构贴纸索引：3 类，含 8 色图案，属性与真实索引结构一致。"""
    palettes = {
        'ink': {'name_zh': '墨黑', 'name_en': 'Ink', 'hex': '#202020'},
        'wine': {'name_zh': '酒红', 'name_en': 'Wine', 'hex': '#842d46'},
        'peacock': {'name_zh': '孔雀蓝', 'name_en': 'Peacock', 'hex': '#167c83'},
        'original': {'name_zh': '原色', 'name_en': 'Original', 'hex': None},
    }
    categories = {
        'christmas': {'name_zh': '圣诞', 'name_en': 'Christmas'},
        'postmarks': {'name_zh': '邮戳', 'name_en': 'Postmarks'},
        'doodles': {'name_zh': '涂鸦', 'name_en': 'Doodles'},
    }
    stickers = []

    def add(sid, pat, name, cat, sub, color, cn, hexv, desc, tags):
        stickers.append({
            'id': sid, 'pattern_id': pat, 'name_zh': name, 'name_en': name,
            'pattern_name_zh': name.split('·')[0], 'pattern_name_en': name.split('·')[0],
            'category': cat, 'category_name_zh': categories[cat]['name_zh'], 'subcategory': sub,
            'color': color, 'color_name_zh': cn, 'color_name_en': cn, 'color_hex': hexv,
            'width': 40, 'height': 40, 'path': f'{cat}/{color}/{sid}.png',
            'raw_url': RAW_PREFIX + f'{cat}/{color}/{sid}.png',
            'tags': tags, 'description': desc, 'search_text': ' '.join(tags + [name, desc]),
            'variants': [], 'variant_count': 1,
        })

    # 圣诞原色两张
    add('christmas-star', 'christmas-star', '虚构星星', 'christmas', '装饰', 'original', '原色', None, '虚构五角星', ['星星', '装饰'])
    add('christmas-tree', 'christmas-tree', '虚构圣诞树', 'christmas', '植物', 'original', '原色', None, '虚构圣诞树', ['树', '圣诞'])
    # 邮戳三色（同一图案）
    for c, cn, hx in [('ink', '墨黑', '#202020'), ('wine', '酒红', '#842d46'), ('peacock', '孔雀蓝', '#167c83')]:
        add(f'postmarks-stamp-{c}', 'postmarks-stamp', f'虚构邮戳·{cn}', 'postmarks', '邮戳', c, cn, hx, '虚构圆形邮戳', ['邮戳', '信封'])
    # 涂鸦四色（同一图案），带雪人关键词
    for c, cn, hx in [('ink', '墨黑', '#202020'), ('wine', '酒红', '#842d46'), ('peacock', '孔雀蓝', '#167c83')]:
        add(f'doodles-snowman-{c}', 'doodles-snowman', f'虚构雪人·{cn}', 'doodles', '人物', c, cn, hx, '虚构小雪人', ['雪人', '冬天', '人物'])
    # 关联变体
    groups = {}
    for s in stickers: groups.setdefault(s['pattern_id'], []).append(s['id'])
    for s in stickers:
        s['variants'] = [x for x in groups[s['pattern_id']] if x != s['id']]
        s['variant_count'] = len(groups[s['pattern_id']])

    return {
        'schema': 'advent-sticker-index-v1', 'version': 1,
        'generated_at': '2026-11-26T00:00:00+08:00', 'raw_base': RAW_PREFIX,
        'license_note': '虚构测试数据', 'palettes': palettes, 'categories': categories,
        'subcategories': sorted({s['subcategory'] for s in stickers}),
        'patterns': [], 'stickers': stickers,
    }


def setup_mock():
    subprocess.run(['rm', '-rf', MOCKDATA, MOCKGH], check=True)
    os.makedirs(MOCKDATA + '/assets/stickers', exist_ok=True)
    os.makedirs(MOCKGH, exist_ok=True)
    idx = build_fiction_index()
    with open(MOCKDATA + '/assets/stickers/sticker_index.json', 'w') as f:
        json.dump(idx, f, ensure_ascii=False)
    # 占位 PNG：虚构纯色块，仅用于让 img 有 src
    for s in idx['stickers']:
        p = MOCKDATA + '/assets/stickers/' + s['path']
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f: f.write(png_bytes())
    # 基础礼物数据（虚构，空即可，避免同步噪声）
    env = {'days': {}}
    wrap = {'version': 1, 'updated_at': '2026-11-26T00:00:00+08:00', 'payload': ''}
    # 用 mock_data 生成合法空数据
    subprocess.run([sys.executable, str(ROOT / 'tests/mock_data.py'), MOCKDATA], check=True,
                   stdout=subprocess.DEVNULL)
    return idx


def goto(page):
    page.clock.set_fixed_time('2026-11-26T20:00:00+08:00')
    page.route('**fonts.googleapis.com/**', lambda r: r.abort())
    page.route('**fonts.gstatic.com/**', lambda r: r.abort())
    # raw.githubusercontent 图片在沙箱内不可达 → 用虚构 PNG 兜底，仅测试 DOM 逻辑
    page.route('**raw.githubusercontent.com/**', lambda r: r.fulfill(status=200, content_type='image/png', body=png_bytes()))
    page.goto(f'{SITE}?data={MOCK}&ghapi={GH}', wait_until='domcontentloaded')
    page.wait_for_timeout(900)


def open_scrapbook(page):
    page.locator('#deskDiary').click()
    page.wait_for_timeout(400)
    page.locator('#stklibHost .adv-stklib-card').first.wait_for(timeout=8000)


def run_browser(pw, browser_type, label):
    browser = browser_type.launch(headless=True)
    # 书桌仅在横屏/宽视口显示（与 v4_smoke 一致），故用 iPad 横屏尺寸打开手账
    ctx = browser.new_context(viewport={'width': 1024, 'height': 768})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    try:
        goto(page)
        open_scrapbook(page)
        cards = page.locator('#stklibHost .adv-stklib-card')
        check(f'[{label}] 收纳册渲染全部虚构图案', cards.count() == 4, f'cards={cards.count()}')

        # 分类浏览
        page.locator('#stklibHost [data-cat="postmarks"]').click()
        page.wait_for_timeout(150)
        check(f'[{label}] 按分类筛选（邮戳=1图案）', cards.count() == 1, f'cards={cards.count()}')
        page.locator('#stklibHost [data-cat="all"]').click()
        page.wait_for_timeout(150)

        # 配色筛选：孔雀蓝，3 个图案（邮戳+雪人，原色2个被排除）→ 2
        page.locator('#stklibHost .adv-stklib-color').select_option('peacock')
        page.wait_for_timeout(150)
        check(f'[{label}] 按配色筛选（peacock=2图案）', cards.count() == 2, f'cards={cards.count()}')
        page.locator('#stklibHost .adv-stklib-color').select_option('all')
        page.wait_for_timeout(150)

        # 搜索：雪人 → 1 图案
        page.locator('#stklibHost .adv-stklib-search').fill('雪人')
        page.wait_for_timeout(300)
        check(f'[{label}] 按名称/标签搜索（雪人=1）', cards.count() == 1, f'cards={cards.count()}')
        page.locator('#stklibHost .adv-stklib-search').fill('')
        page.wait_for_timeout(300)

        # 同图案切色：邮戳卡有 3 个圆点，点击 wine 后 data-pick 变化
        stamp = page.locator('#stklibHost .adv-stklib-card', has=page.locator('[data-pattern="postmarks-stamp"]'))
        stamp = stamp.first if stamp.count() else page.locator('#stklibHost .adv-stklib-card').nth(2)
        dots = stamp.locator('.adv-stklib-dot')
        if dots.count() >= 2:
            before = stamp.locator('[data-pick]').get_attribute('data-pick')
            dots.nth(1).click()
            page.wait_for_timeout(80)
            after = stamp.locator('[data-pick]').get_attribute('data-pick')
            check(f'[{label}] 同图案快速切色', before != after and 'wine' in after, f'{before}->{after}')
        else:
            check(f'[{label}] 同图案快速切色', False, 'dots not found')

        # 收藏
        favbtn = cards.first.locator('.adv-stklib-fav')
        favbtn.click()
        page.wait_for_timeout(80)
        check(f'[{label}] 收藏切换', 'on' in (favbtn.get_attribute('class') or ''))
        page.locator('#stklibHost [data-mode="fav"]').click()
        page.wait_for_timeout(150)
        check(f'[{label}] 仅看收藏', cards.count() >= 1, f'cards={cards.count()}')
        page.locator('#stklibHost [data-mode="fav"]').click()
        page.wait_for_timeout(150)

        # 添加贴纸到画布
        page.locator('#stklibHost [data-cat="all"]').click()
        page.wait_for_timeout(120)
        cards.first.locator('[data-pick]').click()
        page.wait_for_timeout(150)
        check(f'[{label}] 点击添加贴纸', page.locator('#scrapCanvas .adv-sticker').count() == 1,
              f"canvas={page.locator('#scrapCanvas .adv-sticker').count()}")

        # 最近使用
        page.locator('#stklibHost [data-mode="recent"]').click()
        page.wait_for_timeout(150)
        check(f'[{label}] 最近使用记录', cards.count() >= 1, f'cards={cards.count()}')
        page.locator('#stklibHost [data-mode="recent"]').click()
        page.wait_for_timeout(150)

        # 替换选中
        first_pick = cards.first.locator('[data-pick]')
        before_src = page.locator('#scrapCanvas .adv-sticker').first.get_attribute('data-src')
        page.locator('#stklibHost .adv-stklib-replace').click()
        # 选一个不同图案的贴纸替换
        page.locator('#stklibHost .adv-stklib-card').nth(3).locator('[data-pick]').click()
        page.wait_for_timeout(150)
        after_src = page.locator('#scrapCanvas .adv-sticker').first.get_attribute('data-src')
        check(f'[{label}] 替换选中贴纸', before_src != after_src, f'{before_src}->{after_src}')
        page.locator('#stklibHost .adv-stklib-replace').click()

        # 复制 / 删除
        page.locator('[data-action="copy"]').click()
        page.wait_for_timeout(100)
        check(f'[{label}] 复制贴纸', page.locator('#scrapCanvas .adv-sticker').count() == 2)
        page.locator('[data-action="delete"]').click()
        page.wait_for_timeout(100)
        check(f'[{label}] 删除贴纸', page.locator('#scrapCanvas .adv-sticker').count() == 1)

        # 保存草稿 → 重开恢复
        page.locator('#scrapSave').click()
        page.wait_for_timeout(200)
        saved = page.evaluate("JSON.parse(localStorage.getItem('advent-v4-scrapbook')||'null')")
        check(f'[{label}] 草稿含贴纸属性',
              bool(saved and saved.get('stickers') and saved['stickers'][0].get('src') and 'stickerId' in saved['stickers'][0]))
        open_scrapbook(page)
        check(f'[{label}] 重开恢复贴纸', page.locator('#scrapCanvas .adv-sticker').count() == 1,
              f"canvas={page.locator('#scrapCanvas .adv-sticker').count()}")

        # 无 JS 错误
        real_errors = [e for e in errors if 'favicon' not in e and 'net::ERR' not in e]
        check(f'[{label}] 无 JS 运行时错误', not real_errors, str(real_errors[:2]))

        # 桌面/横屏双栏：确认 grid areas 生效
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.wait_for_timeout(200)
        cols = page.evaluate("getComputedStyle(document.querySelector('.adv-scrap-body')).gridTemplateColumns")
        check(f'[{label}] 横屏双栏布局', cols and len(cols.split()) == 2, f'cols={cols}')
        # 贴纸面板必须完整落在视口内（横屏 left:55% 老布局曾把面板挤出屏幕）
        host_box = page.locator('#stklibHost').bounding_box()
        check(f'[{label}] 横屏贴纸面板不溢出视口',
              bool(host_box) and host_box['x'] >= 0 and host_box['x'] + host_box['width'] <= 1280 + 1,
              str(host_box))

        # 竖屏窄屏：收纳册折叠按钮存在、无横向溢出
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(200)
        check(f'[{label}] 竖屏有收纳册折叠按钮', page.locator('#stklibToggle').count() == 1)
        overflow = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')
        check(f'[{label}] 竖屏无横向溢出', not overflow)
        # iPhone 竖屏：底部「手账贴纸」按钮可作为入口（书桌此时隐藏）
        entry = page.locator('.adv-links [onclick="UI.openScrapbook()"]')
        check(f'[{label}] iPhone 竖屏有手账入口', entry.count() == 1 and entry.is_visible())
        # 深浅色：body 加 dusk 类后收纳册文字色变化（可读性）
        page.evaluate("document.body.classList.add('dusk')")
        page.wait_for_timeout(80)
        bg = page.locator('#stklibHost').evaluate("e=>getComputedStyle(e).backgroundColor")
        check(f'[{label}] 夜间模式配色', bg not in ('', 'rgba(0, 0, 0, 0)'))

        ctx.close()
    finally:
        browser.close()


def guide_layouts():
    """从 docs/sticker-library-guide.md 提取真实 JSON 示例的 layout（用于验证渲染器识别）。"""
    import re
    text = (ROOT / 'docs/sticker-library-guide.md').read_text(encoding='utf-8')
    out = []
    for block in re.findall(r'```json\s*(.*?)```', text, re.S):
        try: d = json.loads(block)
        except Exception: continue
        if isinstance(d, dict) and d.get('type') == 'scrapbook' and d.get('layout'):
            out.append(d['layout'])
    return out


def test_guide_examples(pw):
    """把手册里的 scrapbook 示例注入 Backend，验证归一化保留贴纸字段与参数。"""
    layouts = guide_layouts()
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1024, 'height': 768})
    page = ctx.new_page()
    try:
        goto(page)
        for i, layout in enumerate(layouts):
            result = page.evaluate('''layout => {
              window.Backend.hide(25, [{type:'scrapbook', layout}], 'dessin');
              const s = JSON.parse(localStorage.getItem('advent-web-save-v1'));
              const list = s.human_gifts['25'];
              const e = list[list.length - 1];  // 取最新追加的条目
              return e.items_v2[0].layout;
            }''', layout)
            expected = layout['stickers']
            got = result.get('stickers', [])
            ok = (len(got) == len(expected) and
                  all(g.get('src') == e.get('src') and g.get('name') == e.get('name') for g, e in zip(got, expected)))
            check(f'[手册示例{i+1}] 渲染器识别贴纸与元数据', ok,
                  f"in={len(expected)} out={len(got)}")
    finally:
        ctx.close(); browser.close()


def main():
    idx = setup_mock()
    # 启动 mock 数据/API 服务器
    srv = subprocess.Popen([sys.executable, str(ROOT / 'tests/mock_server.py'), MOCKDATA, MOCKGH],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 静态站点服务器
    static = subprocess.Popen([sys.executable, '-m', 'http.server', '8024', '--bind', '127.0.0.1', '-d', str(ROOT)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    try:
        with sync_playwright() as pw:
            for label, bt in [('Chromium', pw.chromium), ('WebKit', pw.webkit)]:
                try:
                    run_browser(pw, bt, label)
                except Exception as e:
                    check(f'[{label}] 测试执行', False, str(e).splitlines()[0][:160])
            try:
                test_guide_examples(pw)
            except Exception as e:
                check('[手册示例] 测试执行', False, str(e).splitlines()[0][:160])
    finally:
        srv.terminate(); static.terminate()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n=== {passed}/{len(results)} passed ===")
    if passed != len(results):
        sys.exit(1)


if __name__ == '__main__':
    main()
