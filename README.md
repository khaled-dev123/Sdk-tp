# 🌱 TP — La plateforme numérique : EcoMarketplace

> **Équipe d'architecture** — Étude de cas : plateformes bilatérales, effets de réseau et Developer Experience (DX).

---

## 📋 Sujet du TP

**EcoMarketplace** est une jeune plateforme numérique qui met en relation deux versants :

| Versant | Acteurs | Besoin |
|---|---|---|
| **Versant 1 — Consommateurs** | Utilisateurs finaux | Mesurer l'empreinte carbone de leurs achats |
| **Versant 2 — Partenaires / Développeurs** | Sites e-commerce | Publier leurs données d'émissions produits sur la plateforme |

### Le problème économique

> Pour que la plateforme ait de la valeur pour les consommateurs (effets de réseau indirects), il faut un **maximum de marchands**. Mais les marchands ne viendront pas si l'intégration technique est **lourde et complexe**.

### Mission

Développer un **SDK léger** (Node.js / Python / JS browser) qui permet à n'importe quel site e-commerce d'intégrer le calcul d'empreinte carbone en **moins de 5 lignes de code**.

---

## 📁 Arborescence du projet

```
tp-sdk-ecomarketplace/
├── README.md              # Sujet du TP et instructions (ce fichier)
├── backend/               # API de la plateforme (Python / FastAPI)
│   ├── main.py            # POST /v1/events/purchase + GET /v1/analytics/merchant
│   └── requirements.txt
└── client-demo/           # Simulation du site e-commerce partenaire
    └── app.js             # EcoSDK : encapsulation des appels API
```

---

# Partie 1 — Modélisation Économique & Stratégie

## 1. Cartographie de la plateforme : flux de valeur

```
                         ┌──────────────────────────────────────────┐
                         │            ECOMARKETPLACE                │
                         │   (API centrale + SDK + données CO₂)     │
                         └────────────┬───────────────┬─────────────┘
                    ▲ valeur rendue   │               │   ▲ valeur rendue
                    │ (badge carbone, │               │   │ (analytics CO₂,
                    │  comparateur,   │               │   │  badges vert,     )
                    │  avis, trafic)  │               │   │  image de marque) │
                    │                 │               │   │                   │
   ┌────────────────┴───────┐         │               └───┴──────────────┐
   │   VERSANT 1            │         │               │   VERSANT 2      │
   │   CONSOMMATEURS        │         │               │   E-COMMERÇANTS  │
   ├────────────────────────┘         ▼               └──────────────────┤
   │ • Apportent : trafic, │   (boucle de   │ • Apportent : données      │
   │   attention, avis,    │    croissance  │   produits, événements     │
   │   données d'usage,    │    croisée ⤴   │   d'achat, crédibilité     │
   │   crédibilité sociale │                │   ("preuves d'usage")      │
   │ • Monétisation :      │                │ • Monétisation : conversion│
   │   freemium / gratuit  │                │   accrue, SaaS premium     │
   └───────────────────────┘                └────────────────────────────┘
```

**Flux de valeur dans le sens horaire (boucle croisée) :**

1. Les **e-commerçants** fournissent des données d'émissions → la plateforme devient **utilisable** pour les consommateurs.
2. Les **consommateurs** fournissent du trafic, des avis et des données d'usage → la plateforme devient **rentable et crédible** pour les marchands (badge vert + audiences engagées).
3. La valeur croisée attire de nouveaux acteurs de chaque côté → **boucle de rétroaction positive** (flywheel).

### Effet de réseau direct (same-side)

> Plus il y a de **consommateurs**, plus chaque consommateur tire de valeur de la plateforme.

