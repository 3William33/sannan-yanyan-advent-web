#!/usr/bin/env python3
"""build_builtin.py — 从原版 advent_game.py 提取砚砚内置礼物并混淆为 web/builtin-gifts.js

- 用 AST 提取 YAN_GIFTS 字面量，不执行原脚本、不打印任何礼物内容
- 混淆算法与 advent-gifts-v3.2 协议一致：SHA-256(key) 作 XOR 流 + Base64
- 输出文件只包含 Base64 混淆数据，明文不会进入公开仓库
- 用法: python3 tools/build_builtin.py <原版advent_game.py路径> <输出js路径> <密钥>
"""
import ast
import base64
import hashlib
import json
import sys
from pathlib import Path


def xor_bytes(data: bytes, key: str) -> bytes:
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return bytes(v ^ digest[i % len(digest)] for i, v in enumerate(data))


def encode(value, key: str) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(xor_bytes(raw, key)).decode("ascii")


def extract_yan_gifts(source: Path) -> dict:
    tree = ast.parse(source.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "YAN_GIFTS":
            return ast.literal_eval(node.value)
    raise SystemExit("YAN_GIFTS not found in source")


def main() -> None:
    src, dst, key = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    gifts = extract_yan_gifts(src)
    days = {}
    for day in range(1, 26):
        gift = gifts.get(day)
        if gift is not None:
            days[str(day)] = encode(gift, key)

    lines = ",\n".join(f'  "{d}": "{p}"' for d, p in days.items())
    out = (
        "/**\n"
        " * builtin-gifts.js — 砚砚内置礼物（由 tools/build_builtin.py 自动生成，请勿手工编辑）\n"
        " *\n"
        " * 内容按 advent-gifts-v3.2 协议的 XOR + Base64 方式混淆，与远程 gifts.json 相同级别；\n"
        " * 仅在对应日期解锁后按天解码，页面上不会提前展开。\n"
        " * 这只是防意外剧透的混淆，不是加密——与原版数据仓库中的 gifts.json 一致。\n"
        " */\n"
        "export const BUILTIN_DAYS = {\n"
        f"{lines},\n"
        "};\n"
    )
    dst.write_text(out, encoding="utf-8")
    print(f"OK: {dst} ({len(days)} days encrypted, plaintext never printed)")


if __name__ == "__main__":
    main()
