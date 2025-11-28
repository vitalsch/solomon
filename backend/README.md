# Wealth Planner Backend

Dieses Backend stellt REST Endpunkte bereit, um Nutzer, Szenarien, Assets und Transaktionen in MongoDB zu verwalten und bestehende Simulationen aus `wealth_plan_5.py`/dem React Frontend mit dynamischen Daten zu speisen.

## API Kurzreferenz (für den AI Assistant)

- Auth  
  - `POST /auth/register` `{username, password, name?, email?}` → `{token, user}`  
  - `POST /auth/login` `{username, password}` → `{token, user}`  
  - `GET /me` → aktueller User; `DELETE /me` entfernt ihn (inkl. Daten)
- Szenarien  
  - `GET /scenarios` (User-scoped), `GET /scenarios/{id}`  
  - `POST /scenarios` `{name, start_year, start_month, end_year, end_month, description?, inflation_rate?, income_tax_rate?, wealth_tax_rate?}`  
  - `PATCH /scenarios/{id}` dieselben Felder optional, `DELETE /scenarios/{id}`  
  - `POST /scenarios/{id}/simulate` → `account_balances`, `total_wealth`, `cash_flows`
- Assets  
  - `GET /scenarios/{scenario_id}/assets`  
  - `POST /scenarios/{scenario_id}/assets` `{name, annual_growth_rate=0 (bei Konten = Verzinsung/Zins), initial_balance=0, asset_type? (generic|real_estate|bank_account|mortgage), start_year?, start_month?, end_year?, end_month?}`  
  - `PATCH /assets/{asset_id}` optionale Felder wie oben, `DELETE /assets/{asset_id}`
  - Assistant-Plan-Aktion `update_asset` erlaubt Updates (z.B. growth_rate) per Name/ID (alias) statt Neuanlage.
- Transaktionen  
  - `GET /scenarios/{scenario_id}/transactions`  
  - `POST /scenarios/{scenario_id}/transactions` Basisfelder: `{asset_id, name, amount, type (one_time|regular|mortgage_interest), start_year, start_month, end_year?, end_month?, frequency?, annual_growth_rate?}`  
    - Double Entry: `double_entry=true` + `counter_asset_id` (≠ `asset_id`)  
    - Mortgage Interest: `mortgage_asset_id` + `asset_id` (Zahler), `annual_interest_rate` oder `annual_growth_rate`, `frequency` > 0  
    - Tax: `taxable` (bool), `taxable_amount` (Basis); Szenario-`income_tax_rate` wird angewendet  
  - `PATCH /transactions/{transaction_id}` optionale Felder wie oben, `DELETE /transactions/{transaction_id}`
  - Assistant-Plan-Aktion `update_transaction` erlaubt Updates per Name/ID (alias) statt Neuanlage; oder `overwrite=true` bei create, um alte gleichnamige zu ersetzen.
- Assistant-spezifisch  
  - `POST /assistant/chat` `{messages:[{role: system|user|assistant, content}], context?:{scenario_id?, scenario_name?, auto_apply?}}` → `{messages, plan|null, reply}`; benötigt `OPENAI_API_KEY`  
  - `POST /assistant/apply` `{plan:{actions:[...]}}` führt Plan-Aktionen aus (create/update/delete Asset/Transaction, create/use/delete Scenario etc.)

### Assistant-Hinweise / Mapping typischer Begriffe
- „Überweisung/Transfer/Umbuchung“ → `create_transaction` mit `double_entry=true`, `asset_id` = zahlt ab, `counter_asset_id` = empfängt; `tx_type=regular` oder `one_time` je Kontext; bei fehlenden Konten nachfragen.  
- „monatlich/regelmäßig/Gehaltszahlung“ → `tx_type=regular`, `frequency=1` (wenn nicht angegeben).  
- Vor Ausführen: kurz tabellarisch/knapp zusammenfassen, Zustimmung einholen; `auto_apply` nur setzen, wenn der Nutzer explizit zustimmt (oberste Ebene, nicht als Action).  
- Unklare Typen: nachfragen statt neue Typen erfinden (erlaubt: `one_time`, `regular`, `mortgage_interest`).  
- Wenn kein Szenario genannt: aktuelles Szenario aus dem Frontend verwenden, sonst nach dem Namen fragen.  
- Fehlende Pflichtfelder (Szenario, Asset/Konto, Betrag, Typ, Startdatum) immer nachfragen.
- Hypothek: Keine Wachstumsrate auf dem Asset; Zinssatz gehört ausschließlich in die `mortgage_interest`-Transaktion.
 - "Zinsen/Zinssatz/Zinszahlungen oder ähnliches" → `create_transaction` mit `type=mortgage_interest`(Felder: asset_id Zahler, mortgage_asset_id, annual_interest_rate, frequency, Start/Ende).

Hinweise: Alle Endpunkte sind auf den eingeloggten User gescoped (Bearer-Token). Fehlende Frequenzen werden intern als 1 interpretiert, um `% None` zu vermeiden. CORS erlaubt standardmäßig `*`, Host lokal `http://127.0.0.1:8000`.

## Setup

1. Stelle sicher, dass ein MongoDB Server läuft **oder** nutze die gegebene Atlas-Instanz und setze die Verbindungsdaten:

```bash
export MONGODB_URI="mongodb+srv://eugen:<db_password>@cluster0.ohdjwwo.mongodb.net/"
export MONGODB_DB="wealth_planner"
```