- **Avis et évaluations** : plus d'utilisateurs = plus d'avis sur les produits les plus sobres → le comparateur carbone devient plus pertinent et fiable pour tous.
- **Données comportementales** : plus d'achats enregistrés = algorithmes d'estimation carbone plus précis (facteurs d'émission par catégorie affinés par le machine learning sur données réelles).
- **Effet social / réputation** : les consommateurs "éco-conscients" gagnent à ce que d'autres consommateurs participent (classements, challenges, partage).

### Effet de réseau indirect (cross-side)

> Plus il y a de **commerçants**, plus l'application est utile pour le **consommateur** (et réciproquement).

- **Couverture catalogue** : chaque marchand connecté ajoute des produits dont l'empreinte est calculable. Un comparateur carbone qui couvre 5 % du marché est un gadget ; à 60 %, il devient un réflexe d'achat.
- **Effet miroir pour les marchands** : plus il y a de consommateurs actifs, plus le tableau de bord analytics du marchand a de valeur (benchmark sectoriel, comparaison de ses émissions vs concurrents).
- **Standard de fait** : si assez de marchands publient leurs données sur EcoMarketplace, cela devient la référence de mesure carbone du e-commerce → barrière à l'entrée pour les plateformes concurrentes.

## 2. Analyse du rôle du SDK : la subvention du versant développeurs

### Théorie : le problème de la poule et de l'œuf

Une plateforme bilatérale ne peut démarrer que si **les deux versants existent simultanément**. Or :

- Les consommateurs ne viennent pas sans catalogue de produits chiffrés (versant 2 requis).
- Les marchands n'intègrent pas sans audience de consommateurs (versant 1 requis).

Stratégie classique de démarrage : **subventionner un versant** (le rendre gratuit, facile, sans friction) pour amorcer l'autre. On appelle ce versant le ***subsidized side*** et l'autre le ***money side***.

### Pourquoi le SDK est la subvention idéale

| Attribut du SDK | Subvention apportée | Problème économique résolu |
|---|---|---|
| **Gratuité** | Coût d'acquisition marchand = 0 € | Élimine le frein budgétaire ; le marchand n'a rien à décider en comité |
| **Simplicité (3 lignes de code)** | Coût d'intégration ≈ 1 heure de dev junior | Élimine le frein technique ; pas de refonte du SI |
| **Non-bloquant (async, retry)** | Zéro risque pour la boutique en production | Élimine le frein operationnel ; pas de latence ajoutée au checkout |
| **Gratuité du versant consommateur** | Les consommateurs paient avec leurs **données et attention** | Le versant consommateur est le subsidized side à long terme ; le SDK est le levier d'amorçage du versant marchand |

### Le raisonnement en boucle

```
SDK gratuit & simple
      │
      ▼
TTFC (temps avant le 1er appel API) très court
      │
      ▼
Intégrations marchands rapides → versant 2 grossit vite
      │
      ▼
Catalogue carbone large → plateforme utile (effet réseau indirect)
      │
      ▼
Consommateurs arrivent → trafic & données
      │
      ▼
Analytics & audiences attractives → nouveaux marchands ⤴ (boucle)
```

> **Conclusion stratégique :** le SDK n'est pas un produit, c'est un **investissement d'amorçage** (loss leader). Sa gratuité "perd" de l'argent à court terme mais résout le problème de la poule et de l'œuf en abaissant le coût marginal d'intégration d'un marchand à ≈ 0. La monétisation se fera ensuite sur le **money side** (marchands premium : analytics avancées, API historique, badges certifiés).

---

# Partie 2 — Implémentation Technique du SDK

## Step 1 : L'API de la plateforme (backend FastAPI)

Deux points d'accès (voir `backend/main.py`) :

| Méthode | Endpoint | Rôle |
|---|---|---|
| `POST` | `/v1/events/purchase` | Enregistre un achat ; la plateforme **calcule** l'empreinte carbone à partir des articles |
| `GET` | `/v1/analytics/merchant` | Statistiques du commerçant (nb commandes, CO₂ total, répartition par catégorie) |

Authentification : clé API `mch_live_...` passée dans l'en-tête `X-API-Key`.

### Lancer le backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Documentation interactive : http://localhost:8000/docs

## Step 2 : Le SDK (EcoSDK)

Contraintes d'architecture respectées dans `client-demo/app.js` :

1. **Authentification automatique** — la clé API est fournie à l'initialisation et injectée dans chaque requête.
2. **Gestion d'erreurs + retry asynchrone** — backoff exponentiel, mode `fire-and-forget` (le site marchand n'est **jamais bloqué** par une panne de la plateforme).
3. **Simplicité d'initialisation** — une seule classe, une seule option obligatoire.

### Exemple d'intégration marchand (3 lignes)

```javascript
// Le développeur marchand intègre le SDK en 3 lignes :
const eco = new EcoSDK({ apiKey: "mch_live_99x821a" });

// Déclenchement automatique lors de la validation du panier
await eco.trackCarbon({
  orderId: "ORD-12345",
  items: [
    { category: "electronics", weightKg: 1.2 }
  ]
});
```

### Lancer la démo

```bash
# Terminal 1 : backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 : site marchand (simulation)
cd client-demo && node app.js
```

---

# Partie 3 — Mesure de la Friction & Analyse Critique

## 1. Developer Experience (DX) & boucle de rétroaction

### De 40 lignes à 3 lignes : l'impact sur le TTFC

**Time-to-First-Call (TTFC)** = temps écoulé entre le moment où un développeur découvre la plateforme et le moment où son **premier appel API réussit** en production.

Sans SDK (40 lignes de `fetch/axios` manuels), le développeur doit :

