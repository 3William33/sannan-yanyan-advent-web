#!/usr/bin/env python3
"""V4 layout smoke tests. Uses no remote or real gift data."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE = os.environ.get('ADVENT_SITE', 'http://127.0.0.1:8024/')
OUT = Path(__file__).resolve().parents[1] / 'docs' / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
VIEWPORTS = [(1920,1080),(1440,900),(1366,768),(1024,768),(768,1024),(744,1133),(1133,744),(390,844)]

with sync_playwright() as p:
    for engine_name in ('chromium', 'webkit'):
        engine = getattr(p, engine_name)
        try:
            browser = engine.launch()
        except Exception as exc:
            print(f'SKIP {engine_name}: {exc}')
            continue
        for width, height in VIEWPORTS:
            context = browser.new_context(viewport={'width':width,'height':height}, has_touch=width<=1024)
            page = context.new_page()
            page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
            page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
            page.route('https://raw.githubusercontent.com/**', lambda r: r.abort())
            page.clock.set_fixed_time('2026-11-28T10:00:00+08:00')
            errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(SITE, wait_until='domcontentloaded'); page.wait_for_timeout(500)
            overflow = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
            assert not overflow, f'horizontal overflow {engine_name} {width}x{height}'
            if width >= 760 and width > height:
                assert page.locator('#desk').is_visible(), f'desk hidden {width}x{height}'
                page.locator('#deskDiary').click(); page.wait_for_timeout(100)
                assert page.locator('#scrapCanvas').is_visible()
                assert page.locator('.adv-zoom.on').count() == 1
                page.locator('#scrapClose').click()
                for trigger, expected, close_label in [('#deskNote','.adv-today-note','关上'),('#deskPhoto','.adv-frame-photo-card','关上'),('#deskMail','.adv-post-summary','离开邮局'),('#deskRecord','.adv-record-player','关上')]:
                    page.locator(trigger).click(); page.wait_for_timeout(50)
                    assert page.locator(expected).is_visible(), f'{trigger} panel failed'
                    page.locator('.adv-sheet .adv-row .adv-btn', has_text=close_label).click()
            assert not errors, errors
            if engine_name == 'chromium' and (width,height) in ((1440,900),(1024,768),(390,844)):
                page.screenshot(path=str(OUT/f'v4-{width}x{height}.png'), full_page=True)
            context.close()
        if engine_name == 'chromium':
            context=browser.new_context(viewport={'width':1280,'height':800});page=context.new_page();page.clock.set_fixed_time('2026-12-07T10:00:00+08:00');page.goto(SITE,wait_until='domcontentloaded');page.wait_for_timeout(300)
            result=page.evaluate('''() => {
              const safe='https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/test/example.webp';
              Backend.hide(7,[
                {type:'photo',photo:{front:{url:safe,frame:'polaroid',positionX:999},back:{text:'测试背面'}}},
                {type:'comic',comic:{mode:'spread',pages:[{url:safe,alt:'测试页'}]}},
                {type:'scrapbook',layout:{title:'测试手账',text:'虚构正文',paper:'grid',stickers:[{char:'★',x:150,y:-2,scale:9}]}}
              ],'dessin');
              const s=JSON.parse(localStorage.getItem('advent-web-save-v1'));const items=s.human_gifts['7'][0].items_v2;
              let rejected=false;try{Backend.hide(7,[{type:'photo',photo:{front:{url:'javascript:alert(1)'}}}],'dessin');}catch{rejected=true;}
              return {items,rejected};
            }''')
            assert [x['type'] for x in result['items']]==['photo','comic','scrapbook']
            assert result['items'][0]['photo']['front']['positionX']==100
            assert result['items'][2]['layout']['stickers'][0]['x']==100
            assert result['rejected']
            context.close()
        browser.close()
        print(f'PASS {engine_name}')
