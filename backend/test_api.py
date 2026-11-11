"""Test rapide de bout en bout de l'API EcoMarketplace (simulation du SDK)."""
import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000"


def call(method, path, key=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if key:
        req.add_header("X-API-Key", key)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=5) as r:
            return r.status, dict(r.headers), json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), json.loads(e.read().decode())


s, h, b = call("GET", "/v1/health")
print("GET /v1/health ->", s, b, "| X-API-Version:", h.get("X-API-Version"))

s, h, b = call("POST", "/v1/events/purchase", "mch_live_99x821a",
               {"orderId": "ORD-12345", "items": [{"category": "electronics", "weightKg": 1.2}]})
print("POST /v1/events/purchase ->", s, "| co2eKg:", b["co2eKg"], "| marchand:", b["merchant"])

s, _, b = call("POST", "/v1/events/purchase", "mch_live_99x821a",
               {"orderId": "ORD-12346",
                "items": [{"category": "clothing", "weightKg": 0.8},
                          {"category": "books", "weightKg": 1.5}]})
print("POST (2e commande) ->", s, "| co2eKg:", b["co2eKg"])

s, _, b = call("GET", "/v1/analytics/merchant", "mch_live_99x821a")
print("GET /v1/analytics/merchant ->", s)
print(json.dumps(b, indent=2, ensure_ascii=False))

s, _, b = call("GET", "/v1/analytics/merchant", "mauvaise_cle")
print("Cle invalide ->", s, "|", b["detail"])
s, _, b = call("GET", "/v1/analytics/merchant")
print("Sans cle ->", s, "|", b["detail"])
