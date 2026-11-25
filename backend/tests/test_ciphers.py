import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ciphers import EN, UK, transform, validate_key


class CipherTests(unittest.TestCase):
    def test_selected_language(self):
        mixed = "Abc XYZ Аа Ґґ Яя! 123\r\n"
        self.assertEqual(transform(mixed, "caesar", "1", language="UA")["result"], "Abc XYZ Бб Дд Аа! 123\r\n")
        self.assertEqual(transform(mixed, "caesar", "1", language="EN")["result"], "Bcd YZA Аа Ґґ Яя! 123\r\n")
        for language, size in (("UA", 33), ("EN", 26)):
            for key in ("-99999999999999999", "0", "3", str(size)):
                encrypted = transform(mixed, "caesar", key, language=language)
                self.assertEqual(len(encrypted["steps"][0]["alphabets"]), 1)
                self.assertEqual(transform(encrypted["result"], "caesar", key, True, language=language)["result"], mixed)

    def test_caesar_known_answers(self):
        self.assertEqual(transform("Abc XYZ! 123", "caesar", "3")["result"], "Def ABC! 123")
        self.assertEqual(transform("Аа Ґґ Яя", "caesar", "1")["result"], "Бб Дд Аа")
        self.assertEqual(transform(EN + UK, "caesar", str(26 * 33))["result"], EN + UK)
        self.assertEqual(transform("AА", "caesar", "-1")["result"], "ZЯ")

    def test_permutation_known_answers(self):
        for algorithm, expected in [("horizontal", "ACBDEGF"), ("vertical", "AECGBFD"), ("combined", "AEBFCGD")]:
            result = transform("ABCDEFG", algorithm, "1324")
            self.assertEqual(result["result"], expected)
            self.assertEqual(transform(expected, algorithm, "1324", True)["result"], "ABCDEFG")
            for step in result["steps"]:
                self.assertEqual("".join(step["input"][i - 1] for i in step["output_to_input"]), step["output"])
            for step in transform(expected, algorithm, "1324", True)["steps"]:
                self.assertEqual("".join(step["input"][i - 1] for i in step["output_to_input"]), step["output"])

    def test_roundtrips(self):
        rng = random.Random(15)
        samples = ["", " ", "  trailing  ", "Привіт, Ґанок! Hello 123.\r\n\t", "😀е\u0301\ufeff!", EN + UK + EN.upper() + UK.upper()]
        samples += ["".join(rng.choice(EN + UK + " \r\n_123😀") for _ in range(n)) for n in range(40)]
        for algorithm in ("caesar", "horizontal", "vertical", "combined"):
            keys = ["0", "-99999999999999999999999999999999", "+123456789123456789"] if algorithm == "caesar" else ["21", "1324", "321", "987654321"]
            for key in keys:
                for text in samples:
                    with self.subTest(algorithm=algorithm, key=key, length=len(text)):
                        encrypted = transform(text, algorithm, key)["result"]
                        self.assertEqual(len(encrypted), len(text))
                        self.assertEqual(transform(encrypted, algorithm, key, True)["result"], text)

    def test_invalid_keys(self):
        for algorithm, keys in [("caesar", ["", "1.5", "abc", " 3", "1" * 101]), ("vertical", ["", "1", "1123", "0123", "2345", "1234567890", "abcd"])]:
            for key in keys:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    validate_key(algorithm, key)


if __name__ == "__main__":
    unittest.main()
