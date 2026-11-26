#!/usr/bin/env python3
"""mock_data.py — 生成虚构测试数据（绝不使用真实礼物内容）"""
import base64
import hashlib
import json
import os
import sys

YAN_DIGEST = bytes.fromhex('b52854d482f1040024bf2db8734b74ac60bb43bcb26c37170986ec673214757f')
SAN_DIGEST = bytes.fromhex('eb135c1744d756e7bca04f630db146419c5fd039b4f9ec76c54dffcabceaa771')


def encode(value, digest):
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return base64.b64encode(bytes(v ^ digest[i % len(digest)] for i, v in enumerate(raw))).decode('ascii')


def wrapper(value, digest):
    return {
        'version': 2,
        'updated_at': '2026-11-20T12:00:00+08:00',
        'protocol': 'advent-gifts-v3.2',
        'payload': encode(value, digest),
    }


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)

    yan = {'days': {
        '3': [{'id': 'mock-yan-3-a', 'from': '砚砚', 'title': 'MOCK-礼物甲',
               'kind': 'letter', 'text': 'MOCK-虚构正文甲，仅用于自动化测试。',
               'items_v2': [{'type': 'text', 'text': 'MOCK-虚构正文甲，仅用于自动化测试。'}],
               'created_at': '2026-11-20T12:00:00+08:00', 'at': '2026-11-20T12:00:00+08:00'}],
        '5': [{'id': 'mock-yan-5-a', 'from': '砚砚', 'title': 'MOCK-礼物乙',
               'kind': 'question', 'text': 'MOCK-虚构问题乙',
               'items_v2': [{'type': 'text', 'text': 'MOCK-虚构问题乙'},
                            {'type': 'question', 'text': 'MOCK-虚构问题乙'}],
               'created_at': '2026-11-20T12:01:00+08:00', 'at': '2026-11-20T12:01:00+08:00'}],
    }}
    san = {'days': {
        '5': [{'id': 'mock-san-5-a', 'from': '三三', 'title': 'MOCK-礼物丙',
               'kind': 'letter', 'text': 'MOCK-虚构正文丙',
               'items_v2': [{'type': 'text', 'text': 'MOCK-虚构正文丙'}],
               'created_at': '2026-11-20T12:02:00+08:00', 'at': '2026-11-20T12:02:00+08:00'}],
    }}

    with open(f'{out_dir}/gifts.json', 'w') as f:
        json.dump(wrapper(yan, YAN_DIGEST), f, ensure_ascii=False)
    with open(f'{out_dir}/sannan_gifts.json', 'w') as f:
        json.dump(wrapper(san, SAN_DIGEST), f, ensure_ascii=False)
    with open(f'{out_dir}/gift_index_yanyan.json', 'w') as f:
        json.dump({'version': 1, 'author': 'yan', 'updated_at': '2026-11-20T12:00:00+08:00',
                   'days': {'3': [{'id': 'mock-yan-3-a', 'created_at': '2026-11-20T12:00:00+08:00'}]}}, f)
    with open(f'{out_dir}/gift_index_sannan.json', 'w') as f:
        json.dump({'version': 1, 'author': 'san', 'updated_at': '2026-11-20T12:00:00+08:00',
                   'days': {'5': [{'id': 'mock-san-5-a', 'created_at': '2026-11-20T12:02:00+08:00'}]}}, f)
    with open(f'{out_dir}/peek_log.json', 'w') as f:
        json.dump({'version': 2, 'updated_at': '2026-11-20T12:00:00+08:00',
                   'events': [{'id': 'mock-peek-1', 'who': 'yan', 'day': 2,
                               'peeked_at': '2026-11-20T12:00:00+08:00',
                               'at': '2026-11-20T12:00:00+08:00', 'outcome': 'attempt'}]}, f)
    with open(f'{out_dir}/companion_state.json', 'w') as f:
        json.dump({'version': 1, 'updated_at': '2026-11-20T12:00:00+08:00',
                   'protocol': 'advent-companion-v1',
                   'payload': encode({'notes': {}, 'frames': {}, 'favorites': {}}, SAN_DIGEST)}, f)
    print('mock data written to', out_dir)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/mockdata')
