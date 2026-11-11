"""
EcoMarketplace — API de la plateforme (Backend centralisé)
==========================================================

Rôle : le serveur central reçoit les événements de vente des sites
e-commerce partenaires (via le SDK EcoSDK) et calcule l'empreinte
carbone de chaque achat à partir de facteurs d'émission par catégorie.

Endpoints :
    POST /v1/events/purchase     → enregistre un achat + empreinte carbone
    GET  /v1/analytics/merchant  → statistiques du commerçant connecté
    GET  /v1/health              → sonde de disponibilité (pour le retry du SDK)

Authentification : clé API marchand passée dans l'en-tête `X-API-Key`.
Versionnement   : réponse accompagnée de `X-API-Version` (voir Partie 3 :
                  gouvernance & protection contre les breaking changes).

Stockage : en mémoire (dict) — suffisant pour un TP ; en production on
utiliserait PostgreSQL + une file asynchrone (Kafka/SQS).

Lancement :
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
    → Documentation interactive : http://localhost:8000/docs
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_VERSION = "v1"          # version de l'API exposée (gouvernance Partie 3)
DEPRECATED_VERSIONS: Dict[str, str] = {
    # "v0": "2024-01-01 : migrer vers /v1 (exemple de politique de dépréciation)"
}

# Clés API de démonstration (en production : table hachée + secrets managés)
MERCHANT_API_KEYS: Dict[str, str] = {
    "mch_live_99x821a": "greenShop",
    "mch_live_testkey": "demoStore",
}

# Facteurs d'émission (kg CO₂e / kg de produit) — valeurs indicatives
# inspirées des bases ADEME / carbone4 par catégorie de produit.
EMISSION_FACTORS_KGCO2_PER_KG: Dict[str, float] = {
    "electronics": 180.0,   # forte intensité (extraction métaux, fabrication)
    "clothing":    22.0,    # textile : coton, polyester, teinture
    "food":         5.0,    # moyenne alimentaire (hors transport)
    "books":        3.0,
    "furniture":    15.0,
    "cosmetics":    12.0,
    "toys":        28.0,
    "other":        8.0,    # catégorie par défaut
}

# Part transport/logistique ajoutée au poids (kg CO₂e / kg livré)
LOGISTICS_FACTOR_KGCO2_PER_KG = 0.6

# ---------------------------------------------------------------------------
# Modèles de requête / réponse (contrat d'API = ce que le SDK consomme)
# ---------------------------------------------------------------------------


class PurchaseItem(BaseModel):
    """Un article du panier, tel que transmis par le SDK marchand."""
    category: str = Field(
        default="other",
        description="Catégorie produit (electronics, clothing, food, ...)",
    )
    weightKg: float = Field(
        gt=0,
        description="Poids de l'article en kilogrammes",
    )
    sku: Optional[str] = Field(
        default=None,
        description="Référence produit côté marchand (optionnel)",
    )


class PurchaseEvent(BaseModel):
    """Corps de POST /v1/events/purchase — minimaliste par design (DX)."""
    orderId: str = Field(..., description="Identifiant de commande chez le marchand")
    items: List[PurchaseItem] = Field(..., min_length=1)
    currency: str = Field(default="EUR")
    totalAmount: Optional[float] = Field(default=None)


class ItemFootprint(PurchaseItem):
    co2eKg: float


class PurchaseResponse(BaseModel):
    eventId: str
    orderId: str
    merchant: str
    co2eKg: float
    items: List[ItemFootprint]
    receivedAt: str


class MerchantAnalytics(BaseModel):
    merchant: str
    totalOrders: int
    totalItems: int
    totalCo2eKg: float
    avgCo2ePerOrderKg: float
    co2eByCategoryKg: Dict[str, float]
    firstEventAt: Optional[str]
    lastEventAt: Optional[str]


# ---------------------------------------------------------------------------
# Stockage en mémoire
# ---------------------------------------------------------------------------

purchases: List[PurchaseResponse] = []

# ---------------------------------------------------------------------------
# Application FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(
    title="EcoMarketplace API",
    description=(
        "Plateforme de mesure d'empreinte carbone pour le e-commerce.\n\n"
        "Versant 1 (consommateurs) consulte les données ; versant 2 "
        "(marchands) les publie via le SDK EcoSDK."
    ),
    version=API_VERSION,
)


@app.middleware("http")
async def version_headers(request: Request, call_next):
    """Gouvernance : chaque réponse porte sa version d'API.

    Si le SDK cible une version dépréciée, on prévient sans casser
    (Deprecation/Sunset) — le marchand a le temps de migrer.
    """
    response: Response = await call_next(request)
    response.headers["X-API-Version"] = API_VERSION
    requested = request.headers.get("X-Api-Version-Request", API_VERSION)
    if requested in DEPRECATED_VERSIONS:
        response.headers["Deprecation"] = "true"
        response.headers["Sunset"] = DEPRECATED_VERSIONS[requested]
    return response


# ---------------------------------------------------------------------------
# Authentification (gérée automatiquement par le SDK côté marchand)
# ---------------------------------------------------------------------------


def authenticate(x_api_key: Optional[str] = Header(default=None)) -> str:
    """Valide la clé API et retourne le nom du marchand."""
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé API manquante. Fournissez l'en-tête 'X-API-Key'.",
        )
    merchant = MERCHANT_API_KEYS.get(x_api_key)
    if merchant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé API invalide ou révoquée.",
        )
    return merchant


# ---------------------------------------------------------------------------
# Logique métier : calcul d'empreinte carbone
# ---------------------------------------------------------------------------


def compute_footprint(items: List[PurchaseItem]) -> List[ItemFootprint]:
    """Calcule l'empreinte (kg CO₂e) de chaque article.

    Formule du TP :
        co2e = weightKg * facteur(catégorie) + weightKg * facteur_logistique
    En production : LCA complète, base ADEME, ML sur données réelles.
    """
    result: List[ItemFootprint] = []
    for item in items:
        factor = EMISSION_FACTORS_KGCO2_PER_KG.get(
            item.category, EMISSION_FACTORS_KGCO2_PER_KG["other"]
        )
        co2e = round(item.weightKg * (factor + LOGISTICS_FACTOR_KGCO2_PER_KG), 3)
        result.append(ItemFootprint(**item.model_dump(), co2eKg=co2e))
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/v1/health", tags=["system"])
async def health() -> dict:
    """Sonde de disponibilité — utilisée par le retry exponentiel du SDK."""
    return {"status": "ok", "version": API_VERSION}


@app.post(
    "/v1/events/purchase",
    response_model=PurchaseResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["events"],
    summary="Enregistrer un achat et son empreinte carbone",
)
async def track_purchase(
    event: PurchaseEvent,
    merchant: str = Depends(authenticate),
) -> PurchaseResponse:
    """Reçoit un événement d'achat du SDK marchand.

    La plateforme (pas le marchand) effectue le calcul carbone : c'est la
    valeur ajoutée du versant 2 — le marchand ne fait qu'envoyer ses
    données brutes, en 3 lignes de code.
    """
    footprint = compute_footprint(event.items)

    record = PurchaseResponse(
        eventId=str(uuid.uuid4()),
        orderId=event.orderId,
        merchant=merchant,
        co2eKg=round(sum(i.co2eKg for i in footprint), 3),
        items=footprint,
        receivedAt=datetime.now(timezone.utc).isoformat(),
    )
    purchases.append(record)
    return record


@app.get(
    "/v1/analytics/merchant",
    response_model=MerchantAnalytics,
    tags=["analytics"],
    summary="Statistiques carbone du commerçant connecté",
)
async def merchant_analytics(
    merchant: str = Depends(authenticate),
) -> MerchantAnalytics:
    """Tableau de bord du marchand : la 'monétisation' du versant 2.

    C'est cette valeur rendue (benchmark, image verte, conversion) qui
    motive les marchands à rester — boucle d'amorçage de la Partie 1.
    """
    mine = [p for p in purchases if p.merchant == merchant]

    if not mine:
        return MerchantAnalytics(
            merchant=merchant,
            totalOrders=0,
            totalItems=0,
            totalCo2eKg=0.0,
            avgCo2ePerOrderKg=0.0,
            co2eByCategoryKg={},
            firstEventAt=None,
            lastEventAt=None,
        )

    by_category: Dict[str, float] = defaultdict(float)
    total_items = 0
    for p in mine:
        for item in p.items:
            by_category[item.category] += item.co2eKg
            total_items += 1

    total_co2 = sum(p.co2eKg for p in mine)
    return MerchantAnalytics(
        merchant=merchant,
        totalOrders=len(mine),
        totalItems=total_items,
        totalCo2eKg=round(total_co2, 3),
        avgCo2ePerOrderKg=round(total_co2 / len(mine), 3),
        co2eByCategoryKg={k: round(v, 3) for k, v in by_category.items()},
        firstEventAt=min(p.receivedAt for p in mine),
        lastEventAt=max(p.receivedAt for p in mine),
    )


# ---------------------------------------------------------------------------
# Démarrage direct : python main.py
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    print("EcoMarketplace API - http://localhost:8000/docs")
    print("Cles de demo : mch_live_99x821a (greenShop), mch_live_testkey (demoStore)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