> **Tipp:** Wenn du Docker nutzt, kannst du den enthaltenen `docker-compose.yml` starten:
>
> ```bash
> docker compose up -d
> export MONGODB_URI="mongodb://root:example@localhost:27017/?authSource=admin"
> ```
>
> Die Daten werden im benannten Volume `mongo-data` persistiert.

2. Installiere die Abhängigkeiten und starte das Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.api:app --reload
```

Der Server läuft anschließend auf `http://127.0.0.1:8000`. Die FastAPI Doku ist unter `http://127.0.0.1:8000/docs` erreichbar.

### Alles-in-einem Skript

Statt die oben stehenden Kommandos einzeln auszuführen kannst du alles über das Hilfsskript starten:

```bash
./scripts/start_backend.sh
# Optional:
#   VENV_PATH="$HOME/.virtualenvs/solomon" ./scripts/start_backend.sh
#   MONGODB_URI="mongodb://..." ./scripts/start_backend.sh
#   SKIP_MONGO=1 MONGODB_URI="mongodb+srv://eugen:<db_password>@cluster0.ohdjwwo.mongodb.net/" ./scripts/start_backend.sh
```

Das Skript führt `docker compose up -d mongo` aus, setzt Standard-Umgebungsvariablen (`MONGODB_URI`, `MONGODB_DB`) und startet `uvicorn backend.api:app --reload`. Per `SKIP_VENV=1` überspringst du das automatische Aktivieren des localen Virtual Environments.

## Datenmodell

| Ressource | Felder (Auszug) |
|-----------|-----------------|
| `users` | `name`, `email` |
| `scenarios` | `user_id`, `name`, `start_year`, `start_month`, `end_year`, `end_month`, `description` |
| `assets` | `scenario_id`, `name`, `annual_growth_rate`, `initial_balance`, optionale Laufzeitfenster |
| `transactions` | `scenario_id`, `asset_id`, `name`, `type` (`one_time`, `regular`, `mortgage_interest`), `amount`, `start_year`, `start_month`, optionale `end_year`, `end_month`, `frequency`, `annual_growth_rate`, optionale `mortgage_asset_id`, `annual_interest_rate`, `counter_asset_id` |

## Typische Requests

1. **Nutzer & Szenario anlegen**

```bash
curl -X POST http://localhost:8000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Stella","email":"stella@example.com"}'

curl -X POST http://localhost:8000/scenarios \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<USER_ID>","name":"Default Plan","start_year":2024,"start_month":5,"end_year":2044,"end_month":9}'
```

2. **Assets & Transaktionen anhängen**

```bash
curl -X POST http://localhost:8000/scenarios/<SCENARIO_ID>/assets \
  -H "Content-Type: application/json" \
  -d '{"name":"Savings","annual_growth_rate":0.0,"initial_balance":10000}'

curl -X POST http://localhost:8000/scenarios/<SCENARIO_ID>/transactions \
  -H "Content-Type: application/json" \
  -d '{"asset_id":"<ASSET_ID>","name":"Salary","amount":17814,"type":"regular","start_year":2024,"start_month":1,"end_year":2050,"end_month":12,"frequency":1,"annual_growth_rate":0.02}'

# Verbundene Buchung (Debit/Credit)
curl -X POST http://localhost:8000/scenarios/<SCENARIO_ID>/transactions \
  -H "Content-Type: application/json" \
  -d '{"asset_id":"<DEBIT_ASSET_ID>","counter_asset_id":"<CREDIT_ASSET_ID>","double_entry":true,"name":"Umbuchung","amount":5000,"type":"one_time","start_year":2024,"start_month":5}'
> Die Antwort enthält das angelegte Debit-Objekt plus `linked_transaction` mit der Credit-Seite. Beim Löschen einer Seite (oder eines Assets) wird die gekoppelte Buchung automatisch mit entfernt.

# Hypothekarzins (belastet Konto, bezieht Saldo der Hypothek dynamisch)
curl -X POST http://localhost:8000/scenarios/<SCENARIO_ID>/transactions \
  -H "Content-Type: application/json" \
  -d '{"asset_id":"<ZAHLER_ASSET_ID>","mortgage_asset_id":"<MORTGAGE_ASSET_ID>","type":"mortgage_interest","name":"Hypozins","frequency":1,"annual_interest_rate":0.02,"start_year":2024,"start_month":5,"end_year":2025,"end_month":12}'
> Betrag wird in jeder Periode aus dem aktuellen Hypothekensaldo berechnet; beim Löschen der Hypothek verschwindet diese Zins-Transaktion ebenfalls.
```

3. **Simulation auslösen**

```bash
curl -X POST http://localhost:8000/scenarios/<SCENARIO_ID>/simulate
```

Die Antwort enthält Zeitreihen pro Asset sowie die gesamte Vermögensentwicklung, die in das React Frontend integriert werden kann.

## Integration ins Frontend

- Ersetze die lokale `localStorage`-Persistenz im React Projekt durch API-Calls (z. B. über `fetch` oder `axios`).
- Für Szenario-Vergleiche können mehrere `simulate`-Calls (je Szenario) parallel abgefeuert werden.
- Wenn du bestehende CSV/JSON Daten hast (z. B. aus `wealth_plan_5.py`), schreibe ein kleines Seed-Skript, das `WealthRepository` aus `backend/repository.py` verwendet.

## Re-Use in Python Scripts

`backend/services.py` stellt `run_scenario_simulation` bereit. Damit lassen sich Simulationen direkt aus Python triggern:

```python
from backend.services import run_scenario_simulation

result = run_scenario_simulation("<SCENARIO_ID>")
print(result["total_wealth"])
```

So kann `wealth_plan_5.py` oder jedes neue Notebook identische Daten verwenden.
