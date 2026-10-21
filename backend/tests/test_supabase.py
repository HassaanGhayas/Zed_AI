"""Supabase integration tests: JWT verification, DB cache fallback, delete endpoint. No network."""
import asyncio
import time
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core import auth
from app.core.config import settings
from app.core.rate_limit import reset_rate_limits
from app.main import app
from app.models.schemas import Segment, TranscriptCue
from app.services.transcript_service import TranscriptService

client = TestClient(app)

SECRET = "test-secret-at-least-32-bytes-long-xxxx"
USER = "11111111-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def _reset():
    reset_rate_limits()
    yield
    reset_rate_limits()


def _token(secret=SECRET, aud="authenticated", sub=USER, exp_in=3600, alg="HS256", **extra):
    claims = {"aud": aud, **extra}
    if exp_in is not None:
        claims["exp"] = int(time.time()) + exp_in
    if sub is not None:
        claims["sub"] = sub
    return jwt.encode(claims, secret, algorithm=alg)


@pytest.fixture
def jwt_secret():
    with patch.object(settings, "supabase_jwt_secret", SECRET):
        yield


class TestVerifyToken:
    def test_valid(self, jwt_secret):
        assert auth.verify_token(_token()) == USER

    def test_wrong_secret(self, jwt_secret):
        assert auth.verify_token(_token(secret="another-secret-at-least-32-bytes-long")) is None

    def test_expired(self, jwt_secret):
        assert auth.verify_token(_token(exp_in=-10)) is None

    def test_wrong_audience(self, jwt_secret):
        assert auth.verify_token(_token(aud="anon")) is None

    def test_missing_exp_or_sub_rejected(self, jwt_secret):
        assert auth.verify_token(_token(exp_in=None)) is None
        assert auth.verify_token(_token(sub=None)) is None

    def test_garbage_and_empty(self, jwt_secret):
        assert auth.verify_token("not-a-jwt") is None
        assert auth.verify_token("") is None

    def test_no_secret_configured(self):
        with patch.object(settings, "supabase_jwt_secret", ""):
            assert auth.verify_token(_token()) is None

    def test_alg_none_rejected(self, jwt_secret):
        forged = jwt.encode({"aud": "authenticated", "sub": USER}, key=None, algorithm="none")
        assert auth.verify_token(forged) is None

    def test_authorization_header_parsing(self, jwt_secret):
        assert auth.user_id_from_authorization(f"Bearer {_token()}") == USER
        assert auth.user_id_from_authorization(f"Basic {_token()}") is None
        assert auth.user_id_from_authorization(None) is None


class TestDependencies:
    def test_optional_absent_and_invalid(self, jwt_secret):
        assert asyncio.run(auth.get_optional_user(None)) is None
        assert asyncio.run(auth.get_optional_user("Bearer junk")) is None
        assert asyncio.run(auth.get_optional_user(f"Bearer {_token()}")) == USER

    def test_required_raises_401(self, jwt_secret):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            asyncio.run(auth.get_required_user(None))
        assert exc.value.status_code == 401


class TestDeleteEndpoint:
    def test_401_without_token(self):
        assert client.delete("/api/me/data").status_code == 401

    def test_401_invalid_token(self, jwt_secret):
        r = client.delete("/api/me/data", headers={"Authorization": "Bearer junk"})
        assert r.status_code == 401

    def test_503_when_supabase_unconfigured(self, jwt_secret):
        with patch("app.api.routes_me.get_supabase", return_value=None):
            r = client.delete("/api/me/data", headers={"Authorization": f"Bearer {_token()}"})
        assert r.status_code == 503

    def test_deletes_only_callers_rows(self, jwt_secret):
        fake = MagicMock()
        with patch("app.api.routes_me.get_supabase", return_value=fake):
            r = client.delete("/api/me/data", headers={"Authorization": f"Bearer {_token()}"})
        assert r.status_code == 200
        tables = [c.args[0] for c in fake.table.call_args_list]
        assert sorted(tables) == sorted(
            ["qa_attempts", "video_sessions", "concepts", "review_events", "study_days", "user_settings"]
        )
        fake.table.return_value.delete.return_value.eq.assert_called_with("user_id", USER)


