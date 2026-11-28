#!/usr/bin/env python3
"""V8 fictional-data regression tests; never reads real gift payloads."""
import json
import os
import shutil
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from mock_data import encode as me, wrapper as mw, YAN_DIGEST, SAN_DIGEST

SITE = os.environ.get('ADVENT_SITE', 'http://127.0.0.1:8024/')
DATA = 'http://127.0.0.1:8025/data'
MOCK = Path(os.environ.get('ADVENT_MOCK_DIR', str(Path(tempfile.gettempdir()) / 'mockdata')))
GH = Path(tempfile.gettempdir()) / 'mockgh'
RESULTS = []


def check(name, condition, detail=''):
    RESULTS.append((name, bool(condition), detail))
    print(('PASS' if condition else 'FAIL'), name, '' if condition else '| ' + str(detail)[:240], flush=True)


def png(path, width=96, height=72):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.extend((225, 70 + x % 80, 85, 255) if x < width // 2 else (70, 120 + y % 80, 95, 255))
    raw = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw += chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')
    path.write_bytes(raw)
    return path


def setup_fiction():
    MOCK.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(GH, ignore_errors=True)
    os.makedirs(GH, exist_ok=True)
    yan = {'days': {
        '3': [{'id': 'mock-yan-3', 'items_v2': [{'type': 'text', 'text': 'MOCK-YAN-3'}]}],
        '5': [{'id': 'mock-yan-5', 'items_v2': [{'type': 'text', 'text': 'MOCK-YAN-5'}]}],
    }}
    san = {'days': {'5': [{'id': 'mock-san-5', 'items_v2': [{'type': 'text', 'text': 'MOCK-SAN-5'}]}]}}
    (MOCK / 'gifts.json').write_text(json.dumps(mw(yan, YAN_DIGEST)), encoding='utf-8')
    (MOCK / 'sannan_gifts.json').write_text(json.dumps(mw(san, SAN_DIGEST)), encoding='utf-8')
    yan_index = {'version': 1, 'author': 'yan', 'days': {
        '3': [{'id': 'mock-yan-3'}], '7': [{'id': 'mock-yan-index-only-7'}],
    }}
    san_days = {'5': [{'id': 'mock-san-5'}]}
    for i in range(300):
        san_days.setdefault(str(1 + i % 25), []).append({'id': f'mock-san-bulk-{i:03d}'})
    (MOCK / 'gift_index_yanyan.json').write_text(json.dumps(yan_index), encoding='utf-8')
    (MOCK / 'gift_index_sannan.json').write_text(json.dumps({'version': 1, 'author': 'san', 'days': san_days}), encoding='utf-8')
    (MOCK / 'peek_log.json').write_text(json.dumps({'version': 2, 'events': []}), encoding='utf-8')
    (MOCK / 'companion_state.json').write_text(json.dumps(mw({'notes': {}, 'frames': {}, 'favorites': {}}, SAN_DIGEST)), encoding='utf-8')


def new_page(browser, viewport=None, mobile=False, init=None):
    ctx = browser.new_context(viewport=viewport or {'width': 390, 'height': 844}, has_touch=mobile, is_mobile=mobile, accept_downloads=True)
    pg = ctx.new_page()
    pg.route('**fonts.googleapis.com/**', lambda route, request=None: route.abort())
    pg.route('**fonts.gstatic.com/**', lambda route, request=None: route.abort())
    if init:
        pg.add_init_script(init)
    pg.clock.set_fixed_time('2026-12-20T10:00:00+08:00')
    pg.goto(f'{SITE}?data={DATA}&ghapi=http://127.0.0.1:8026/repos/test/repo/contents/', wait_until='domcontentloaded')
    pg.wait_for_function('window.Backend && window.UI && document.querySelector(".adv-house")')
    pg.wait_for_timeout(1200)
    return ctx, pg


def png_dimensions(path):
    raw = Path(path).read_bytes()
    return struct.unpack('>II', raw[16:24]) if raw[:8] == b'\x89PNG\r\n\x1a\n' else (0, 0)


def test_stats(browser):
    ctx, pg = new_page(browser)
    errors = []
    pg.on('pageerror', lambda error: errors.append(str(error)))
    pg.evaluate('window.Backend.sync()')
    pg.wait_for_function('window.Backend.getBoard().gift_stats.fresh === true')
    stats = pg.evaluate('window.Backend.getBoard().gift_stats')
    builtin = pg.evaluate("import('./builtin-gifts.js?v=8.2.0').then(m => Object.values(m.BUILTIN_STATS).flat().length)")
    check('stats deduplicate IDs and union indexes', stats['yan']['total'] == builtin + 3 and stats['san']['total'] == 301, stats)
    check('stats have no per-day distribution', not any(key in stats for key in ('days', 'gifts', 'items')), list(stats))
    check('stats piles use fixed decorative DOM', pg.locator('.adv-pile-box').count() == 16, pg.locator('.adv-pile-box').count())
    pg.evaluate("window.Backend.hide(20, [{type:'text',text:'MOCK-LOCAL-20'}], 'lettre')")
    pg.evaluate("window.Backend.hide(21, [{type:'text',text:'MOCK-LOCAL-21'}], 'lettre')")
    pg.evaluate('window.UI.syncNow()')
    pg.wait_for_timeout(300)
    local = pg.evaluate('window.Backend.getBoard().gift_stats.local')
    check('local unpublished gifts stay separate', local == 2 and pg.locator('#sanGiftCount').inner_text() == '301', local)
    before = pg.evaluate('window.Backend.getBoard().gift_stats.total')
    pg.route('**/data/**', lambda route, request=None: route.abort())
    pg.evaluate('window.UI.syncNow()')
    pg.wait_for_function('window.Backend.getBoard().gift_stats.fresh === false')
    after = pg.evaluate('window.Backend.getBoard().gift_stats.total')
    check('failed reads retain last successful totals', after == before and after > 0, (before, after))
    check('cache state is visible', '缓存统计' in pg.locator('#giftStatsStatus').inner_text(), pg.locator('#giftStatsStatus').inner_text())
    check('statistics never create peek records', pg.evaluate('window.Backend.getBoard().peeks') == 0)
    check('hundreds of gifts do not create per-gift homepage nodes', pg.locator('#page .adv-pile-box').count() == 16 and not errors, errors)
    ctx.close()


def test_theme_layout(browser):
    for width, height, mobile in [(390, 844, True), (768, 1024, False), (1024, 768, False), (1440, 900, False)]:
        ctx, pg = new_page(browser, {'width': width, 'height': height}, mobile)
        pg.evaluate("window.Backend.setDisplay('night'); window.UI.syncNow()")
        pg.wait_for_function("document.body.classList.contains('adv-night')")
        overflow = pg.evaluate('({page: document.getElementById("page").scrollWidth - document.getElementById("page").clientWidth, body: document.documentElement.scrollWidth - innerWidth})')
        check(f'desk visible without horizontal overflow {width}x{height}', pg.locator('#desk').is_visible() and overflow['page'] <= 1 and overflow['body'] <= 1, overflow)
        check(f'dark semantic desk {width}x{height}', pg.evaluate("getComputedStyle(document.getElementById('desk')).backgroundColor") == 'rgb(48, 39, 35)')
        ctx.close()
    ctx, pg = new_page(browser)
    pg.evaluate("window.Backend.setDisplay('night'); window.UI.syncNow(); window.UI.openEditor(20)")
    pg.wait_for_function("document.body.classList.contains('adv-night')")
    pg.wait_for_selector('.adv-editor-sheet')
    check('editor has four collapsible groups', pg.locator('.adv-editor-group').count() == 4)
    pg.wait_for_function("getComputedStyle(document.querySelector('.adv-editor-sheet .adv-in1')).backgroundColor === 'rgb(43, 37, 34)'")
    colors = pg.evaluate("({bg:getComputedStyle(document.querySelector('.adv-editor-sheet')).backgroundColor, input:getComputedStyle(document.querySelector('.adv-editor-sheet .adv-in1')).backgroundColor, color:getComputedStyle(document.querySelector('.adv-editor-sheet .adv-in1')).color})")
    check('overlay editor follows dark theme', colors['bg'] == 'rgb(59, 48, 42)' and colors['input'] == 'rgb(43, 37, 34)', colors)
    ctx.close()


def test_photo_preview(browser, image):
    ctx, pg = new_page(browser)
    pg.evaluate("window.Backend.setDisplay('night'); window.UI.syncNow(); window.UI.openEditor(20)")
    pg.locator('.adv-editor-group').filter(has_text='照片与相纸').locator('summary').click()
    pg.locator('.adv-editor-sheet textarea').first.fill('MOCK-PHOTO-PREVIEW')
    pg.locator('.adv-editor-sheet input[type=file]').first.set_input_files(str(image))
    pg.wait_for_function("document.querySelector('#photoLive img')?.naturalWidth > 0")
    pg.get_by_role('button', name='预览对方视角').wait_for(state='visible')
    pg.wait_for_function("![...document.querySelectorAll('button')].find(b => b.textContent.includes('预览对方视角')).disabled")
    pg.wait_for_function("document.querySelector('#photoLive img')?.naturalWidth > 0")
    pg.locator('#asPhoto').check()
    frames = []
    for frame in ['polaroid', 'vintage', 'plain', 'postcard', 'stamp']:
        pg.locator('#photoFrame').select_option(frame)
        pg.wait_for_function("(f) => document.querySelector('#photoLive .adv-photo-front')?.classList.contains('frame-' + f)", arg=frame)
        frames.append(pg.locator('#photoLive .adv-photo-front').get_attribute('class'))
    check('five photo frames update live preview', len(set(frames)) == 5, frames)
    pg.locator('#photoFit').select_option('contain')
    pg.evaluate("document.querySelector('#photoX').value=17; document.querySelector('#photoX').dispatchEvent(new Event('input',{bubbles:true}))")
    style = pg.evaluate("({fit:document.querySelector('#photoLive img').style.objectFit,pos:document.querySelector('#photoLive img').style.objectPosition})")
    check('photo fit and focus update live preview', style['fit'] == 'contain' and style['pos'].startswith('17%'), style)
    pg.locator('#photoBack').fill('MOCK-BACK-TEXT')
    pg.get_by_role('button', name='预览对方视角').click()
    pg.wait_for_selector('#selfPreviewOverlay .adv-front')
    geometry = pg.evaluate("(() => { const o=document.getElementById('selfPreviewOverlay').getBoundingClientRect(), c=document.querySelector('#selfPreviewOverlay .adv-cardbox').getBoundingClientRect(); return {ow:o.width,oh:o.height,cx:c.left+c.width/2,cy:c.top+c.height/2,vw:innerWidth,vh:innerHeight}; })()")
    check('preview is an independent full-screen mask', abs(geometry['ow'] - geometry['vw']) < 2 and abs(geometry['oh'] - geometry['vh']) < 2, geometry)
    check('preview is centered and slightly below center', abs(geometry['cx'] - geometry['vw']/2) < 3 and 0 <= geometry['cy'] - geometry['vh']/2 <= 40, geometry)
    pg.locator('#selfPreviewOverlay .adv-front').click()
    pg.wait_for_function("document.querySelector('#selfPreviewOverlay .adv-xcard')?.classList.contains('flipped')")
    pg.wait_for_selector('#selfPreviewOverlay .adv-photo-front.frame-stamp')
    check('recipient preview uses selected frame', pg.locator('#selfPreviewOverlay .adv-photo-front.frame-stamp').count() == 1)
    with pg.expect_download() as download_info:
        pg.get_by_role('button', name='导出正面 PNG').click()
    download = download_info.value
    download_path = MOCK / 'photo-export.png'
    download.save_as(str(download_path))
    header = download_path.read_bytes()[:24]
    dimensions = struct.unpack('>II', header[16:24]) if header.startswith(b'\x89PNG\r\n\x1a\n') else (0, 0)
    check('photo PNG export preserves selected frame and dimensions', dimensions[0] >= 260 * 4 and dimensions[1] >= 190 * 4, dimensions)
    pg.locator('#selfPreviewOverlay .adv-row button').click()
    pg.wait_for_selector('#selfPreviewOverlay', state='detached')
    check('closing preview preserves editor content', pg.locator('.adv-editor-sheet textarea').first.input_value() == 'MOCK-PHOTO-PREVIEW' and pg.locator('#photoFrame').input_value() == 'stamp')
    ctx.close()


def test_editor_persistence(browser, image):
    init = """
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url).includes('open.spotify.com/oembed')
      ? Promise.resolve(new Response(JSON.stringify({title:'MOCK-SAVED-SONG',author_name:'MOCK-SAVED-ARTIST',thumbnail_url:''}),{status:200,headers:{'Content-Type':'application/json'}}))
      : originalFetch(url, options);
    """
    ctx, pg = new_page(browser, init=init)
    pg.evaluate('window.UI.openEditor(20)')
    pg.locator('.adv-editor-group').filter(has_text='一首歌').locator('summary').click()
    pg.locator('.adv-editor-group').filter(has_text='照片与相纸').locator('summary').click()
    pg.locator('.adv-editor-sheet textarea').first.fill('MOCK-SAVED-LETTER')
    pg.get_by_placeholder('歌名（可选，留空自动抓）').fill('MOCK-MANUAL-SAVED')
    pg.get_by_placeholder('https://open.spotify.com/track/… 或 https://music.163.com/song?id=…').fill('https://open.spotify.com/track/CCCCCCCCCCCCCCCCCCCCCC')
    pg.wait_for_function("document.querySelector('.adv-music-status').textContent.includes('MOCK-SAVED-ARTIST')")
    pg.locator('.adv-editor-sheet input[type=file]').first.set_input_files(str(image))
    pg.wait_for_function("![...document.querySelectorAll('button')].find(b => b.textContent.includes('预览对方视角')).disabled")
    pg.locator('#photoFrame').select_option('postcard')
    pg.locator('#photoBack').fill('MOCK-SAVED-BACK')
    pg.wait_for_function("JSON.parse(localStorage.getItem('advent-v4-draft:san:20') || '{}').assets?.image")
    pg.once('dialog', lambda dialog: dialog.accept())
    pg.get_by_role('button', name='取消').click()
    pg.wait_for_selector('.adv-editor-sheet', state='detached')
    pg.evaluate('window.UI.openEditor(20)')
    pg.locator('.adv-editor-group').filter(has_text='照片与相纸').locator('summary').click()
    pg.wait_for_function("document.querySelector('#photoLive img')?.naturalWidth > 0")
    values = {
        'letter': pg.locator('.adv-editor-sheet textarea').first.input_value(),
        'frame': pg.locator('#photoFrame').input_value(),
        'back': pg.locator('#photoBack').input_value(),
        'title': pg.get_by_placeholder('歌名（可选，留空自动抓）').input_value(),
        'artist': pg.get_by_placeholder('歌手（可选）').input_value(),
    }
    check('saved draft restores letter and manual music fields', values['letter'] == 'MOCK-SAVED-LETTER' and values['title'] == 'MOCK-MANUAL-SAVED' and values['artist'] == 'MOCK-SAVED-ARTIST', values)
    check('saved draft restores photo asset frame and back text', values['frame'] == 'postcard' and values['back'] == 'MOCK-SAVED-BACK', values)
    ctx.close()


def test_music_editor(browser):
    init = """
    window.__metaRequests = [];
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).includes('open.spotify.com/oembed')) {
        return new Promise(resolve => window.__metaRequests.push({url:String(url), resolve}));
      }
      return originalFetch(url, options);
    };
    """
    ctx, pg = new_page(browser, init=init)
    pg.evaluate('window.UI.openEditor(20)')
    pg.locator('.adv-editor-group').filter(has_text='一首歌').locator('summary').click()
    url = pg.get_by_placeholder('https://open.spotify.com/track/… 或 https://music.163.com/song?id=…')
    url.fill('https://open.spotify.com/track/AAAAAAAAAAAAAAAAAAAAAA')
    pg.wait_for_function('window.__metaRequests.length === 1')
    url.fill('https://open.spotify.com/track/BBBBBBBBBBBBBBBBBBBBBB')
    pg.get_by_placeholder('歌名（可选，留空自动抓）').fill('MOCK-MANUAL-TITLE')
    pg.wait_for_function('window.__metaRequests.length === 2')
    pg.evaluate("window.__metaRequests[1].resolve(new Response(JSON.stringify({title:'MOCK-AUTO-2',author_name:'MOCK-ARTIST-2',thumbnail_url:''}),{status:200,headers:{'Content-Type':'application/json'}}))")
    pg.wait_for_function("document.querySelector('.adv-music-status').textContent.includes('MOCK-ARTIST-2')")
    check('manual music fields have priority', pg.get_by_placeholder('歌名（可选，留空自动抓）').input_value() == 'MOCK-MANUAL-TITLE')
    check('empty music fields are auto-filled', pg.get_by_placeholder('歌手（可选）').input_value() == 'MOCK-ARTIST-2')
    pg.evaluate("window.__metaRequests[0].resolve(new Response(JSON.stringify({title:'MOCK-STALE-1',author_name:'MOCK-STALE-ARTIST'}),{status:200,headers:{'Content-Type':'application/json'}}))")
    pg.wait_for_timeout(150)
    check('late metadata responses cannot overwrite newer song', pg.get_by_placeholder('歌手（可选）').input_value() == 'MOCK-ARTIST-2' and 'MOCK-STALE' not in pg.locator('.adv-music-status').inner_text())
    url.fill('https://open.spotify.com/track/CCCCCCCCCCCCCCCCCCCCCC')
    check('URL changes clear stale automatic fields but keep manual fields', pg.get_by_placeholder('歌手（可选）').input_value() == '' and pg.get_by_placeholder('歌名（可选，留空自动抓）').input_value() == 'MOCK-MANUAL-TITLE')
    pg.route('**/api/song/detail?**', lambda route, request=None: route.fulfill(status=200, content_type='application/json', body=json.dumps({'songs': [{'name': 'MOCK-NETEASE', 'artists': [{'name': 'MOCK-N-ARTIST'}], 'album': {'name': 'MOCK-ALBUM', 'picUrl': ''}}]})))
    meta = pg.evaluate("window.AdventMusic.resolveSongMetadata('https://music.163.com/song?id=123456').then(r => r)")
    check('Netease official metadata shape is supported', meta['ok'] and meta['meta']['title'] == 'MOCK-NETEASE' and meta['meta']['album'] == 'MOCK-ALBUM', meta)
    ctx.close()
    ctx, pg = new_page(browser)
    invalid = pg.evaluate("window.AdventMusic.resolveSongMetadata('https://example.com/not-a-song').then(r => r)")
    check('unsupported music links have a clear result', not invalid['ok'] and invalid['reason'] == 'unsupported', invalid)
    pg.route('**/oembed?**', lambda route, request=None: route.abort())
    network = pg.evaluate("window.AdventMusic.resolveSongMetadata('https://open.spotify.com/track/DDDDDDDDDDDDDDDDDDDDDD').then(r => r)")
    check('music metadata network failures are explicit', not network['ok'] and network['reason'] == 'network', network)
    ctx.close()


def test_scrapbook_export(browser, image):
    ctx, pg = new_page(browser, {'width': 1280, 'height': 900})
    pg.evaluate('window.UI.openScrapbook()')
    pg.locator('#scrapTitle').fill('MOCK 圣诞手账')
    pg.locator('#scrapText').fill('MOCK 第一行。\nMOCK second line with enough text to wrap across the exported page.')
    pg.locator('[data-sticker="★"]').click()
    pg.locator('#stickerUpload').set_input_files(str(image))
    pg.wait_for_function("document.querySelector('#scrapCanvas .adv-sticker img')?.naturalWidth > 0")
    for scale in [1, 2]:
        pg.locator('#scrapExportScale').select_option(str(scale))
        with pg.expect_download(timeout=30000) as download_info:
            pg.locator('#scrapExport').click()
        download = download_info.value
        path = download.path()
        dims = png_dimensions(path)
        check(f'scrapbook {scale}x PNG has expected dimensions', dims[0] == 1200 * scale and dims[1] >= 1600 * scale, dims)
        check(f'scrapbook {scale}x PNG is nonempty', Path(path).stat().st_size > 5000, Path(path).stat().st_size)
    pg.evaluate("""() => {
      const canvas=document.getElementById('scrapCanvas');
      const bad=document.createElement('button'); bad.className='adv-sticker'; bad.dataset.src='https://example.invalid/mock-sticker.png'; bad.dataset.name='MOCK-BROKEN'; bad.dataset.opacity='1'; bad.style.left='80%'; bad.style.top='80%'; bad.style.zIndex='9'; canvas.appendChild(bad);
    }""")
    pg.locator('#scrapExport').click()
    pg.wait_for_function("document.getElementById('scrapExportStatus').textContent.includes('导出取消')")
    check('failed sticker resources abort export explicitly', 'MOCK-BROKEN' in pg.locator('#scrapExportStatus').inner_text())
    ctx.close()


def test_pat(browser):
    ctx, pg = new_page(browser)
    values = pg.evaluate("""async () => {
      window.Backend.setPat('test-token', true);
      const remembered = window.Backend.hasRememberedPat() && localStorage.getItem('advent-gh-pat-remembered') === 'test-token';
      window.Backend.setPatRemember(false);
      const forgotten = !window.Backend.hasRememberedPat() && window.Backend.hasPat();
      window.Backend.clearPat();
      return {remembered, forgotten, cleared: !window.Backend.hasPat()};
    }""")
    check('PAT remember and clear lifecycle is explicit', all(values.values()), values)
    pg.evaluate("window.Backend.hide(20, [{type:'text',text:'MOCK-PAT'}], 'lettre')")
    for status, reason, headers in [(401, 'invalid_token', {}), (403, 'permission', {}), (403, 'api_limit', {'x-ratelimit-remaining': '0'}), (429, 'api_limit', {})]:
        def fulfill(route, request=None, s=status, h=headers):
            message = 'API rate limit exceeded' if h.get('x-ratelimit-remaining') == '0' else 'mock'
            route.fulfill(status=s, headers=h, body=json.dumps({'message': message}))
        pg.route('**/repos/test/repo/contents/**', fulfill)
        pg.evaluate("window.Backend.setPat('test-token')")
        result = pg.evaluate("window.Backend.publish().then(() => ({ok:true})).catch(e => ({ok:false,reason:e.reason,message:e.message}))")
        check(f'publish classifies HTTP {status} as {reason}', not result['ok'] and result['reason'] == reason, result)
        pg.unroute('**/repos/test/repo/contents/**')
    pg.route('**/repos/test/repo/contents/**', lambda route, request=None: route.abort())
    pg.evaluate("window.Backend.setPat('test-token')")
    result = pg.evaluate("window.Backend.publish().then(() => ({ok:true})).catch(e => ({ok:false,reason:e.reason}))")
    check('publish classifies network failure', result.get('reason') == 'network', result)
    ctx.close()


def main():
    setup_fiction()
    image = png(MOCK / 'mock-image.png')
    name = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
    with sync_playwright() as p:
        browser = getattr(p, name).launch(executable_path=os.environ.get(f'ADVENT_{name.upper()}_EXECUTABLE') or None)
        for test in [test_stats, test_theme_layout, lambda b: test_photo_preview(b, image), lambda b: test_editor_persistence(b, image), test_music_editor, lambda b: test_scrapbook_export(b, image), test_pat]:
            test(browser)
        browser.close()
    passed = sum(ok for _, ok, _ in RESULTS)
    print(f'\n===== {name}: {passed}/{len(RESULTS)} PASS =====')
    if passed != len(RESULTS):
        print('FAILED:', [name for name, ok, _ in RESULTS if not ok])
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
