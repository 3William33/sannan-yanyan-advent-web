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
                for trigger, expected in [('#deskNote','.adv-today-note'),('#deskPhoto','.adv-frame-photo-card'),('#deskMail','.adv-post-summary'),('#deskRecord','.adv-record-player')]:
                    page.locator(trigger).click(); page.wait_for_timeout(50)
                    assert page.locator(expected).is_visible(), f'{trigger} panel failed'
                    page.locator('.adv-sheet .adv-row .adv-btn', has_text='关上').click()
            assert not errors, errors
            if engine_name == 'chromium' and (width,height) in ((1440,900),(1024,768),(390,844)):
                page.screenshot(path=str(OUT/f'v4-{width}x{height}.png'), full_page=True)
            context.close()
        browser.close()
        print(f'PASS {engine_name}')