class TestRateLimitKey:
    def test_valid_token_keyed_by_user_not_ip(self, jwt_secret):
        h = {"Authorization": f"Bearer {_token()}"}
        with patch.object(settings, "rate_limit_per_minute", 1), \
                patch("app.api.routes_me.get_supabase", return_value=MagicMock()):
            assert client.delete("/api/me/data", headers=h).status_code == 200
            assert client.delete("/api/me/data", headers=h).status_code == 429
            other = {"Authorization": f"Bearer {_token(sub='99999999-2222-3333-4444-555555555555')}"}
            assert client.delete("/api/me/data", headers=other).status_code == 200


class TestCacheFallback:
    def _broken(self):
        fake = MagicMock()
        fake.table.side_effect = RuntimeError("db down")
        return fake

    def test_cues_read_error_swallowed(self):
        with patch("app.services.transcript_service.get_supabase", return_value=self._broken()):
            assert TranscriptService._load_db_cues(MagicMock(), "abcdefghijk") is None

    def test_cues_write_error_swallowed(self):
        cues = [TranscriptCue(start=0, duration=1, text="hi")]
        with patch("app.services.transcript_service.get_supabase", return_value=self._broken()):
            TranscriptService._save_db_cues(MagicMock(), "abcdefghijk", cues)

    def test_segments_errors_swallowed(self):
        seg = Segment(segment_id=1, title="t", start_time=0, end_time=1, summary="s")
        cues = [TranscriptCue(start=0, duration=1, text="hi")]
        svc = MagicMock()
        with patch("app.services.transcript_service.get_supabase", return_value=self._broken()):
            assert TranscriptService.load_db_segments(svc, "abcdefghijk", "v1") is None
            TranscriptService.save_db_segments(svc, "abcdefghijk", "v1", cues, [seg])

    def test_fetch_falls_through_to_youtube_when_db_raises(self):
        svc = TranscriptService()
        raw = [{"text": "hello", "start": 0.0, "duration": 1.0}]
        with patch("app.services.transcript_service.get_supabase", return_value=self._broken()), \
                patch.object(svc, "_load_cached_cues", return_value=None), \
                patch.object(svc, "_save_cached_cues"), \
                patch.object(svc, "_fetch_raw_cues", return_value=raw):
            cues = svc.fetch_transcript_cues("abcdefghijk")
        assert cues[0].text == "hello"

    def test_db_hit_used_when_disk_misses(self):
        svc = TranscriptService()
        fake = MagicMock()
        fake.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"cues": [{"start": 0.0, "duration": 1.0, "text": "from db"}]}
        ]
        with patch("app.services.transcript_service.get_supabase", return_value=fake), \
                patch.object(svc, "_load_cached_cues", return_value=None), \
                patch.object(svc, "_save_cached_cues") as save_disk, \
                patch.object(svc, "_fetch_raw_cues") as yt:
            cues = svc.fetch_transcript_cues("abcdefghijk")
        assert cues[0].text == "from db"
        yt.assert_not_called()
        save_disk.assert_called_once()

    def test_segments_version_mismatch_not_reused(self):
        svc = TranscriptService()
        fake = MagicMock()
        fake.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"segments": [{"segment_id": 1, "title": "t", "start_time": 0, "end_time": 1, "summary": "s"}],
             "segmenter_version": "old"}
        ]
        with patch("app.services.transcript_service.get_supabase", return_value=fake):
            assert svc.load_db_segments("abcdefghijk", "v1") is None
            assert svc.load_db_segments("abcdefghijk", "old")[0].title == "t"

    def test_no_client_when_unconfigured(self):
        from app.core import supabase as sb
        with patch.object(settings, "supabase_url", ""), patch.object(settings, "supabase_service_key", ""):
            assert sb.get_supabase() is None


