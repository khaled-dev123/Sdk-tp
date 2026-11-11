/**
 * EcoMarketplace — EcoSDK (client-demo)
 * =====================================
 * Simulation du site e-commerce partenaire (versant 2 : Développeurs).
 *
 * Ce fichier joue deux rôles :
 *   1. Le SDK `EcoSDK` — la bibliothèque publiée sur npm pour les marchands
 *      (auth automatique, retry exponentiel, non-bloquant, init en 1 ligne).
 *   2. Un petit script de démonstration qui simule la validation d'un panier
 *      sur le site marchand — l'intégration tient en 3 lignes de code.
 *
 * Prérequis : Node.js 18+ (fetch natif).
 * Lancement : node app.js   (backend démarré au préalable sur :8000)
 *
 * ==========================================================================
 * PARTIE 1 — MODELLISATION ÉCONOMIQUE (rappel)
 * ==========================================================================
 * Le SDK est la SUBVENTION au versant développeurs : gratuit, 3 lignes de
 * code, jamais bloquant. Il résout le problème poule & œuf en réduisant le
 * coût marginal d'intégration d'un marchand à ≈ 0, ce qui accélère la boucle
 * d'amorçage des effets de réseau indirects (plus de marchands → plateforme
 * utile → consommateurs → trafic → nouveaux marchands).
 *
 * ==========================================================================
 * PARTIE 2 — CONTRAINTES D'ARCHITECTURE DU SDK
 * ==========================================================================
 *   ✅ Authentification automatique (clé API injectée à chaque requête)
 *   ✅ Gestion d'erreurs + retry asynchrone (backoff exponentiel, timeouts)
 *   ✅ Non-bloquant : le site marchand n'attend jamais la plateforme
 *      (option `fireAndForget` / dégradation gracieuse silencieuse)
 *   ✅ Simplicité d'initialisation : `new EcoSDK({ apiKey })`
 *
 * ==========================================================================
 * PARTIE 3 — GOUVERNANCE (protection contre les breaking changes)
 * ==========================================================================
 *   ✅ Version d'API cible fixée dans le SDK (API_VERSION_CIBLE = "v1")
 *   ✅ Envoi de `X-SDK-Version` et `X-Api-Version-Request` à chaque appel
 *   ✅ Lecture de `X-API-Version` + `Deprecation`/`Sunset` dans la réponse
 *      → avertissement (warning) sans casser l'intégration du marchand
 *   ✅ Le marchand ne manipule JAMAIS HTTP directement : si l'API interne
 *      change, c'est le SDK qui est mis à jour, pas les sites marchands.
 */

'use strict';

// ---------------------------------------------------------------------------
// Configuration du SDK
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env.ECO_API_URL || 'http://localhost:8000';
const API_VERSION_CIBLE = 'v1'; // version majeure supportée par ce SDK
const SDK_VERSION = '1.0.0';

/**
 * Erreurs typées : le marchand peut filtrer finement
 * (ex. try/catch sur EcoAuthError uniquement).
 */
class EcoError extends Error {
  constructor(message, { statusCode = null, cause = null } = {}) {
    super(message);
    this.name = 'EcoError';
    this.statusCode = statusCode;
    this.cause = cause;
  }
}
class EcoAuthError extends EcoError {
  constructor(message, cause) {
    super(message, { statusCode: cause?.statusCode ?? null, cause });
    this.name = 'EcoAuthError';
  }
}
class EcoRateLimitError extends EcoError {
  constructor(message, cause) {
    super(message, { statusCode: cause?.statusCode ?? null, cause });
    this.name = 'EcoRateLimitError';
  }
}
class EcoNetworkError extends EcoError {
  constructor(message, cause) {
    super(message, { statusCode: cause?.statusCode ?? null, cause });
    this.name = 'EcoNetworkError';
  }
}

// ---------------------------------------------------------------------------
// EcoSDK — la bibliothèque partenaire
// ---------------------------------------------------------------------------

class EcoSDK {
  /**
   * @param {object}  options
   * @param {string}  options.apiKey          Clé API marchand (mch_live_...)
   * @param {string}  [options.baseUrl]       URL de la plateforme
   * @param {boolean} [options.fireAndForget] true (défaut) : trackCarbon()
   *                                          résout immédiatement et rejoue
   *                                          en tâche de fond → le checkout
   *                                          du marchand n'est JAMAIS bloqué.
   * @param {number}  [options.maxRetries]    Tentatives supplémentaires (défaut 4)
   * @param {number}  [options.timeoutMs]     Délai par requête (défaut 5000)
   * @param {boolean} [options.debug]         Logs verbeux
   */
  constructor({
    apiKey,
    baseUrl = API_BASE_URL,
    fireAndForget = true,
    maxRetries = 4,
    timeoutMs = 5000,
    debug = false,
  }) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new EcoError(
        'EcoSDK : apiKey manquante. new EcoSDK({ apiKey: "mch_live_..." })'
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fireAndForget = fireAndForget;
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    this.debug = debug;
    this._journal = []; // historique local (auditabilité, anti-lock-in)
  }

