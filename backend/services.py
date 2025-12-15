from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from copy import deepcopy

from .domain import (
    Account,
    MortgageInterestTransaction,
    OneTimeTransaction,
    RegularTransaction,
    simulate_account_balances_and_total_wealth,
)
from .repository import WealthRepository

def _coalesce_dates(tx_doc, scenario_defaults: Optional[Dict] = None):
    """Return start/end year/month with safe defaults if values are missing/None."""
    today = datetime.utcnow()
    start_year = tx_doc.get("start_year") or (scenario_defaults or {}).get("start_year") or today.year
    start_month = tx_doc.get("start_month") or (scenario_defaults or {}).get("start_month") or today.month
    end_year = tx_doc.get("end_year") or (scenario_defaults or {}).get("end_year") or start_year
    end_month = tx_doc.get("end_month") or (scenario_defaults or {}).get("end_month") or start_month
    return start_year, start_month, end_year, end_month


def _coalesce_asset_dates(asset_doc: Dict, scenario_defaults: Optional[Dict] = None):
    """Return start/end year/month for an asset with scenario fallbacks."""
    defaults = scenario_defaults or {}
    start_year = asset_doc.get("start_year") or defaults.get("start_year")
    start_month = asset_doc.get("start_month") or defaults.get("start_month")
    end_year = asset_doc.get("end_year") or defaults.get("end_year")
    end_month = asset_doc.get("end_month") or defaults.get("end_month")
    return start_year, start_month, end_year, end_month


def _create_transaction_instance(tx_doc, amount_override=None, scenario_defaults: Optional[Dict] = None):
    tx_type = tx_doc.get("type", "one_time")
    amount = tx_doc.get("amount", 0.0) if amount_override is None else amount_override
    is_internal = bool(tx_doc.get("double_entry") or tx_doc.get("counter_asset_id"))
    start_year, start_month, end_year, end_month = _coalesce_dates(tx_doc, scenario_defaults)
    frequency = tx_doc.get("frequency") or 1
    annual_growth_rate = tx_doc.get("annual_growth_rate", 0.0) or 0.0
    inflation_schedule = tx_doc.get("inflation_schedule", [])
    if tx_type == "regular":
        tx_instance = RegularTransaction(
            tx_doc.get("name", "Regular Transaction"),
            amount,
            start_month,
            start_year,
            end_month,
            end_year,
            frequency,
            annual_growth_rate,
        )
    else:
        tx_instance = OneTimeTransaction(
            tx_doc.get("name", "One-Time Transaction"),
            amount,
            start_month,
            start_year,
        )
    setattr(tx_instance, "id", tx_doc.get("id"))
    setattr(tx_instance, "tx_type", tx_type)
    setattr(tx_instance, "internal", is_internal)
    setattr(tx_instance, "inflation_schedule", inflation_schedule)
    return tx_instance


def _build_transactions(transaction_docs, account_map, income_tax_rate: float = 0.0, scenario_defaults: Optional[Dict] = None):
    account_transactions: Dict[Account, List] = {account: [] for account in account_map.values()}
    mortgage_interest_transactions: List[MortgageInterestTransaction] = []

    for tx in transaction_docs:
        tx_type = tx.get("type")

        if tx_type == "mortgage_interest":
            mortgage = account_map.get(tx.get("mortgage_asset_id"))
            payer = account_map.get(tx.get("asset_id"))  # payer account
            if not mortgage or not payer:
                continue
            start_year, start_month, end_year, end_month = _coalesce_dates(tx, scenario_defaults)
            frequency = tx.get("frequency") or 1
            # Use the same annual_growth_rate field to carry interest for consistency with other tx
            annual_interest_rate = tx.get("annual_interest_rate") or tx.get("annual_growth_rate") or 0.0
            # Optional rate schedule from stress overrides
            rate_schedule = []
            for entry in tx.get("rate_schedule", []):
                start_key = (entry.get("start") or 0)
                end_key = entry.get("end")
                rate_schedule.append((start_key, end_key, entry.get("rate")))

            interest_tx = MortgageInterestTransaction(
                tx.get("name", "Mortgage Interest"),
                mortgage,
                payer,
                annual_interest_rate,
                frequency,
                start_month,
                start_year,
                end_month,
                end_year,
            )
            setattr(interest_tx, "id", tx.get("id"))
            setattr(interest_tx, "tx_type", "mortgage_interest")
            setattr(interest_tx, "rate_schedule", rate_schedule)
            # carry tax info so simulation can include tax effects (simple rate if provided)
            setattr(interest_tx, "taxable", bool(tx.get("taxable")))
            setattr(interest_tx, "tax_rate", income_tax_rate or 0.0)
            mortgage_interest_transactions.append(interest_tx)
            continue

        account = account_map.get(tx.get("asset_id"))
        if not account:
            continue
        transaction = _create_transaction_instance(tx, scenario_defaults=scenario_defaults)
        if tx.get("taxable"):
            taxable_amount = tx.get("taxable_amount", tx.get("amount", 0.0))
            # keep attributes for reporting; actual tax will be handled in progressive calc
            setattr(transaction, "tax_effect", 0.0)
            setattr(transaction, "taxable_amount", taxable_amount)
            setattr(transaction, "tax_rate", income_tax_rate or 0.0)
            setattr(transaction, "gross_amount", tx.get("amount", 0.0) or 0.0)
        account_transactions[account].append(transaction)
    return account_transactions, mortgage_interest_transactions


