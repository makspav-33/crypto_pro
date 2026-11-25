"""Classical educational S-DES on independent UTF-8 bytes."""
import re

P10 = (3, 5, 2, 7, 4, 10, 1, 9, 8, 6)
P8 = (6, 3, 7, 4, 8, 5, 10, 9)
IP = (2, 6, 3, 1, 4, 8, 5, 7)
IP_INVERSE = (4, 1, 3, 5, 7, 2, 8, 6)
EP = (4, 1, 2, 3, 2, 3, 4, 1)
P4 = (2, 4, 3, 1)
S0 = ((1, 0, 3, 2), (3, 2, 1, 0), (0, 2, 1, 3), (3, 1, 3, 2))
S1 = ((0, 1, 2, 3), (2, 0, 1, 3), (3, 0, 1, 0), (2, 1, 0, 3))


def permute(bits, positions):
    return "".join(bits[i - 1] for i in positions)


def shift_halves(bits, count):
    left, right = bits[:5], bits[5:]
    return left[count:] + left[:count] + right[count:] + right[:count]


def key_schedule(key):
    if not re.fullmatch("[01]{10}", key):
        raise ValueError("Ключ має містити рівно 10 бітів (0 або 1).")
    p10 = permute(key, P10)
    ls1 = shift_halves(p10, 1)
    ls2 = shift_halves(ls1, 2)
    return dict(key=key, p10=p10, ls1=ls1, k1=permute(ls1, P8), ls2=ls2, k2=permute(ls2, P8))


def substitute(bits, box):
    row = int(bits[0] + bits[3], 2)
    column = int(bits[1:3], 2)
    return format(box[row][column], "02b")


def fk(block, subkey):
    left, right = block[:4], block[4:]
    expanded = permute(right, EP)
    mixed = format(int(expanded, 2) ^ int(subkey, 2), "08b")
    substituted = substitute(mixed[:4], S0) + substitute(mixed[4:], S1)
    p4 = permute(substituted, P4)
    return format(int(left, 2) ^ int(p4, 2), "04b") + right


def block_trace(byte, first_key, second_key):
    bits = format(byte, "08b")
    ip = permute(bits, IP)
    first = fk(ip, first_key)
    swap = first[4:] + first[:4]
    second = fk(swap, second_key)
    return dict(input=bits, ip=ip, first=first, swap=swap, second=second, output=permute(second, IP_INVERSE))


def transform_text(text, key, decrypt=False):
    schedule = key_schedule(key)
    if not text:
        raise ValueError("Введіть шифротекст у HEX." if decrypt else "Введіть відкритий текст.")
    if decrypt:
        if len(text) > 80000 or len(text) % 2 or not re.fullmatch("[0-9a-fA-F]+", text):
            raise ValueError("Введіть до 80 000 HEX-цифр парами, без пробілів (наприклад, A80F).")
        data = bytes.fromhex(text)
    else:
        if len(text) > 10000:
            raise ValueError("Введіть до 10 000 символів відкритого тексту.")
        data = text.encode("utf-8")

    keys = (schedule["k2"], schedule["k1"]) if decrypt else (schedule["k1"], schedule["k2"])
    # At most 256 different byte values. Reuse the same trace for repeated blocks.
    traces = {byte: block_trace(byte, *keys) for byte in set(data)}
    mapping = {byte: int(trace["output"], 2) for byte, trace in traces.items()}
    output = bytes(mapping[byte] for byte in data)
    try:
        result = output.decode("utf-8") if decrypt else output.hex().upper()
    except UnicodeDecodeError:
        raise ValueError("Результат не є коректним UTF-8. Перевірте ключ і шифротекст.") from None
    return dict(result=result, schedule=schedule, block=traces[data[0]], byte_count=len(data),
                operation="decrypt" if decrypt else "encrypt")