1. Lire la documentation d'authentification, comprendre le schéma d'en-têtes.
2. Construire manuellement la requête HTTP (URL, headers, corps JSON, codes d'erreur).
3. Gérer les cas limites (timeout, 429 rate-limit, 5xx) lui-même.
4. Écrire des tests, déboguer les erreurs de sérialisation.

→ TTFC typique : **2 à 5 jours**. Chaque étape est une occasion d'**abandon** (churn du versant développeurs).

Avec EcoSDK (3 lignes) :

```javascript
const eco = new EcoSDK({ apiKey: "mch_live_99x821a" });   // 1
await eco.trackCarbon({ orderId, items });                // 2-3
```

→ TTFC typique : **15 à 60 minutes**. L'authentification, le retry, la sérialisation et la gestion d'erreurs sont **encapsulés** : le développeur ne manipule jamais HTTP directement.

### Impact direct du TTFC sur la croissance du versant "Marchands"

| TTFC | Comportement du développeur | Conséquence plateforme |
|---|---|---|
| Long (jours) | Abandon fréquent avant le premier appel ; projet "en pause" | Pipeline d'intégration qui fuit ; croissance lente |
| Court (minutes) | *Aha! moment* immédiat → intégration finalisée le jour même | Effet de levier : chaque développeur convaincu devient un marchand connecté |

Le TTFC agit comme un **multiplicateur de conversion** sur tout le funnel d'acquisition du versant 2 : visite du site → inscription → première intégration → **marchand actif**. Réduire le TTFC de 5 jours à 30 minutes peut multiplier le taux de conversion du funnel par 5 à 10, car la friction se concentre au moment où la motivation du développeur est **maximale**. À l'échelle de l'écosystème, c'est la **vitesse de rotation de la boucle d'amorçage** (Partie 1, §2) qui s'accélère : plus de marchands connectés par semaine → effets de réseau indirects plus rapides → avantage concurrentiel durable.

## 2. Gouvernance & Lock-in

### Protection contre les breaking changes (API v2)

Le SDK protège les partenaires par **versionnement et encapsulation** :

1. **Version explicite dans le SDK** : le SDK envoie `X-SDK-Version` et cible une version d'API majeure (ex. `/v1`). Le backend maintient **v1 et v2 en parallèle** ; un marchand avec un SDK v1 continue de fonctionner pendant toute la période de dépréciation.
2. **Négociation de version** : le backend répond avec `X-API-Version` ; si la version demandée est dépréciée, le SDK logue un avertissement (`deprecation warning`) sans casser l'intégration, laissant au marchand plusieurs mois pour migrer.
3. **Surface d'API réduite** : le marchand ne connaît que `trackCarbon()` et `getAnalytics()`. Si l'API interne change (nouveau champ, nouvel endpoint), c'est le **SDK qui est mis à jour**, pas les milliers de sites marchands. Le changement est absorbé par la plateforme, invisible pour le partenaire.
4. **Contract tests / CI** : le SDK embarque des tests de contrat contre l'API ; une régression est détectée avant publication, jamais chez le marchand.

### Risque de lock-in pour l'e-commerçant

| Dimension | Analyse |
|---|---|
| **Technique** | Le marchand dépend du SDK pour l'envoi d'événements ; remplacer EcoMarketplace impose de réécrire l'intégration (coût faible ici : 3 lignes, mais avec données historiques perdues si mal exportées) |
| **Données** | ⚠️ Risque principal : l'**historique des empreintes carbone** s'accumule chez la plateforme. Si le marchand veut partir, il doit pouvoir **exporter ses données** (droit à la portabilité) |
| **Commercial** | Si le badge carbone EcoMarketplace devient un canal d'acquisition, le perdre = perdre du trafic → coût de sortie réel |
| **Stratégique** | La plateforme peut modifier ses prix une fois le marchand intégré (monopole de fait sur la mesure carbone) |

**Atténuation (bonne gouvernance)** : publication des **facteurs d'émission** en open data, export CSV/JSON des données marchand via un endpoint dédié, SDK open source (auditabilité), engagement contractuel de maintien de v1 pendant N mois après toute v2. Un lock-in *modéré et transparent* est sain pour la plateforme ; un lock-in *opaque* détruirait la confiance — l'actif le plus précieux d'une marketplace.

---

# ✅ Checklist de validation du TP

- [x] Cartographie des flux de valeur + identification des effets de réseau direct et indirect
- [x] Analyse du SDK comme subvention au versant développeurs (poule & œuf)
- [x] API REST avec `POST /v1/events/purchase` et `GET /v1/analytics/merchant`
- [x] SDK avec auth auto, retry exponentiel, non-bloquant, init en 1 ligne
- [x] Intégration marchand démontrée en 3 lignes de code
- [x] Analyse DX / TTFC et gouvernance / lock-in
