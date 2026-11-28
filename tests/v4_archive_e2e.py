#!/usr/bin/env python3
"""V4 collection, post-office and write-permission tests using fictional data only."""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.mockdata'
GH = ROOT / '.mockgh'
SITE = 'http://127.0.0.1:8024/'
MOCK = 'http://127.0.0.1:8025/data'
results = []


def check(name, condition, detail=''):
    results.append((name, bool(condition), detail))
    print(f"{'PASS' if condition else 'FAIL'} | {name}" + (f' | {detail}' if detail and not condition else ''))


def prepare_data():
    shutil.rmtree(DATA, ignore_errors=True)
    shutil.rmtree(GH, ignore_errors=True)
    subprocess.run([sys.executable, str(ROOT / 'tests/mock_data.py'), str(DATA)], check=True, stdout=subprocess.DEVNULL)
    sys.path.insert(0, str(ROOT / 'tests'))
    from mock_data import YAN_DIGEST, wrapper
    gifts = json.loads((DATA / 'gifts.json').read_text(encoding='utf-8'))
    raw = bytes(value ^ YAN_DIGEST[i % len(YAN_DIGEST)] for i, value in enumerate(__import__('base64').b64decode(gifts['payload'])))
    decoded = json.loads(raw.decode('utf-8'))
    decoded['days']['20'] = [{
        'id': 'mock-yan-20-a', 'from': '砚砚', 'title': 'MOCK-未来礼物',
        'kind': 'letter', 'text': 'MOCK-SECRET-20',
        'items_v2': [{'type': 'text', 'text': 'MOCK-SECRET-20'}],
        'created_at': '2026-11-20T12:00:00+08:00',
    }]
    (DATA / 'gifts.json').write_text(json.dumps(wrapper(decoded, YAN_DIGEST), ensure_ascii=False), encoding='utf-8')
    event = {
        'event_id': 'mock-event-yan-20', 'actor_id': 'yan', 'actor_name': '砚砚',
        'event_type': 'create', 'gift_id': 'mock-yan-20-a', 'gift_date': 20,
        'gift_type': 'text', 'title': 'MOCK-未来礼物', 'created_at': '2026-11-21T09:00:00+08:00',
    }
    (DATA / 'gift_events.json').write_text(json.dumps({'version': 1, 'events': [event], 'read_cursors': {'san': '', 'yan': ''}, 'read_event_ids': []}, ensure_ascii=False), encoding='utf-8')