def _safe_number(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_per100(val):
    try:
        rate = float(val or 0)
    except (TypeError, ValueError):
        rate = 0.0
    rate = max(0.0, rate)
    if rate > 20:
        return 11.5
    return rate


def _calc_tariff_table(
    amount: float,
    rows: List[Dict],
    threshold_key: str,
    base_key: str,
    per_key: str,
    last_per100_cap: Optional[float] = None,
) -> float:
    taxable = max(0.0, amount or 0.0)
    if not rows:
        return 0.0
    sanitized = []
    for row in rows:
        try:
            threshold = float(row.get(threshold_key) or 0.0)
        except (TypeError, ValueError):
            threshold = 0.0
        base_amount = float(row.get(base_key) or 0.0)
        per100 = _safe_per100(row.get(per_key))
        sanitized.append(
            {
                "threshold": threshold,
                "base": base_amount,
                "per100": per100,
            }
        )
    sanitized.sort(key=lambda entry: entry["threshold"])
    if taxable <= sanitized[0]["threshold"]:
        entry = sanitized[0]
        result = entry["base"] + ((taxable - entry["threshold"]) / 100) * entry["per100"]
        return max(0.0, result)
    for i in range(len(sanitized) - 1):
        curr = sanitized[i]
        nxt = sanitized[i + 1]
        if taxable >= curr["threshold"] and taxable < nxt["threshold"]:
            return curr["base"] + ((taxable - curr["threshold"]) / 100) * curr["per100"]
    last = sanitized[-1]
    per100 = last["per100"]
    if last_per100_cap is not None:
        per100 = min(per100, last_per100_cap)
    return max(0.0, last["base"] + ((taxable - last["threshold"]) / 100) * per100)


def _calc_federal(income: float, table: List[Dict]) -> float:
    key_sample = table[0] if table else {}
    if "threshold" in key_sample or "base_amount" in key_sample:
        return _calc_tariff_table(income, table, "threshold", "base_amount", "per_100_amount", last_per100_cap=11.5)
    return _calc_tariff_table(income, table, "income", "base", "per100", last_per100_cap=11.5)


def _collect_yearly_tax(
    transactions: List[Dict],
    cash_flows: List[Dict],
    total_history: List[tuple],
    scenario: Dict,
    tax_tables: Optional[Dict[str, Any]] = None,
):
    """
    Repliziert die bisherige Frontend-Steuerlogik: steuerbare Transaktionen -> Einkommen/Vermögen pro Jahr,
    dann progressive Einkommen-/Vermögenssteuer, Personalsteuer und direkte Bundessteuer.
    """
    # Sammle steuerbare Einnahmen/Ausgaben pro Jahr (absolut)
    def add_entry(store, year, income_add, expense_add):
        entry = store.get(year, {"year": year, "income": 0.0, "expense": 0.0, "net": 0.0})
        entry["income"] += income_add
        entry["expense"] += expense_add
        entry["net"] = entry["income"] - entry["expense"]
        store[year] = entry

    taxable_map: Dict[int, Dict] = {}
    taxable_mortgage_ids = set()
    taxable_mortgage_names = set()
    for tx in transactions:
        if tx.get("type") == "mortgage_interest" and tx.get("taxable"):
            if tx.get("id"):
                taxable_mortgage_ids.add(tx.get("id"))
            if tx.get("name"):
                taxable_mortgage_names.add(tx.get("name"))

    defaults = {
        "municipal_tax_factor": _safe_number(scenario.get("municipal_tax_factor"), 0.0),
        "cantonal_tax_factor": _safe_number(scenario.get("cantonal_tax_factor"), 0.0),
        "church_tax_factor": _safe_number(scenario.get("church_tax_factor"), 0.0),
        "personal_tax_per_person": _safe_number(scenario.get("personal_tax_per_person"), 0.0),
    }
    household_size = 2 if scenario.get("tax_marital_status") == "verheiratet" else 1

    for tx in transactions:
        if not tx.get("taxable"):
            continue
        amount = tx.get("taxable_amount", tx.get("amount", 0.0)) or 0.0
        amount = abs(float(amount))
        tx_type = tx.get("type")
        if tx_type == "mortgage_interest":
            # tatsächliche Zinskosten kommen aus der Simulation (cash_flows)
            continue
        start_year = tx.get("start_year") or 0
        start_month = tx.get("start_month") or 1
        end_year = tx.get("end_year") or start_year
        end_month = tx.get("end_month") or start_month
        freq = max(1, tx.get("frequency") or 1)
        category = "expense" if (tx.get("entry") == "credit" or tx.get("amount", 0) < 0) else "income"
        if tx_type == "regular":
            y, m = start_year, start_month
            limit = 1000
            counter = 0
            while y < end_year or (y == end_year and m <= end_month):
                add_entry(taxable_map, y, 0 if category == "expense" else amount, amount if category == "expense" else 0)
                m += freq
                while m > 12:
                    m -= 12
                    y += 1
                counter += 1
                if counter > limit:
                    break
        else:
            add_entry(taxable_map, start_year, 0 if category == "expense" else amount, amount if category == "expense" else 0)

    # Hypothekarzinsen: hole effektive Zahlungen aus der Simulation und ziehe sie als Ausgaben ab
    if taxable_mortgage_ids or taxable_mortgage_names:
        for entry in cash_flows:
            year = entry.get("date").year if entry.get("date") else None
            if not year:
                continue
            for detail in entry.get("expense_details") or []:
                if (detail.get("tx_type") or "").lower() != "mortgage_interest":
                    continue
                tx_id = detail.get("transaction_id")
                name = detail.get("name")
                if tx_id and tx_id in taxable_mortgage_ids:
                    pass
                elif name and name in taxable_mortgage_names:
                    pass
                else:
                    continue
                amount = abs(float(detail.get("amount") or 0.0))
                if amount:
                    add_entry(taxable_map, year, 0, amount)

    # Vermögen pro Jahr: letztes Total des Jahres
    wealth_per_year: Dict[int, float] = {}
    for dt, value in total_history:
        year = dt.year
        wealth_per_year[year] = value

    tables = tax_tables or {}
    state_income_rows = (tables.get("state_income") or {}).get("rows") or []
    state_wealth_rows = (tables.get("state_wealth") or {}).get("rows") or []
    federal_rows = (tables.get("federal") or {}).get("rows") or []

    results = []
    years = sorted(taxable_map.keys() | wealth_per_year.keys())
    for year in years:
        entry = taxable_map.get(year, {"year": year, "net": 0})
        net_income = entry.get("net", 0.0)
        wealth_val = wealth_per_year.get(year)
        income_tax = 0.0
        if state_income_rows and net_income:
            income_tax = _calc_tariff_table(net_income, state_income_rows, "threshold", "base_amount", "per_100_amount")
        wealth_tax = 0.0
        if wealth_val is not None and state_wealth_rows:
            wealth_tax = _calc_tariff_table(
                wealth_val,
                state_wealth_rows,
                "threshold",
                "base_amount",
                "per_100_amount",
            )
        base_tax = income_tax + (wealth_tax or 0.0)
        personal_tax = defaults["personal_tax_per_person"] * household_size if defaults["personal_tax_per_person"] else 0.0  # adjust for household size
        tax_total = (
            base_tax * defaults["municipal_tax_factor"]
            + base_tax * defaults["cantonal_tax_factor"]
            + base_tax * defaults["church_tax_factor"]
            + personal_tax
        )
        federal_tax = _calc_federal(net_income, federal_rows)
        total_all = tax_total + federal_tax
        results.append(
            {
                "year": year,
                "net": net_income,
                "wealth": wealth_val,
                "incomeTax": income_tax,
                "wealthTax": wealth_tax,
                "baseTax": base_tax,
                "personalTax": personal_tax,
                "taxTotal": tax_total,
                "federalTax": federal_tax,
                "totalAll": total_all,
            }
        )
    return results


def _apply_overrides(
    scenario: Dict,
    assets: List[Dict],
    transactions: List[Dict],
    overrides: Optional[Dict],
):
    if not overrides:
        return scenario, assets, transactions

    adjusted_scenario = {**scenario}
    adjusted_assets: List[Dict] = [deepcopy(asset) for asset in assets]
    adjusted_transactions: List[Dict] = [deepcopy(tx) for tx in transactions]

    if overrides.get("income_tax_override") is not None:
        adjusted_scenario["income_tax_rate"] = overrides.get("income_tax_override")

    def _to_key(year, month):
        if not year or not month:
            return None
        return year * 100 + month

    def _in_window(start_year, start_month, end_year, end_month, window):
        if not window:
            return True
        start_key = _to_key(start_year, start_month)
        end_key = _to_key(end_year, end_month) or start_key
        win_start = window.get("start")
        win_end = window.get("end") or win_start
        if win_start is None:
            return True
        if start_key is None:
            return False
        return not (end_key is not None and win_start is not None and end_key < win_start) and not (
            win_end is not None and start_key is not None and start_key > win_end
        )

    portfolio_window = {
        "start": _to_key(overrides.get("portfolio_start_year"), overrides.get("portfolio_start_month")),
        "end": _to_key(overrides.get("portfolio_end_year"), overrides.get("portfolio_end_month")),
    }

    # Build shock list: prefer explicit list, fallback to single legacy fields (portfolio)
    def collect_shocks(key, default_window=None):
        shocks = []
        if overrides.get(key):
            for entry in overrides.get(key) or []:
                pct = entry.get("pct")
                if pct is None:
                    continue
                shocks.append(
                    {
                        "pct": pct,
                        "start": _to_key(entry.get("start_year"), entry.get("start_month")),
                        "end": _to_key(entry.get("end_year"), entry.get("end_month")),
                    }
                )
        return shocks

    portfolio_shocks = collect_shocks("portfolio_shocks")
    if not portfolio_shocks and overrides.get("portfolio_growth_pct") is not None:
        portfolio_shocks.append(
            {
                "pct": overrides.get("portfolio_growth_pct"),
                "start": portfolio_window.get("start"),
                "end": portfolio_window.get("end"),
            }
        )

    real_estate_shocks = collect_shocks("real_estate_shocks")
    mortgage_rate_shocks = collect_shocks("mortgage_rate_shocks")
    inflation_shocks = collect_shocks("inflation_shocks")

    def apply_shocks(asset_list, shocks):
        if not shocks:
            return
        for asset in asset_list:
            base = asset.get("annual_growth_rate") or 0.0
            for entry in shocks:
                asset.setdefault("growth_schedule", []).append(
                    {
                        "start": entry.get("start"),
                        "end": entry.get("end"),
                        "rate": base + entry["pct"],
                    }
                )

    apply_shocks([a for a in adjusted_assets if a.get("asset_type") == "portfolio"], portfolio_shocks)
    apply_shocks([a for a in adjusted_assets if a.get("asset_type") == "real_estate"], real_estate_shocks)

    if mortgage_rate_shocks:
        for tx in adjusted_transactions:
            if tx.get("type") != "mortgage_interest":
                continue
            base_rate = tx.get("annual_interest_rate") or tx.get("annual_growth_rate") or 0.0
            tx.setdefault("rate_schedule", [])
            for entry in mortgage_rate_shocks:
                tx["rate_schedule"].append(
                    {
                        "start": entry.get("start"),
                        "end": entry.get("end"),
                        "rate": base_rate + entry["pct"],
                    }
                )

    if inflation_shocks:
        for tx in adjusted_transactions:
            if tx.get("type") == "mortgage_interest":
                continue
            tx.setdefault("inflation_schedule", [])
            for entry in inflation_shocks:
                tx["inflation_schedule"].append(
                    {
                        "start": entry.get("start"),
                        "end": entry.get("end"),
                        "pct": entry.get("pct"),
                    }
                )

    # No other overrides when only growth is present
    # Transactions remain unchanged for this stress profile

    return adjusted_scenario, adjusted_assets, adjusted_transactions


def run_scenario_simulation(
    scenario_id: str,
    repo: Optional[WealthRepository] = None,
    overrides: Optional[Dict] = None,
):
    repo = repo or WealthRepository()
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise ValueError(f"Scenario {scenario_id} not found")

    assets = repo.list_assets_for_scenario(scenario_id)
    if not assets:
        raise ValueError("Scenario has no assets configured.")

    transactions = repo.list_transactions_for_scenario(scenario_id)

    scenario, assets, transactions = _apply_overrides(scenario, assets, transactions, overrides)

    if scenario.get("tax_canton"):
        canton_rate = repo.get_state_tax_rate_for_canton(scenario.get("tax_canton"))
        if canton_rate and canton_rate.get("rate") is not None:
            scenario["cantonal_tax_factor"] = _safe_number(canton_rate.get("rate"), 0.0) / 100.0

    tax_tables: Dict[str, Dict] = {}
    income_tariff_id = scenario.get("tax_state_income_tariff_id")
    if income_tariff_id:
        income_tariff = repo.get_state_tax_tariff(income_tariff_id)
        if income_tariff:
            tax_tables["state_income"] = income_tariff
    wealth_tariff_id = scenario.get("tax_state_wealth_tariff_id")
    if wealth_tariff_id:
        wealth_tariff = repo.get_state_tax_tariff(wealth_tariff_id)
        if wealth_tariff:
            tax_tables["state_wealth"] = wealth_tariff
    federal_tariff_id = scenario.get("tax_federal_tariff_id")
    if federal_tariff_id:
        federal_tariff = repo.get_federal_tax_table(federal_tariff_id)
        if federal_tariff:
            tax_tables["federal"] = federal_tariff

    scenario_defaults = {
        "start_year": scenario.get("start_year"),
        "start_month": scenario.get("start_month"),
        "end_year": scenario.get("end_year"),
        "end_month": scenario.get("end_month"),
    }
    account_map = {}
    for asset in assets:
        start_year, start_month, end_year, end_month = _coalesce_asset_dates(asset, scenario_defaults)
        account_map[asset["id"]] = Account(
            asset["name"],
            asset.get("annual_growth_rate", 0.0),
            asset.get("initial_balance", 0.0),
            start_year,
            start_month,
            end_year,
            end_month,
            asset_type=asset.get("asset_type"),
            growth_schedule=asset.get("growth_schedule"),
        )

    income_tax_rate = 0.0  # disable flat tax rate; we calculate progressive taxes below

    # Apply income tax shocks (additive) with optional windows
    if overrides:
        tax_shocks = []
        for entry in overrides.get("income_tax_shocks") or []:
            pct = entry.get("pct")
            if pct is None:
                continue
            tax_shocks.append(
                {
                    "pct": pct,
                    "start": _to_key(entry.get("start_year"), entry.get("start_month")),
                    "end": _to_key(entry.get("end_year"), entry.get("end_month")),
                }
            )
        if tax_shocks:
            def _tax_in_window(start, end):
                if start is None:
                    return True
                return not (end is not None and scenario_defaults["start_year"] and start > _to_key(scenario_defaults["end_year"], scenario_defaults["end_month"]))
            # Choose first matching shock window; if none matches, fallback to base
            scenario_start = _to_key(scenario_defaults.get("start_year"), scenario_defaults.get("start_month"))
            scenario_end = _to_key(scenario_defaults.get("end_year"), scenario_defaults.get("end_month"))
            applied_tax = income_tax_rate
            for shock in tax_shocks:
                start = shock.get("start") or scenario_start
                end = shock.get("end") or scenario_end
                # If scenario overlaps the window, apply the shock additively
                if start is None:
                    applied_tax = income_tax_rate + shock["pct"]
                    break
                # simple overlap check
                if scenario_start is None or not (scenario_end and start > scenario_end) and not (end and scenario_start and scenario_start > end):
                    applied_tax = income_tax_rate + shock["pct"]
                    break
            income_tax_rate = applied_tax

    accounts = list(account_map.values())

    tax_account = None
    if scenario.get("tax_account_id"):
        tax_account = account_map.get(scenario.get("tax_account_id"))

    def simulate_with_taxes(extra_transactions: List[Dict]):
        txs = transactions + extra_transactions
        acc_txs, mort_txs = _build_transactions(txs, account_map, 0.0, scenario_defaults)
        bal, tot, cf = simulate_account_balances_and_total_wealth(
            accounts,
            acc_txs,
            scenario["start_year"],
            scenario["start_month"],
            scenario["end_year"],
            scenario["end_month"],
            mort_txs,
            tax_account=tax_account,
        )
        return bal, tot, cf

    def taxes_to_transactions(rows: List[Dict]) -> List[Dict]:
        result = []
        for row in rows:
            total_all = row.get("totalAll") or 0.0
            if not total_all:
                continue
            result.append(
                {
                    "scenario_id": scenario_id,
                    "asset_id": scenario.get("tax_account_id") or assets[0]["id"],
                    "name": f"Steuern {row['year']}",
                    "amount": -abs(total_all),
                    "type": "one_time",
                    "start_year": row["year"],
                    "start_month": 12,
                    "end_year": row["year"],
                    "end_month": 12,
                    "frequency": None,
                    "annual_growth_rate": 0.0,
                    "taxable": False,
                }
            )
        return result

    tax_rows: List[Dict] = []
    tax_transactions: List[Dict] = []

    # iteriere bis zu 10x, damit Steuerbasis nach Steuerabbuchungen konvergiert
    max_iterations = 10
    for _ in range(max_iterations):
        balances, total, cash_flows = simulate_with_taxes(tax_transactions)
        new_tax_rows = _collect_yearly_tax(transactions, cash_flows, total, scenario, tax_tables)
        # check convergence (nach Betrag pro Jahr, kleine Abweichung erlaubt)
        same_len = len(new_tax_rows) == len(tax_rows)
        same_vals = False
        if same_len:
            prev_sorted = sorted(tax_rows, key=lambda x: x["year"])
            new_sorted = sorted(new_tax_rows, key=lambda x: x["year"])
            diffs = [
                abs((na.get("totalAll") or 0) - (pa.get("totalAll") or 0))
                for na, pa in zip(new_sorted, prev_sorted)
                if na.get("year") == pa.get("year")
            ]
            same_years = all(na.get("year") == pa.get("year") for na, pa in zip(new_sorted, prev_sorted))
            same_vals = same_years and all(diff < 0.01 for diff in diffs)
        tax_rows = new_tax_rows
        if same_vals:
            break
        tax_transactions = taxes_to_transactions(tax_rows)

    def serialize_history(history):
        return [{"date": dt.isoformat(), "value": value} for dt, value in history]

    serialized_balances = {
        account.name: serialize_history(history) for account, history in balances.items()
    }
    serialized_total = serialize_history(total)
    serialized_cashflows = [
        {
            "date": entry["date"].isoformat(),
            "income": entry["income"],
            "expenses": entry["expenses"],
            "growth": entry["growth"],
            "taxes": entry.get("taxes", 0.0),
            "net": entry["net"],
            "income_details": entry["income_details"],
            "expense_details": entry["expense_details"],
            "growth_details": entry["growth_details"],
            "tax_details": entry.get("tax_details", []),
        }
        for entry in cash_flows
    ]

    return {
        "scenario": scenario,
        "accounts": assets,
        "account_balances": serialized_balances,
        "total_wealth": serialized_total,
        "cash_flows": serialized_cashflows,
        "taxes": tax_rows,
    }
