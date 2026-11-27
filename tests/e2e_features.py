#!/usr/bin/env python3
"""针对性回归：旋转黑胶、对方视角预览、偷看提示。全部虚构数据，不剧透真实礼物。"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE = os.environ.get('ADVENT_SITE', 'http://localhost:8024/')
DATA = 'http://localhost:8025/data'
SAVE_KEY = 'advent-web-save-v1'

RESULTS = []
def check(name, cond, detail=''):
    ok = bool(cond)
    RESULTS.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL'), name, ('' if ok else '| ' + str(detail)[:200]))

def fresh(browser, dt='2026-12-06T10:00:00+08:00'):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                              device_scale_factor=2, ignore_https_errors=True)
    pg = ctx.new_page()
    pg.route('**fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('**fonts.gstatic.com/**', lambda r: r.abort())
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.set_fixed_time(dt)
    pg.goto(f'{SITE}?data={DATA}', wait_until='domcontentloaded')
    pg.wait_for_timeout(1400)
    return ctx, pg, errs

COVER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ══ F. 歌曲信息解析（手填优先）══
    ctx, pg, errs = fresh(browser)
    r = pg.evaluate('''(cov) => {
      const M = window.AdventMusic;
      const a = M.parseMusicUrl('https://music.163.com/song?id=186016',
        {name:'虚构歌名', artist:'虚构歌手', cover:cov});
      const b = M.parseMusicUrl('https://music.163.com/song?id=186016');
      return {a, b};
    }''', COVER)
    check('F1 parseMusicUrl 带 meta 时保留歌名/歌手/封面',
          r['a'].get('name') == '虚构歌名' and r['a'].get('artist') == '虚构歌手' and bool(r['a'].get('cover')), r['a'])
    check('F2 未提供 meta 时不臆造字段',
          'name' not in r['b'] and 'artist' not in r['b'], r['b'])
    ctx.close()

    # ══ G. 旋转黑胶渲染 ══
    ctx, pg, errs = fresh(browser)
    g = pg.evaluate('''(cov) => {
      const box = document.createElement('div'); document.body.appendChild(box);
      window.AdventMusic.renderMusicItem(box, {
        type:'song', url:'https://music.163.com/song?id=186016',
        name:'虚构歌名', artist:'虚构歌手', cover:cov
      });
      const disc = box.querySelector('.adv-vinyl-disc');
      const title = box.querySelector('.adv-vinyl-title');
      const sub = box.querySelector('.adv-vinyl-sub');
      const cover = box.querySelector('.adv-vinyl-cover');
      const anim = disc ? getComputedStyle(disc).animationName : '';
      const r = {hasVinyl:!!disc, hasLabel:!!box.querySelector('.adv-vinyl-label'),
                 hasHole:!!box.querySelector('.adv-vinyl-hole'),
                 title:title&&title.textContent, sub:sub&&sub.textContent,
                 coverSrc:cover&&cover.getAttribute('src'), anim};
      box.remove(); return r;
    }''', COVER)
    check('G1 歌曲渲染出黑胶唱片', g['hasVinyl'] and g['hasLabel'] and g['hasHole'], g)
    check('G2 信息条显示歌名与歌手', g['title'] == '虚构歌名' and '虚构歌手' in (g['sub'] or ''), g)
    check('G3 封面图被设置', g['coverSrc'] == COVER, (g['coverSrc'] or '')[:40])
    check('G4 黑胶有旋转动画', 'adv-vinyl-spin' in (g['anim'] or ''), g['anim'])
    check('G5 渲染无 JS 错误', not errs, errs[:2])
    ctx.close()

    # ══ H. 无 meta 时优雅占位 ══
    ctx, pg, errs = fresh(browser)
    h = pg.evaluate('''() => {
      const box = document.createElement('div'); document.body.appendChild(box);
      window.AdventMusic.renderMusicItem(box, {type:'song', url:'https://music.163.com/song?id=1'});
      const title = box.querySelector('.adv-vinyl-title')?.textContent;
      const hasNote = !!box.querySelector('.adv-vinyl-note');
      const coverSrc = box.querySelector('.adv-vinyl-cover')?.getAttribute('src');
      box.remove(); return {title, hasNote, coverSrc};
    }''')
    check('H1 无 meta 时显示占位歌名', h['title'] == '一首歌', h)
    check('H2 无封面时显示音符占位', h['hasNote'] and not h['coverSrc'], h)
    check('H3 占位渲染无 JS 错误', not errs, errs[:2])
    ctx.close()

    # ══ I. 编辑器有歌名/歌手/封面输入 + 对方视角预览按钮 ══
    ctx, pg, errs = fresh(browser, '2026-11-26T10:00:00+08:00')
    pg.evaluate('window.UI.openEditor()')
    pg.wait_for_timeout(500)
    ph = pg.evaluate('''() => {
      const ins = [...document.querySelectorAll('.adv-sheet input')];
      const phs = ins.map(i => i.placeholder || '');
      return {
        name: phs.some(s => s.includes('歌名')),
        artist: phs.some(s => s.includes('歌手')),
        cover: phs.some(s => s.includes('封面')),
        previewBtn: [...document.querySelectorAll('.adv-sheet button')].some(b => b.textContent.includes('预览对方视角')),
      };
    }''')
    check('I1 编辑器有歌名输入框', ph['name'], ph)
    check('I2 编辑器有歌手输入框', ph['artist'], ph)
    check('I3 编辑器有封面输入框', ph['cover'], ph)
    check('I4 编辑器有「预览对方视角」按钮', ph['previewBtn'], ph)
    ctx.close()

    # ══ J. 对方视角预览：展示礼物卡、不写存档 ══
    ctx, pg, errs = fresh(browser, '2026-11-26T10:00:00+08:00')
    pg.evaluate('window.UI.openEditor()')
    pg.wait_for_timeout(400)
    # 填日期6、文字、歌曲（手填 meta）
    pg.evaluate('''(cov) => {
      const ins = [...document.querySelectorAll('.adv-sheet input')];
      const num = ins.find(i => i.type === 'number'); if (num) { num.value = '6'; num.dispatchEvent(new Event('input')); }
      const url = ins.find(i => i.type === 'url' && (i.placeholder||'').includes('spotify')); if (url) { url.value='https://music.163.com/song?id=186016'; url.dispatchEvent(new Event('input')); }
      const nm = ins.find(i => (i.placeholder||'').includes('歌名')); if (nm) { nm.value='虚构歌名'; nm.dispatchEvent(new Event('input')); }
      const ar = ins.find(i => (i.placeholder||'').includes('歌手')); if (ar) { ar.value='虚构歌手'; ar.dispatchEvent(new Event('input')); }
      const cv = ins.find(i => (i.placeholder||'').includes('封面')); if (cv) { cv.value=cov; cv.dispatchEvent(new Event('input')); }
      const ta = document.querySelector('.adv-sheet textarea'); if (ta) { ta.value='虚构的文字内容'; ta.dispatchEvent(new Event('input')); }
    }''', COVER)
    save_before = pg.evaluate(f'localStorage.getItem("{SAVE_KEY}")')
    pg.get_by_role('button', name='预览对方视角').click()
    pg.wait_for_selector('#selfPreviewOverlay .adv-cardbox')
    pg.wait_for_timeout(400)
    j = pg.evaluate('''() => {
      const host = document.getElementById('selfPreviewOverlay');
      return {
        hasHost: !!host,
        hasCard: !!host && !!host.querySelector('.adv-cardbox'),
        frontHint: host?.querySelector('.adv-front .fhint')?.textContent || '',
        hasVinyl: !!host && !!host.querySelector('.adv-vinyl-disc'),
        bodyText: host?.querySelector('.adv-back')?.textContent || '',
      };
    }''')
    save_after = pg.evaluate(f'localStorage.getItem("{SAVE_KEY}")')
    check('J1 预览浮层出现礼物卡', j['hasHost'] and j['hasCard'], j)
    check('J2 封面标注为预览', '预览' in j['frontHint'], j['frontHint'])
    check('J3 预览中歌曲显示为黑胶', j['hasVinyl'], j)
    check('J4 预览含虚构文字内容', '虚构的文字内容' in j['bodyText'], j['bodyText'][:80])
    check('J5 预览不写入存档（不真正封礼）', save_before == save_after, (str(save_before)[:60], str(save_after)[:60]))
    check('J6 预览无 JS 错误', not errs, errs[:2])
    ctx.close()

    # ══ K. 偷看：记一笔 + 显示内容，但不算正式开启 ══
    ctx, pg, errs = fresh(browser, '2026-11-26T10:00:00+08:00')
    pg.evaluate('''() => {
      [...document.querySelectorAll('.adv-win')].find(w => w.querySelector('small')?.textContent === '6')?.click();
    }''')
    pg.wait_for_timeout(600)
    k = pg.evaluate('''(key) => {
      const save = JSON.parse(localStorage.getItem(key) || '{}');
      const ov = document.getElementById('overlay');
      return {
        peeks: (save.peek_log || []).length,
        hasAttempt: (save.peek_log || []).some(e => e.day === 6 && e.outcome === 'attempt'),
        opened6: (save.opened || []).includes(6),
        cardShown: !!ov && ov.style.display === 'flex' && !!ov.querySelector('.adv-cardbox'),
        frontMarked: (ov?.querySelector('.adv-front .fby')?.textContent || '').includes('偷看'),
        backHasContent: !!ov?.querySelector('.adv-back .adv-body')?.textContent?.trim(),
      };
    }''', SAVE_KEY)
    check('K1 偷看记录为 attempt', k['peeks'] >= 1 and k['hasAttempt'], k)
    check('K2 偷看显示礼物卡内容', k['cardShown'] and k['backHasContent'], k)
    check('K3 卡片正面标注「偷看」', k['frontMarked'], k)
    check('K4 偷看不算正式开启', k['opened6'] is False, k)
    check('K5 偷看无 JS 错误', not errs, errs[:2])
    ctx.close()

    # ══ L. 流畅模式停止黑胶旋转 ══
    ctx, pg, errs = fresh(browser)
    pg.evaluate('window.Backend.setSmooth(true)')
    pg.evaluate('location.reload()')
    pg.wait_for_timeout(1300)
    l = pg.evaluate('''() => {
      const box = document.createElement('div'); document.body.appendChild(box);
      window.AdventMusic.renderMusicItem(box, {type:'song', url:'https://music.163.com/song?id=1'});
      const disc = box.querySelector('.adv-vinyl-disc');
      const anim = disc ? getComputedStyle(disc).animationName : '';
      box.remove(); return anim;
    }''')
    check('L1 流畅模式停止黑胶旋转', l in ('none', ''), l)
    ctx.close()

    browser.close()

passed = sum(1 for _, ok, _ in RESULTS if ok)
total = len(RESULTS)
print(f'\n===== {passed}/{total} PASS =====')
if passed < total:
    print('FAILED:', [n for n, ok, _ in RESULTS if not ok])
    sys.exit(1)