def open_page(browser, when, writer=''):
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**fonts.googleapis.com/**', lambda route: route.abort())
    page.route('**fonts.gstatic.com/**', lambda route: route.abort())
    page.clock.set_fixed_time(when)
    writer_query = f'&writer={writer}' if writer else ''
    page.goto(f'{SITE}?data={MOCK}&ghapi=http://127.0.0.1:8026/repos/mock/mock/contents/{writer_query}', wait_until='domcontentloaded')
    page.wait_for_timeout(1000)
    return context, page, errors


def main():
    prepare_data()
    servers = [
        subprocess.Popen([sys.executable, '-m', 'http.server', '8024', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
        subprocess.Popen([sys.executable, str(ROOT / 'tests/mock_server.py'), str(DATA), str(GH)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
        subprocess.Popen([sys.executable, str(ROOT / 'tests/mock_server.py'), str(DATA), str(GH)], env={**os.environ, 'MOCK_GH': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    ]
    time.sleep(1.5)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context, page, errors = open_page(browser, '2026-12-05T10:00:00+08:00')
            check('V4-A1 页面无脚本错误', not errors, str(errors[:3]))
            event_source = page.evaluate('Backend.getBoard().sync.sources.gift_events')
            check('V4-A2 活动源同步成功', bool(event_source and event_source['state'] == 'succeeded'), str(event_source))
            check('V4-A3 收到一条对方未读活动', page.evaluate('Backend.getBoard().post_office.unread_count') == 1, str(page.evaluate('Backend.getBoard().post_office')))

            created = page.evaluate('''() => {
              const beforeEvents = Backend.getBoard().post_office.events.length;
              const first = Backend.hide(20, [{type:'text',text:'MOCK-OWN-20'}], 'lettre', {title:'MOCK-我的二十日礼物'});
              const second = Backend.hide(20, [{type:'text',text:'MOCK-OWN-20-B'}], 'lettre', {title:'MOCK-同日第二份'});
              let invalidRejected = false, foreignRejected = false;
              try { Backend.hide(26, [{type:'text',text:'bad'}]); } catch { invalidRejected = true; }
              try { Backend.updateGift(3, 'mock-yan-3-a', [{type:'text',text:'bad'}]); } catch { foreignRejected = true; }
              const firstDay = Backend.hide(1, [{type:'text',text:'MOCK-OWN-1'}], 'lettre', {title:'MOCK-一日礼物'});
              const lastDay = Backend.hide(25, [{type:'text',text:'MOCK-OWN-25'}], 'lettre', {title:'MOCK-二十五日礼物'});
              Backend.updateGift(1, firstDay.id, [{type:'text',text:'MOCK-OWN-1-EDITED'}], {title:'MOCK-一日已编辑'});
              Backend.updateGift(25, lastDay.id, [{type:'text',text:'MOCK-OWN-25-EDITED'}], {title:'MOCK-二十五日已编辑'});
              Backend.deleteGift(1, firstDay.id);
              Backend.deleteGift(25, lastDay.id);
              Backend.updateGift(20, first.id, [{type:'text',text:'MOCK-OWN-20-EDITED'}], {title:'MOCK-已编辑标题'});
              Backend.deleteGift(20, second.id);
              return {first:first.id, second:second.id, invalidRejected, foreignRejected, eventDelta:Backend.getBoard().post_office.events.length-beforeEvents};
            }''')
            check('V4-A4 非法日期26日新增被写入层拒绝', created['invalidRejected'])
            check('V4-A5 对方礼物修改被写入层拒绝', created['foreignRejected'])
            check('V4-A6 同日多份不互相覆盖', page.evaluate('Backend.getBoard().collection.days[19].gifts.filter(g=>g.own).length') == 1)
            event_types = page.evaluate('Backend.getBoard().post_office.events.map(e=>e.event_type)')
            check('V4-A7 成功操作生成对应事件', all(event_types.count(kind) >= 1 for kind in ['create','update','delete']), str(event_types))
            check('V4-A7b 封箱前1/25日可增改删且失败操作不生成成功事件', created['eventDelta'] == 10, str(created['eventDelta']))
            check('V4-A8 删除礼物已从权威列表移除', created['second'] not in page.evaluate('Backend.getBoard().collection.days.flatMap(d=>d.gifts.map(g=>g.id))'))

            page.evaluate('UI.openCollection()')
            page.get_by_label('礼物日期').select_option('20')
            page.evaluate("document.querySelector('.adv-archive-day').open=true")
            page.screenshot(path=str(ROOT / 'docs/screenshots/v4-collection-desktop.png'))
            page.locator('.adv-archive-day').get_by_text('MOCK-已编辑标题', exact=True).click()
            check('V4-A9 收藏馆复用渲染且显示编辑结果', page.locator('.adv-archive-gift-detail').get_by_text('MOCK-OWN-20-EDITED', exact=True).count() == 1)
            page.get_by_role('button', name='编辑这份礼物').click()
            check('V4-A10 编辑器正确回填标题与正文', page.locator('.adv-editor-sheet input[placeholder="给这份礼物一个容易认出的标题"]').input_value() == 'MOCK-已编辑标题' and 'MOCK-OWN-20-EDITED' in page.locator('.adv-editor-sheet textarea').first.input_value())
            editor_box = page.locator('.adv-editor-sheet').bounding_box()
            check('V4-A11 桌面编辑器宽度符合 680—760', 680 <= editor_box['width'] <= 760, str(editor_box))
            page.get_by_role('button', name='取消', exact=True).click()

            page.evaluate('''() => Backend.hide(20, [{type:'photo',photo:{front:{url:'https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/sannan/mock.png',frame:'vintage',fit:'contain',positionX:37,positionY:61,title:'MOCK 照片'},back:{text:'MOCK 背面'}}}], 'lettre', {title:'MOCK 照片回填'})''')
            page.evaluate('UI.openCollection()')
            page.get_by_label('礼物日期').select_option('20')
            page.locator('.adv-archive-gift-summary').filter(has_text='MOCK 照片回填').click()
            page.get_by_role('button', name='编辑这份礼物').click()
            photo_refill = page.evaluate('''() => ({checked:document.querySelector('#asPhoto').checked,frame:document.querySelector('#photoFrame').value,fit:document.querySelector('#photoFit').value,x:document.querySelector('#photoX').value,y:document.querySelector('#photoY').value,title:document.querySelector('#photoTitle').value,back:document.querySelector('#photoBack').value,attachmentGroup:document.querySelector('.adv-attachment-info')?.closest('.adv-editor-group')?.querySelector('summary')?.textContent})''')
            check('V4-A11b 照片与附件编辑器回填无脚本错误', not errors and photo_refill['checked'] and photo_refill['frame']=='vintage' and photo_refill['fit']=='contain' and photo_refill['x']=='37' and photo_refill['y']=='61' and photo_refill['title']=='MOCK 照片' and photo_refill['back']=='MOCK 背面' and '附件与声音' in (photo_refill['attachmentGroup'] or ''), str(photo_refill))
            page.get_by_role('button', name='取消', exact=True).click()

            page.evaluate('UI.openCollection()')
            page.get_by_label('礼物日期').select_option('20')
            page.evaluate("document.querySelector('.adv-archive-day').open=true")
            page.locator('.adv-archive-gift-summary').filter(has_text='MOCK-未来礼物').click()
            check('V4-A12 未解锁对方礼物不展示正文或附件', 'MOCK-SECRET-20' not in page.locator('.adv-archive-gift-detail:not([hidden])').inner_text())
            check('V4-A13 浏览收藏馆不增加开启或偷看', page.evaluate('Backend.getBoard().cells[19].lit') is False and page.evaluate('Backend.getBoard().peeks') == 1)
            page.get_by_role('button', name='关闭收藏馆').click()

            page.evaluate('UI.openPostOffice()')
            check('V4-A14 邮局统计来自真实事件', page.locator('.adv-post-summary').get_by_text('近 7 天新增', exact=False).count() == 1)
            mixed_time_order = page.evaluate('''async () => {
              const {mergeGiftEvents} = await import('./backend.js?v=8.2.1');
              const base = {actor_id:'yan', actor_name:'砚砚', event_type:'create', gift_id:'mock-time', gift_date:20, gift_type:'text', title:'MOCK'};
              return mergeGiftEvents([
                {...base, event_id:'offset-earlier', created_at:'2026-12-05T09:00:00+08:00'},
                {...base, event_id:'utc-later', created_at:'2026-12-05T02:00:00Z'}
              ]).map(event => event.event_id);
            }''')
            check('V4-A14c 混合时区活动按真实操作时间排序', mixed_time_order == ['offset-earlier','utc-later'], str(mixed_time_order))
            check('V4-A14b 首页邮局显示真实投递摘要', '总 ' in page.locator('#deskMailStatus').inner_text() and '砚 ' in page.locator('#deskMailStatus').inner_text() and '三 ' in page.locator('#deskMailStatus').inner_text() and '近7天' in page.locator('#deskMailLatest').inner_text())
            check('V4-A15 邮局事件不包含礼物正文', 'MOCK-SECRET-20' not in page.locator('.adv-post-office').inner_text() and 'MOCK-OWN-20-EDITED' not in page.locator('.adv-post-office').inner_text())
            page.get_by_label('操作日期从').fill('2026-11-21')
            page.get_by_label('操作日期到').fill('2026-11-21')
            check('V4-A15b 邮局支持北京时间操作日期范围', page.locator('.adv-post-event').count() == 1 and 'MOCK-未来礼物' in page.locator('.adv-post-event').inner_text())
            page.get_by_label('操作日期从').fill('')
            page.get_by_label('操作日期到').fill('')
            page.get_by_role('button', name='全部标为已读').click()
            check('V4-A16 全部已读持久化', page.evaluate('Backend.getBoard().post_office.unread_count') == 0)
            page.reload(wait_until='domcontentloaded'); page.wait_for_timeout(900)
            check('V4-A17 刷新后已读状态不丢失', page.evaluate('Backend.getBoard().post_office.unread_count') == 0, str(page.evaluate("({post:Backend.getBoard().post_office,saved:JSON.parse(localStorage.getItem('advent-web-save-v1')).gift_events})")))
            page.evaluate('UI.openPostOffice()')
            page.get_by_label('操作日期从').fill('2026-11-21')
            page.get_by_label('操作日期到').fill('2026-11-21')
            page.locator('.adv-post-event').click()
            check('V4-A17b 通知跳转日期且不绕过解锁', page.get_by_label('礼物日期').input_value() == '20' and 'MOCK-SECRET-20' not in page.locator('.adv-archive-sheet').inner_text())
            page.get_by_role('button', name='关闭收藏馆').click()

            first_open = page.evaluate('''() => {
              Backend.touch(1); Backend.touch(1);
              return Backend.getBoard().post_office.events.filter(e=>e.event_type==='open'&&e.gift_id==='builtin-yan-1').length;
            }''')
            check('V4-A18 重复开盒不重复记录正式开启', first_open == 1, str(first_open))

            publish = page.evaluate('''async () => { Backend.setPat('test-token'); return Backend.publish(); }''')
            event_file = GH / 'gift_events.json'
            check('V4-A19 发布成功', '已发布' in publish['message'], publish['message'])
            check('V4-A20 活动日志独立持久化', event_file.exists())
            event_text = event_file.read_text(encoding='utf-8') if event_file.exists() else ''
            check('V4-A21 活动文件不含正文附件', 'MOCK-OWN-20-EDITED' not in event_text and 'MOCK-SECRET-20' not in event_text)
            check('V4-A22 发布返回封存事件', page.evaluate("Backend.getBoard().post_office.events.some(e=>e.event_type==='seal')"))

            page.clock.set_fixed_time('2026-12-24T10:00:00+08:00')
            ending = page.evaluate('''() => {
              const first = Backend.hide(1,[{type:'text',text:'MOCK-ENDING-1'}],'lettre',{title:'MOCK 圣诞前夕一日礼物'});
              const last = Backend.hide(25,[{type:'text',text:'MOCK-ENDING-25'}],'lettre',{title:'MOCK 圣诞前夕二十五日礼物'});
              Backend.updateGift(1, first.id, [{type:'text',text:'MOCK-ENDING-1-EDITED'}]);
              let invalid = false;
              try { Backend.hide(26,[{type:'text',text:'bad'}]); } catch { invalid = true; }
              return {first:first.id,last:last.id,invalid,rules:Backend.calendarRules()};
            }''')
            check('V4-A22b 12月24日仍可整理自己未封存的过去和25日礼物', ending['invalid'] and ending['rules']['canCreate'] and ending['rules']['maxDay'] == 25, str(ending['rules']))

            page.clock.set_fixed_time('2026-12-26T10:00:00+08:00')
            archived = page.evaluate('''endingId => {
              let create=false, update=false, remove=false;
              try { Backend.hide(1,[{type:'text',text:'bad'}]); } catch { create=true; }
              try { Backend.updateGift(1, endingId, [{type:'text',text:'bad'}]); } catch { update=true; }
              try { Backend.deleteGift(1, endingId); } catch { remove=true; }
              return {create,update,remove,rules:Backend.calendarRules()};
            }''', ending['first'])
            check('V4-A23 12月26日后新增修改删除全部只读', all(archived[key] for key in ['create','update','remove']), str(archived))
            check('V4-A24 归档阶段仍保留完整时间线', page.evaluate('Backend.getBoard().post_office.events.length') > 0)

            page.clock.set_fixed_time('2026-12-05T10:00:00+08:00')
            page.evaluate('''async () => { Backend.hide(21,[{type:'text',text:'MOCK-SAN-SYNC'}],'lettre',{title:'MOCK 三三同步礼物'}); Backend.setPat('test-token'); await Backend.publish(); }''')
            yan_context, yan_page, yan_errors = open_page(browser, '2026-12-05T10:00:00+08:00', 'yan')
            check('V4-D1 砚砚写入身份与偷看记名独立', yan_page.evaluate("Backend.getWriter()==='yan' && Backend.getWho()==='san'"))
            check('V4-D2 双方未读状态独立', yan_page.evaluate('Backend.getBoard().post_office.unread_count') > 0 and page.evaluate('Backend.getBoard().post_office.unread_count') == 0)
            check('V4-D3 对方已发布礼物同步且不可修改', yan_page.evaluate("Backend.getBoard().collection.days[20].gifts.some(g=>g.title==='MOCK 三三同步礼物'&&!g.own&&!g.can_edit)") and yan_page.evaluate("(() => {try {Backend.updateGift(21,Backend.getBoard().collection.days[20].gifts.find(g=>g.title==='MOCK 三三同步礼物').id,[{type:'text',text:'bad'}]);return false;}catch{return true;}})()"))
            yan_page.evaluate('UI.openEditor(20)')
            check('V4-D4 编辑器与预览使用砚砚身份', '写给三三的话' in yan_page.locator('.adv-editor-sheet').inner_text())
            yan_page.locator('.adv-editor-sheet textarea').first.fill('MOCK-YAN-PREVIEW')
            yan_page.get_by_role('button', name='预览对方视角').click()
            yan_page.wait_for_timeout(100)
            check('V4-D5 对方视角预览不显示三三署名或记忆操作', 'de la part de 砚砚' in yan_page.locator('#selfPreviewOverlay').inner_text() and yan_page.locator('#selfPreviewOverlay .adv-memory-actions').count() == 0, str(yan_errors[:3]))
            yan_page.locator('#selfPreviewOverlay .adv-front').click()
            yan_page.locator('#selfPreviewOverlay').get_by_role('button', name='关上').click()
            yan_page.get_by_role('button', name='取消', exact=True).click()
            yan_created = yan_page.evaluate('''() => {const gift=Backend.hide(20,[{type:'text',text:'MOCK-YAN-OWN-SECRET'}],'lettre',{title:'MOCK 砚砚自己的礼物'});return {id:gift.id,read:Backend.readGiftContent(20,gift.id).human_entries[0].text};}''')
            check('V4-D6 砚砚可读自己未解锁礼物', yan_created['read'] == 'MOCK-YAN-OWN-SECRET')
            yan_edges = yan_page.evaluate('''() => {
              const first = Backend.hide(1,[{type:'text',text:'MOCK-YAN-EDGE-1'}],'lettre',{title:'MOCK 砚砚一日礼物'});
              const last = Backend.hide(25,[{type:'text',text:'MOCK-YAN-EDGE-25'}],'lettre',{title:'MOCK 砚砚二十五日礼物'});
              Backend.updateGift(1, first.id, [{type:'text',text:'MOCK-YAN-EDGE-1-EDITED'}]);
              Backend.updateGift(25, last.id, [{type:'text',text:'MOCK-YAN-EDGE-25-EDITED'}]);
              Backend.deleteGift(1, first.id);
              Backend.deleteGift(25, last.id);
              let invalid = false;
              try { Backend.hide(26,[{type:'text',text:'bad'}]); } catch { invalid = true; }
              return {invalid};
            }''')
            check('V4-D6b 砚砚同样可增改删1/25日未封存礼物', yan_edges['invalid'])
            yan_page.evaluate('''async () => {Backend.setPat('test-token');await Backend.publish();Backend.markEventsRead(true);await Backend.publish();}''')
            yan_page.evaluate('Backend.sync()')
            check('V4-D7 砚砚礼物发布到独立仓库文件', yan_page.evaluate("Backend.getBoard().collection.days[19].gifts.some(g=>g.id==='"+yan_created['id']+"'&&g.sealed)"))
            page.evaluate('Backend.sync()')
            check('V4-D8 双人礼物与已读状态双向同步', page.evaluate("Backend.getBoard().collection.days[19].gifts.some(g=>g.title==='MOCK 砚砚自己的礼物'&&!g.own)") and page.evaluate("JSON.parse(localStorage.getItem('advent-web-save-v1')).gift_events.read_event_ids.yan.length") > 0)
            yan_context.close()
            context.close()

            context, page, errors = open_page(browser, '2026-12-05T10:00:00+08:00')
            viewports = [(1920,1080),(1366,768),(1024,768),(768,1024),(390,844)]
            layout_results = []
            for width,height in viewports:
                page.set_viewport_size({'width':width,'height':height})
                page.evaluate('UI.openCollection()')
                layout = page.evaluate('''() => {const sheet=document.querySelector('.adv-archive-sheet').getBoundingClientRect();const grid=getComputedStyle(document.querySelector('.adv-archive-layout'));return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,sheet:{left:sheet.left,right:sheet.right,width:sheet.width,height:sheet.height},display:grid.display,columns:grid.gridTemplateColumns,viewport:{width:innerWidth,height:innerHeight}};}''')
                layout_results.append((width,height,layout))
                page.get_by_role('button', name='关闭收藏馆').click()
            ornaments = page.evaluate('''() => {
              const pine = document.querySelector('.adv-pine');
              const bells = document.querySelector('.adv-bells');
              const house = document.querySelector('.adv-house');
              return {direct:pine.parentElement.classList.contains('adv-stage') && bells.parentElement.classList.contains('adv-stage'), z: [Number(getComputedStyle(pine).zIndex),Number(getComputedStyle(bells).zIndex),Number(getComputedStyle(house).zIndex)]};
            }''')
            check('V4-A24b 松果与铃铛为舞台同级且位于房屋上层', ornaments['direct'] and ornaments['z'][0] > ornaments['z'][2] and ornaments['z'][1] > ornaments['z'][2], str(ornaments))
            page.locator('.adv-pine').click(); page.locator('.adv-bells').click()
            check('V4-A24c 松果与铃铛连续点击无脚本错误', not errors, str(errors))
            check('V4-A25 五种视口收藏馆无横向溢出', all(not item[2]['overflow'] and item[2]['sheet']['left'] >= 0 and item[2]['sheet']['right'] <= item[0] + 1 and item[2]['sheet']['height'] <= item[1] * .89 for item in layout_results), str(layout_results))
            check('V4-A26 桌面双栏与移动单栏响应式', layout_results[0][2]['display'] == 'grid' and layout_results[0][2]['columns'].count(' ') >= 1 and layout_results[-1][2]['display'] == 'block', str([(item[0],item[2]['display'],item[2]['columns']) for item in layout_results]))
            page.set_viewport_size({'width':390,'height':844})
            page.locator('#displayBtn').click(); page.locator('#displayBtn').click()
            page.evaluate('UI.openEditor(20)')
            editor_mobile = page.locator('.adv-editor-sheet').bounding_box()
            check('V4-A27 移动编辑器不超过视口宽度与高度', editor_mobile['width'] <= 390 and editor_mobile['height'] <= 844 * .89, str(editor_mobile))
            page.screenshot(path=str(ROOT / 'docs/screenshots/v4-editor-mobile-night.png'))
            page.get_by_role('button', name='取消', exact=True).click()
            page.evaluate('UI.openPostOffice()')
            post_mobile = page.locator('.adv-post-office').bounding_box()
            check('V4-A28 移动邮局主题继承且无纯白底', post_mobile['width'] <= 390 and page.locator('body').evaluate("el=>el.classList.contains('adv-night')") and page.locator('.adv-post-office').evaluate("el=>getComputedStyle(el).backgroundColor") != 'rgb(255, 255, 255)')
            page.screenshot(path=str(ROOT / 'docs/screenshots/v4-post-office-mobile-night.png'))
            context.close()

            prep_san, prep_san_page, _ = open_page(browser, '2026-11-28T10:00:00+08:00')
            prep_yan, prep_yan_page, _ = open_page(browser, '2026-11-28T10:00:00+08:00', 'yan')
            prep_san_result = prep_san_page.evaluate('''async () => {const gift=Backend.hide(22,[{type:'text',text:'MOCK-PREP-SAN'}],'lettre',{title:'MOCK 封箱前未来三三'});Backend.setPat('test-token');await Backend.publish();return gift.id;}''')
            prep_yan_result = prep_yan_page.evaluate('''async () => {const gift=Backend.hide(22,[{type:'text',text:'MOCK-PREP-YAN'}],'lettre',{title:'MOCK 封箱前未来砚砚'});Backend.setPat('test-token');await Backend.publish();return gift.id;}''')
            prep_san.close(); prep_yan.close()
            dec_san, dec_san_page, _ = open_page(browser, '2026-12-01T00:00:00+08:00')
            dec_yan, dec_yan_page, _ = open_page(browser, '2026-12-01T00:00:00+08:00', 'yan')
            check('V4-P1 11月30日前双方可追加未来日期', prep_san_result.startswith('san-') and prep_yan_result.startswith('yan-'))
            check('V4-P2 12月1日首次同步仍保留未来追加', dec_yan_page.evaluate("Backend.getBoard().collection.days[21].gifts.some(g=>g.title==='MOCK 封箱前未来砚砚')") and dec_san_page.evaluate("Backend.getBoard().collection.days[21].gifts.some(g=>g.title==='MOCK 封箱前未来三三')"))
            dec_san.close(); dec_yan.close()

            if not errors:
                pass
            browser.close()
            try:
                webkit = playwright.webkit.launch()
            except Exception as exc:
                print('SKIP webkit:', exc)
            else:
                context, page, errors = open_page(webkit, '2026-12-05T10:00:00+08:00')
                page.evaluate('UI.openPostOffice()')
                check('V4-W1 WebKit 邮局可用且无脚本错误', not errors and page.locator('.adv-post-event').count() > 0, str(errors[:3]))
                context.close(); webkit.close()
    finally:
        for server in servers:
            server.terminate()
        for server in servers:
            try: server.wait(timeout=3)
            except subprocess.TimeoutExpired: server.kill()
    failed = [item for item in results if not item[1]]
    print(f'\n{len(results)-len(failed)}/{len(results)} passed')
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