  // -----------------------------------------------------------------------
  // Authentification automatique : injectée dans chaque requête
  // -----------------------------------------------------------------------
  #headers() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-SDK-Version': SDK_VERSION,
      'X-Api-Version-Request': API_VERSION_CIBLE, // gouvernance : version cible
    };
  }

  #log(...args) {
    if (this.debug) console.log('[EcoSDK]', ...args);
  }

  // -----------------------------------------------------------------------
  // Retry asynchrone avec backoff exponentiel
  // Politique : on retente uniquement les erreurs TRANSITOIRES
  //   → réseau, timeout, 5xx, 429 (rate limit).
  // On ne retente JAMAIS les erreurs 4xx client (401, 400...) : autant
  // échouer vite que marteler la plateforme de requêtes invalides.
  // -----------------------------------------------------------------------
  #isRetryable(statusCode) {
    if (statusCode === null) return true; // erreur réseau / timeout
    return statusCode === 429 || statusCode >= 500;
  }

  async #withRetry(fn, label = 'appel') {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const retryable = !(err instanceof EcoAuthError) && this.#isRetryable(err.statusCode);
        if (!retryable || attempt === this.maxRetries) break;

        // Backoff exponentiel : 250ms, 500ms, 1s, 2s... (+ jitter anti-orage)
        const delay = Math.min(250 * 2 ** attempt, 8000) + Math.random() * 100;
        this.#log(`${label} échoué (tentative ${attempt + 1}/${this.maxRetries + 1}) — nouvelle tentative dans ${Math.round(delay)}ms`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  async #fetchJson(path, { method = 'GET', body = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.#headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new EcoNetworkError(
        `EcoSDK : réseau injoignable (${err.name === 'AbortError' ? 'timeout' : err.message})`,
        { cause: err }
      );
    } finally {
      clearTimeout(timer);
    }

    // Gouvernance : lire la version servie + avertir si dépréciée
    const served = res.headers.get('x-api-version');
    if (served && served !== API_VERSION_CIBLE) {
      console.warn(
        `[EcoSDK] ⚠️ La plateforme sert l'API "${served}" (SDK prévu pour "${API_VERSION_CIBLE}"). ` +
          `Mettez à jour le SDK pour éviter toute rupture future.`
      );
    }
    if (res.headers.get('deprecation') === 'true') {
      console.warn(
        `[EcoSDK] ⚠️ API ${API_VERSION_CIBLE} dépréciée — sunset : ${res.headers.get('sunset') || 'non communiqué'}. ` +
          `Le SDK continuera de fonctionner, mais planifiez la migration.`
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new EcoAuthError('EcoSDK : clé API invalide ou révoquée.', { statusCode: res.status });
    }
    if (res.status === 429) {
      throw new EcoRateLimitError('EcoSDK : quota dépassé (429).', { statusCode: res.status });
    }
    if (res.status >= 400) {
      let detail = res.statusText;
      try {
        const errBody = await res.json();
        detail = errBody.detail ? JSON.stringify(errBody.detail) : JSON.stringify(errBody);
      } catch { /* corps non JSON : on garde statusText */ }
      throw new EcoError(`EcoSDK : erreur API (${res.status}) — ${detail}`, { statusCode: res.status });
    }

    return res.json();
  }

  // -----------------------------------------------------------------------
  // API publique du SDK — tout ce que le marchand doit connaître
  // (surface minimale : changer l'API interne n'impacte pas les marchands)
  // -----------------------------------------------------------------------

  /**
   * 📦 Enregistre un achat et son empreinte carbone.
   *
   * @param {object}  event
   * @param {string}  event.orderId
   * @param {Array<{category:string, weightKg:number, sku?:string}>} event.items
   * @param {object}  [opts]   { fireAndForget?: boolean }
   * @returns {Promise<object|null>} réponse de la plateforme (ou null en
   *          fire-and-forget : la promesse est rejouée en tâche de fond).
   *
   * Dégradation gracieuse : en fire-and-forget, une panne de la plateforme
   * n'est PAS propagée au site marchand — elle est journalisée localement
   * et l'event est conservé dans `eco.journal` pour un éventuel re-jeu.
   */
  trackCarbon(event, opts = {}) {
    const fireAndForget = opts.fireAndForget ?? this.fireAndForget;

    const doSend = async () => {
      const resp = await this.#withRetry(
        () => this.#fetchJson('/v1/events/purchase', { method: 'POST', body: event }),
        'trackCarbon'
      );
      this.#log('Achat enregistré :', resp.eventId, '→', resp.co2eKg, 'kg CO₂e');
      this.#journal.push({ sentAt: new Date().toISOString(), ok: true, event, resp });
      return resp;
    };

    if (!fireAndForget) return doSend();

    // Mode non-bloquant : le checkout marchand continue immédiatement.
    doSend().catch((err) => {
      console.warn('[EcoSDK] Événement mis en attente (plateforme injoignable) :', err.message);
      this.#journal.push({ sentAt: new Date().toISOString(), ok: false, event, error: err.message });
    });
    return null;
  }

  /**
   * 📊 Statistiques carbone du marchand (tableau de bord).
   */
  async getAnalytics() {
    return this.#withRetry(
      () => this.#fetchJson('/v1/analytics/merchant'),
      'getAnalytics'
    );
  }

  /**
   * 🔎 Journal local des envois — portabilité des données
   * (atténuation du lock-in, cf. Partie 3).
   */
  get journal() {
    return [...this.#journal];
  }
}

