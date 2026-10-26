# Changelog

## 1.0.13 — 2026-10-26

### Fail-open: changed behaviour

- **Fail-open now fires only when TOLVYN is unreachable**: the connection was
  refused, DNS failed, the TLS handshake failed, or connecting timed out — or TOLVYN
  answered 503 with `X-Tolvyn-Unavailable: 1`.
- **It no longer fires on a provider's 503.** A plain 503 through the proxy is the
  provider's own and is returned to you; retrying it direct only moved the call out
  of TOLVYN's metering.
- **It no longer fires on timeouts or resets after the request was sent**
  (`ECONNRESET`, response timeouts, a bare `fetch failed`). TOLVYN may already have
  forwarded the request, and the direct retry was a second, unmetered provider call.
- **It no longer fires on unrelated `ERR_*` errors** such as `ERR_INVALID_ARG_TYPE`
  or `ERR_INVALID_URL`. (BE-513)
- Enforcement responses (kill switch 451, budget/quota 429) never fail open.
- Google: the Google SDK hides the cause and the response headers, so Google fails
  open only when a fresh TCP connection to the proxy also fails; the 503 marker does
  not apply to Google.

### Fail-open: fixes

- The direct request no longer carries any `X-Tolvyn-*` header, set on the client
  or per request — including Google's per-request `customHeaders`
  (`X-Tolvyn-User` and `X-Tolvyn-End-Customer` can be personal data). Reported by
  Maram Sai Harsha Vardhan Reddy. (BE-507)
- A `Request` object passed to the fail-open fetch keeps its headers, body and
  signal on the direct retry; a streamed body that cannot be replayed never fails
  open. (BE-513)
- The discarded 503 response body is cancelled before the retry. (BE-514)
