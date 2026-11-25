import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.sdes import block_trace, key_schedule, transform_text


class SDesTests(unittest.TestCase):
    key = "1010000010"

    def test_schedule(self):
        self.assertEqual(key_schedule(self.key), {
            "key": self.key, "p10": "1000001100", "ls1": "0000111000",
            "k1": "10100100", "ls2": "0010000011", "k2": "01000011",
        })

    def test_known_blocks(self):
        # Includes the Sage SimplifiedDES encrypt and decrypt examples.
        for plain, cipher in [(0x55, 0xC1), (0x15, 0x55), (0xD7, 0xA8)]:
            self.assertEqual(block_trace(plain, "10100100", "01000011")["output"], f"{cipher:08b}")
            self.assertEqual(block_trace(cipher, "01000011", "10100100")["output"], f"{plain:08b}")

    def test_round_states(self):
        self.assertEqual(block_trace(0xD7, "10100100", "01000011"), {
            "input": "11010111", "ip": "11011101", "first": "00101101", "swap": "11010010",
            "second": "00110010", "output": "10101000",
        })

    def test_utf8(self):
        for text in ["Привіт, Ґанок!", " Hello! \r\n", "\x00\ufeffе\u0301😀", "😀" * 10000]:
            encrypted = transform_text(text, self.key)
            self.assertEqual(len(encrypted["result"]), 2 * len(text.encode("utf-8")))
            restored = transform_text(encrypted["result"].lower(), self.key, True)
            self.assertEqual(restored["result"], text)
            self.assertEqual(restored["block"]["output"], encrypted["block"]["input"])

    def test_invalid_input(self):
        for key in ["", "101", "0" * 11, "0" * 9 + "2", "1" * 9 + " "]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                transform_text("Hello", key)
        for text, decrypt in [("", False), ("", True), ("0", True), ("XX", True),
                              ("55  ", True), ("A8", True), ("a" * 10001, False)]:
            with self.subTest(decrypt=decrypt), self.assertRaises(ValueError):
                transform_text(text, self.key, decrypt)