class TestRateLimitHardening:
    def test_ip_ceiling_before_verification(self, jwt_secret):
        h = {"Authorization": "Bearer junk"}
        with patch.object(settings, "rate_limit_per_minute", 1),                 patch("app.core.rate_limit.IP_CEILING_MULTIPLIER", 2),                 patch("app.core.rate_limit.resolve_auth", return_value=(None, False)) as ra,                 patch("app.api.routes_me.get_supabase", return_value=MagicMock()):
            codes = [client.delete("/api/me/data", headers=h).status_code for _ in range(4)]
        assert codes == [401, 429, 429, 429]
        # third+ requests hit the ceiling and never reach verification
        assert ra.call_count == 2

    def test_user_bucket_does_not_bypass_ip_ceiling(self, jwt_secret):
        with patch.object(settings, "rate_limit_per_minute", 1),                 patch("app.core.rate_limit.IP_CEILING_MULTIPLIER", 2),                 patch("app.api.routes_me.get_supabase", return_value=MagicMock()):
            codes = [
                client.delete(
                    "/api/me/data",
                    headers={"Authorization": f"Bearer {_token(sub=f'{i}1111111-2222-3333-4444-555555555555')}"},
                ).status_code
                for i in range(3)
            ]
        assert codes == [200, 200, 429]

    def test_anonymous_jwt_limited_by_ip_not_user(self, jwt_secret):
        with patch.object(settings, "rate_limit_per_minute", 1),                 patch("app.api.routes_me.get_supabase", return_value=MagicMock()):
            def call(sub):
                return client.delete(
                    "/api/me/data",
                    headers={"Authorization": f"Bearer {_token(sub=sub, is_anonymous=True)}"},
                ).status_code
            assert call("a1111111-2222-3333-4444-555555555555") == 200
            # different anonymous identity, same IP bucket -> limited
            assert call("b1111111-2222-3333-4444-555555555555") == 429

    def test_token_verified_once_per_request(self, jwt_secret):
        with patch("app.api.routes_me.get_supabase", return_value=MagicMock()),                 patch("app.core.auth.verify_claims", wraps=auth.verify_claims) as vc:
            r = client.delete("/api/me/data", headers={"Authorization": f"Bearer {_token()}"})
        assert r.status_code == 200
        assert vc.call_count == 1


class TestJwks:
    def setup_method(self):
        auth.reset_auth_state()

    teardown_method = setup_method

    def _rs_token(self, kid):
        return jwt.encode({"aud": "authenticated", "sub": USER, "exp": int(time.time()) + 60},
                          SECRET, algorithm="HS256", headers={"kid": kid, "alg": "RS256"})

    def test_client_has_timeout(self):
        with patch.object(settings, "supabase_url", "https://x.supabase.co"):
            c = auth._get_jwks_client()
        assert c.timeout == auth.JWKS_TIMEOUT_SECONDS

    def test_unknown_kid_negative_cached_no_refetch(self):
        fake = MagicMock()
        fake.get_signing_keys.return_value = []
        with patch.object(settings, "supabase_url", "https://x.supabase.co"),                 patch("app.core.auth._get_jwks_client", return_value=fake):
            hdr_tok = self._forged_rs256("evil")
            assert auth.verify_claims(hdr_tok) is None
            assert auth.verify_claims(hdr_tok) is None
        assert fake.get_signing_keys.call_count == 1
        fake.get_signing_keys.assert_called_with()  # never refresh=True

    def _forged_rs256(self, kid):
        import base64, json
        b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
        return f"{b({'alg': 'RS256', 'kid': kid})}.{b({'sub': USER})}.c2ln"


class TestStartupWarning:
    def setup_method(self):
        auth.reset_auth_state()

    def test_warns_once_when_unverifiable(self, caplog):
        with patch.object(settings, "supabase_url", ""), patch.object(settings, "supabase_jwt_secret", ""),                 patch.object(settings, "supabase_service_key", "svc"):
            with caplog.at_level("WARNING", logger="app.core.auth"):
                auth.warn_if_unverifiable()
                auth.warn_if_unverifiable()
        assert len([r for r in caplog.records if "cannot be verified" in r.message]) == 1
        auth.reset_auth_state()
