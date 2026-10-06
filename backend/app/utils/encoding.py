"""
Utility to detect and repair CP437/Mojibake corrupted Gujarati strings.
In Windows environments or misconfigured terminal pipelines, UTF-8 bytes for
Gujarati characters (0xE0 0xAA 0xXX) often get erroneously decoded as CP437,
resulting in strings like 'α¬¼α¬╛α¬╡α¬│α¬╛' instead of 'બાવળા'.
"""

# Reverse lookup for Windows-1252 specific characters
CP1252_REVERSE_MAP = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
}

def fix_mojibake(val):
    """
    Recursively inspects strings, dicts, and lists to repair CP437 and Windows-1252/Latin-1 Gujarati mojibake.
    """
    if isinstance(val, str):
        # 1. Check for Windows-1252 / Latin-1 mojibake (àª, à«, etc.)
        if "àª" in val or "à«" in val or "à©" in val or "à¨" in val:
            try:
                raw_bytes = bytearray()
                for c in val:
                    code = ord(c)
                    raw_bytes.append(CP1252_REVERSE_MAP.get(code, code & 0xFF))
                repaired = raw_bytes.decode("utf-8")
                if repaired:
                    return repaired
            except Exception:
                pass

        # 2. Check for CP437 mojibake (α¬, α½, etc.)
        if "α¬" in val or "α½" in val or "≡ƒ" in val or "Γ£" in val or "ΓÜ" in val:
            try:
                repaired = val.encode("cp437").decode("utf-8")
                return repaired
            except Exception:
                try:
                    raw_bytes = bytearray()
                    for ch in val:
                        try:
                            raw_bytes.extend(ch.encode("cp437"))
                        except Exception:
                            raw_bytes.extend(ch.encode("utf-8", errors="ignore"))
                    return raw_bytes.decode("utf-8", errors="ignore")
                except Exception:
                    return val
        return val
    elif isinstance(val, dict):
        return {fix_mojibake(k): fix_mojibake(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [fix_mojibake(item) for item in val]
    return val