// ---------------------------------------------------------------------------
// DÉMONSTRATION — le site marchand partenaire (3 lignes d'intégration)
// ---------------------------------------------------------------------------
// C'est TOUT ce qu'un développeur partenaire écrit. Tout le reste
// (auth, retry, timeouts, erreurs, versionnement) est encapsulé dans le SDK.
// ---------------------------------------------------------------------------

async function simulateMerchantCheckout() {
  // ─────────── Intégration officielle du marchand : 3 lignes ───────────
  const eco = new EcoSDK({ apiKey: 'mch_live_99x821a', debug: true });

  eco.trackCarbon({                                   // ← 1
    orderId: 'ORD-12345',                             // ← 2
    items: [{ category: 'electronics', weightKg: 1.2 }], // ← 3
  });
  // ─────────────────────────────────────────────────────────────────────

  console.log('\n🛒 Panier validé — le site marchand continue sans attendre (fire-and-forget).');

  // Deuxième commande pour alimenter les analytics
  eco.trackCarbon({
    orderId: 'ORD-12346',
    items: [
      { category: 'clothing', weightKg: 0.8 },
      { category: 'books', weightKg: 1.5 },
    ],
  });

  // Laisser le temps au mode fire-and-forget d'envoyer les événements
  await new Promise((r) => setTimeout(r, 1500));

  // 📊 Le marchand consulte son tableau de bord (mode bloquant assumé ici)
  const analytics = await eco.getAnalytics();
  console.log('\n📊 Tableau de bord carbone du marchand :');
  console.log(JSON.stringify(analytics, null, 2));
}

// ---------------------------------------------------------------------------
// Démonstration bonus : résilience du SDK (retry + non-bloquant)
// ---------------------------------------------------------------------------

async function simulateResilience() {
  console.log('\n🧪 Test résilience : clé invalide → EcoAuthError, PAS de retry inutile.');
  try {
    const badEco = new EcoSDK({ apiKey: 'mch_live_INVALIDE', fireAndForget: false });
    await badEco.trackCarbon({ orderId: 'ORD-X', items: [{ category: 'food', weightKg: 2 }] });
  } catch (err) {
    console.log(`   → ${err.name} capté proprement : ${err.message}`);
  }

  console.log('\n🧪 Test résilience : plateforme injoignable → retry exponentiel,');
  console.log('   puis dégradation gracieuse (le site marchand N\'EST PAS bloqué).');
  const offlineEco = new EcoSDK({
    apiKey: 'mch_live_99x821a',
    baseUrl: 'http://localhost:9999', // port volontairement fermé
    maxRetries: 2,
    timeoutMs: 800,
  });
  offlineEco.trackCarbon({ orderId: 'ORD-OFFLINE', items: [{ category: 'food', weightKg: 2 }] });
  console.log('   → trackCarbon() a résolu immédiatement : le checkout continue ✅');
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`   → journal local (portabilité des données, anti-lock-in) : ${offlineEco.journal.length} entrée(s)`);
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' 🌱 EcoMarketplace — démonstration du SDK (client marchand)');
  console.log('════════════════════════════════════════════════════════════');
  await simulateMerchantCheckout();
  await simulateResilience();
  console.log('\n✅ Démonstration terminée.');
  console.log('   Intégration marchand réelle : 3 lignes de code.');
})();
