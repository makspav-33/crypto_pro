"""Real HTTP integration tests using an isolated SQLite database, no extra test packages."""
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import jwt

ROOT = Path(__file__).resolve().parents[2]


class AuthenticationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="digitalvault-test-")
        cls.database = str(Path(cls.directory.name) / "test.db")
        cls.secret = secrets.token_urlsafe(48)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}/api"
        cls.port = port
        env = {**os.environ, "JWT_SECRET": cls.secret, "DATABASE_PATH": cls.database,
               "JWT_TTL_MINUTES": "15", "CORS_ORIGINS": "http://localhost:5173"}
        cls.environment = env
        cls.start_backend()

    @classmethod
    def start_backend(cls):
        cls.process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", str(ROOT / "backend"),
                                        "--host", "127.0.0.1", "--port", str(cls.port)], env=cls.environment, cwd=ROOT,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                if cls.request("/health")[0] == 200:
                    return
            except OSError:
                pass
            if cls.process.poll() is not None:
                break
            time.sleep(.1)
        cls.process.terminate()
        cls.process.wait()
        cls.directory.cleanup()
        raise RuntimeError("Test backend did not start; check dependencies and environment settings")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.directory.cleanup()

    @classmethod
    def request(cls, path, data=None, token=None, method=None, headers=None, raw=None, binary=False):
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        if token:
            request_headers["Authorization"] = f"Bearer {token}"
        request = Request(cls.base + path, data=raw if raw is not None else json.dumps(data).encode() if data is not None else None,
                          headers=request_headers, method=method)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            if binary:
                return response.status, raw, response.headers
            try:
                body = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                body = raw.decode()
            return response.status, body, response.headers

    def test_authentication_lifecycle(self):
        credentials = {"email": "Vault.User@example.com", "password": "correct-horse-battery-123"}
        status, user, _ = self.request("/auth/register", {**credentials, "username": "vault_user"})
        self.assertEqual(status, 201)
        self.assertEqual(set(user), {"id", "username", "email", "created_at"})
        self.assertEqual(user["email"], credentials["email"].lower())
        with closing(sqlite3.connect(self.database)) as connection:
            stored = connection.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()[0]
        self.assertTrue(stored.startswith("$argon2id$"))
        self.assertNotIn(credentials["password"], stored)
        self.assertEqual(self.request("/auth/register", {**credentials, "username": "other"})[0], 409)
        self.assertEqual(self.request("/auth/login", {**credentials, "password": "wrong"})[0], 401)
        self.assertEqual(self.request("/auth/login", {**credentials, "email": "missing@example.com"})[0], 401)
        status, result, _ = self.request("/auth/login", credentials)
        self.assertEqual(status, 200)
        token = result["access_token"]
        claims = jwt.decode(token, self.secret, algorithms=["HS256"])
        self.assertEqual(claims["sub"], str(user["id"]))
        self.assertEqual(claims["name"], user["username"])
        self.assertEqual(claims["email"], user["email"])
        self.assertEqual(set(claims), {"sub", "name", "email", "iat", "exp"})
        self.assertEqual(claims["exp"] - claims["iat"], 900)
        self.assertEqual(self.request("/auth/me", token=token)[1], user)
        status, info, _ = self.request("/auth/token-info", token=token)
        self.assertEqual(status, 200)
        self.assertTrue(info["signature"]["verified"])
        self.assertEqual(info["payload"], claims)
        self.assertNotIn(token, json.dumps(info))
        self.assertNotIn(self.secret, json.dumps(info))
        self.assertEqual(self.request("/auth/me")[0], 401)
        self.assertEqual(self.request("/auth/token-info")[0], 401)
        self.assertEqual(self.request("/auth/me", token="invalid")[0], 401)
        expired = jwt.encode({"sub": str(user["id"]), "iat": int(time.time()) - 60, "exp": int(time.time()) - 1}, self.secret, algorithm="HS256")
        self.assertEqual(self.request("/auth/me", token=expired)[0], 401)
        forged = jwt.encode(claims, secrets.token_urlsafe(48), algorithm="HS256")
        self.assertEqual(self.request("/auth/me", token=forged)[0], 401)
        # Logout discards the in-memory token: subsequent requests carry no Authorization.
        self.assertEqual(self.request("/auth/me")[0], 401)

    def test_validation(self):
        for data in (
            {"username": "ok_user", "email": "invalid", "password": "a" * 12},
            {"username": "x", "email": "valid@example.com", "password": "a" * 12},
            {"username": "ok_user", "email": "valid@example.com", "password": "short"},
        ):
            self.assertEqual(self.request("/auth/register", data)[0], 422)

    def test_crypto_api(self):
        credentials = {"email": "crypto@example.com", "password": "testing-password-123"}
        self.assertEqual(self.request("/auth/register", {**credentials, "username": "crypto_user"})[0], 201)
        token = self.request("/auth/login", credentials)[1]["access_token"]
        original = "\ufeffПривіт, ґанок! Hello 123 😀\r\n  \t "
        for algorithm in ("caesar", "horizontal", "vertical", "combined"):
            key = "-12345678901234567890" if algorithm == "caesar" else "1324"
            payload = {"algorithm": algorithm, "key": key, "text": original}
            self.assertEqual(self.request("/crypto/text/encrypt", payload)[0], 401)
            status, encrypted, _ = self.request("/crypto/text/encrypt", payload, token)
            self.assertEqual(status, 200)
            self.assertEqual(self.request("/crypto/text/decrypt", {**payload, "text": encrypted["result"]}, token)[1]["result"], original)
            self.assertEqual(self.request("/crypto/text/encrypt", {**payload, "text": ""}, token)[1]["result"], "")
            query = f"?algorithm={algorithm}&key={key}&filename=sample.txt"
            self.assertEqual(self.request("/crypto/files/encrypt" + query, raw=original.encode())[0], 401)
            self.assertEqual(self.request("/crypto/files/decrypt" + query, raw=b"{}")[0], 401)
            status, container, headers = self.request("/crypto/files/encrypt" + query, token=token, raw=original.encode(), binary=True)
            self.assertEqual(status, 200)
            self.assertIn("attachment", headers["Content-Disposition"])
            status, restored, _ = self.request("/crypto/files/decrypt" + query, token=token, raw=container, binary=True)
            self.assertEqual(status, 200)
            self.assertEqual(restored, original.encode())
            status, empty, _ = self.request("/crypto/files/encrypt" + query, token=token, raw=b"", binary=True)
            self.assertEqual(status, 200)
            self.assertEqual(self.request("/crypto/files/decrypt" + query, token=token, raw=empty, binary=True)[1], b"")
        payload = {"algorithm": "vertical", "key": "1123", "text": "abc"}
        self.assertEqual(self.request("/crypto/text/encrypt", payload, token)[0], 422)
        self.assertEqual(self.request("/crypto/text/decrypt", payload)[0], 401)
        query = "?algorithm=vertical&key=1324&filename=sample.txt"
        self.assertEqual(self.request("/crypto/files/encrypt" + query, token=token, raw=b"\xff")[0], 422)
        self.assertEqual(self.request("/crypto/files/encrypt" + query, token=token, raw=b"a" * (1024 * 1024 + 1))[0], 413)
        self.assertEqual(self.request("/crypto/files/decrypt" + query, token=token, raw=b"{}")[0], 422)
        self.assertEqual(self.request("/crypto/files/encrypt" + query.replace("sample.txt", "sample.bin"), token=token, raw=b"abc")[0], 422)
        damaged = {"format": "DigitalVault", "version": 1, "algorithm": "vertical", "length": 99, "key_width": 4, "ciphertext": "a"}
        self.assertEqual(self.request("/crypto/files/decrypt" + query, token=token, raw=json.dumps(damaged).encode())[0], 422)
        history_stats = self.request("/history/stats", token=token)[1]
        self.assertEqual([history_stats[k] for k in ("total_operations", "encryptions", "decryptions", "files_processed")], [28, 16, 12, 16])

    def test_cors_preflight(self):
        status, _, headers = self.request("/auth/login", method="OPTIONS", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:5173")

    def test_history_isolation_stats_and_restart(self):
        tokens = []
        for name in ("history_owner", "history_other"):
            data = {"email": f"{name}@example.com", "password": "testing-password-123"}
            self.assertEqual(self.request("/auth/register", {**data, "username": name})[0], 201)
            tokens.append(self.request("/auth/login", data)[1]["access_token"])
        owner, other = tokens
        for path, method in [("/history", "GET"), ("/history/stats", "GET"), ("/history", "DELETE"), ("/history/1", "DELETE")]:
            self.assertEqual(self.request(path, method=method)[0], 401)
        self.assertEqual(self.request("/history/stats", token=owner)[1]["total_operations"], 0)
        payload = {"algorithm": "caesar", "key": "3", "text": "Private content not for history"}
        self.assertEqual(self.request("/crypto/text/encrypt", payload, owner)[0], 200)
        self.assertEqual(self.request("/crypto/text/decrypt", payload, owner)[0], 200)
        self.assertEqual(self.request("/crypto/text/encrypt", payload, other)[0], 200)
        query = "?algorithm=vertical&key=1324&filename=report.txt"
        self.assertEqual(self.request("/crypto/files/encrypt" + query, token=owner, raw=b"private file")[0], 200)
        self.assertEqual(self.request("/crypto/text/encrypt", {**payload, "key": "invalid"}, owner)[0], 422)
        status, records, _ = self.request("/history", token=owner)
        self.assertEqual(status, 200)
        self.assertEqual(records["total"], 3)
        self.assertEqual(set(records["items"][0]), {"id", "user_id", "created_at", "algorithm", "operation", "data_type", "filename", "status"})
        self.assertTrue(all(row["status"] == "success" for row in records["items"]))
        self.assertNotIn(payload["text"], json.dumps(records))
        first_id = records["items"][0]["id"]
        self.assertEqual(self.request(f"/history/{first_id}", token=other, method="DELETE")[0], 404)
        self.assertEqual(self.request("/history?search=report&algorithm=vertical&operation=encrypt&data_type=file", token=owner)[1]["total"], 1)
        self.assertEqual(len(self.request("/history?limit=1&offset=1", token=owner)[1]["items"]), 1)
        self.assertEqual(self.request("/history?algorithm=combined", token=owner)[1]["total"], 0)
        self.assertEqual(self.request("/history?limit=0", token=owner)[0], 422)
        stats = self.request("/history/stats", token=owner)[1]
        self.assertEqual([stats[k] for k in ("total_operations", "encryptions", "decryptions", "files_processed")], [3, 2, 1, 1])
        self.assertEqual(stats["most_used_algorithm"], "caesar")
        self.assertEqual(len(stats["activity"]), 7)
        self.assertEqual(sum(day["count"] for day in stats["activity"]), 3)
        self.assertEqual(sum(row["count"] for row in stats["algorithms"]), 3)
        self.assertEqual(self.request("/history/stats", token=other)[1]["total_operations"], 1)
        cls = type(self)
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.start_backend()
        self.assertEqual(self.request("/history", token=owner)[1], records)
        self.assertEqual(self.request(f"/history/{first_id}", token=owner, method="DELETE")[0], 204)
        self.assertEqual(self.request("/history/stats", token=owner)[1]["files_processed"], 0)
        self.assertEqual(self.request(f"/history/{first_id}", token=owner, method="DELETE")[0], 404)
        self.assertEqual(self.request("/history", token=owner, method="DELETE")[0], 204)
        self.assertEqual(self.request("/history", token=owner)[1]["total"], 0)
        self.assertEqual(self.request("/history/stats", token=owner)[1]["total_operations"], 0)
        self.assertIsNone(self.request("/history/stats", token=owner)[1]["most_used_algorithm"])
        self.assertEqual(self.request("/history", token=other)[1]["total"], 1)
        status, _, headers = self.request("/history", method="OPTIONS", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "authorization"})
        self.assertEqual(status, 200)
        self.assertIn("DELETE", headers["Access-Control-Allow-Methods"])

    def test_caesar_languages_api(self):
        credentials = {"email": "languages@example.com", "password": "testing-password-123"}
        self.request("/auth/register", {**credentials, "username": "languages_user"})
        token = self.request("/auth/login", credentials)[1]["access_token"]
        text = "Hello Привіт Ґґ Яя! 123\r\n"
        for language in ("UA", "EN"):
            payload = {"algorithm": "caesar", "key": "-999999999", "text": text, "language": language}
            status, encrypted, _ = self.request("/crypto/text/encrypt", payload, token)
            self.assertEqual(status, 200)
            self.assertEqual(self.request("/crypto/text/decrypt", {**payload, "text": encrypted["result"]}, token)[1]["result"], text)
            query = f"?algorithm=caesar&key=-999999999&filename=test.txt&language={language}"
            status, container, _ = self.request("/crypto/files/encrypt" + query, token=token, raw=text.encode(), binary=True)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(container)["language"], language)
            self.assertEqual(self.request("/crypto/files/decrypt" + query, token=token, raw=container, binary=True)[1], text.encode())
            wrong = query.replace(f"language={language}", f"language={'EN' if language == 'UA' else 'UA'}")
            self.assertEqual(self.request("/crypto/files/decrypt" + wrong, token=token, raw=container)[0], 422)
        self.assertEqual(self.request("/crypto/text/encrypt", {**payload, "language": "invalid"}, token)[0], 422)
        sys.path.insert(0, str(ROOT / "backend"))
        from app.ciphers import transform
        legacy = json.dumps({"format": "DigitalVault", "version": 1, "algorithm": "caesar", "length": len(text), "key_width": None, "ciphertext": transform(text, 'caesar', '3')["result"]}).encode()
        self.assertEqual(self.request("/crypto/files/decrypt?algorithm=caesar&key=3&filename=old.txt&language=UA", token=token, raw=legacy, binary=True)[1], text.encode())

    def test_jwt_profile_claims_refresh(self):
        credentials = {"email": "claims@example.com", "password": "testing-password-123"}
        user = self.request("/auth/register", {**credentials, "username": "claims_user"})[1]
        old_token = self.request("/auth/login", credentials)[1]["access_token"]
        # Simulate an account update in isolated test data, not the user's actual database.
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("UPDATE users SET username=?, email=? WHERE id=?", ("Максим", "updated@example.com", user["id"]))
            connection.commit()
        new_login = self.request("/auth/login", {**credentials, "email": "updated@example.com"})
        self.assertEqual(new_login[0], 200)
        new_token = new_login[1]["access_token"]
        claims = jwt.decode(new_token, self.secret, algorithms=["HS256"])
        self.assertEqual(claims["name"], "Максим")
        self.assertEqual(claims["email"], "updated@example.com")
        self.assertEqual(self.request("/auth/token-info", token=new_token)[1]["payload"], claims)
        self.assertEqual(self.request("/auth/token-info", token=old_token)[1]["payload"]["name"], "claims_user")
        legacy = jwt.encode({"sub": str(user["id"]), "iat": int(time.time()), "exp": int(time.time()) + 60}, self.secret, algorithm="HS256")
        self.assertEqual(self.request("/auth/me", token=legacy)[0], 200)
        self.assertNotIn("name", self.request("/auth/token-info", token=legacy)[1]["payload"])

    def test_permutation_language_context(self):
        credentials = {"email": "permutation_languages@example.com", "password": "testing-password-123"}
        self.request("/auth/register", {**credentials, "username": "permutation_languages"})
        token = self.request("/auth/login", credentials)[1]["access_token"]
        for algorithm in ("horizontal", "vertical", "combined"):
            for text in ("Ґґ Єє Іі Її Привіт! 123\r\n  ", "Hello, World! 123\r\n", "UA ҐЄІЇ + EN ABC 😀"):
                results = []
                for language in ("UA", "EN"):
                    payload = {"algorithm": algorithm, "key": "1324", "text": text, "language": language}
                    encrypted = self.request("/crypto/text/encrypt", payload, token)
                    self.assertEqual(encrypted[0], 200)
                    results.append(encrypted[1]["result"])
                    restored = self.request("/crypto/text/decrypt", {**payload, "text": results[-1]}, token)
                    self.assertEqual(restored[1]["result"], text)
                    query = f"?algorithm={algorithm}&key=1324&filename=test.txt&language={language}"
                    container = self.request("/crypto/files/encrypt" + query, token=token, raw=text.encode(), binary=True)
                    self.assertEqual(container[0], 200)
                    restored_file = self.request("/crypto/files/decrypt" + query, token=token, raw=container[1], binary=True)
                    self.assertEqual(restored_file[0], 200)
                    self.assertEqual(restored_file[1], text.encode())
                self.assertEqual(results[0], results[1])


if __name__ == "__main__":
    unittest.main()
