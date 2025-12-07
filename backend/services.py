from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional
from copy import deepcopy

from .domain import (
    Account,
    MortgageInterestTransaction,
    OneTimeTransaction,
    RegularTransaction,
    simulate_account_balances_and_total_wealth,
)
from .repository import WealthRepository

# Default Steuerparameter (identisch zum bisherigen Frontend-Default)
DEFAULT_INCOME_BRACKETS = [
    {"cap": 6900, "rate": 0},
    {"cap": 4900, "rate": 0.02},
    {"cap": 4800, "rate": 0.03},
    {"cap": 7900, "rate": 0.04},
    {"cap": 9600, "rate": 0.05},
    {"cap": 11000, "rate": 0.06},
    {"cap": 12900, "rate": 0.07},
    {"cap": 17400, "rate": 0.08},
    {"cap": 33600, "rate": 0.09},
    {"cap": 33200, "rate": 0.10},
    {"cap": 52700, "rate": 0.11},
    {"cap": 68400, "rate": 0.12},
    {"cap": None, "rate": 0.13},
]

DEFAULT_WEALTH_BRACKETS = [
    {"cap": 80000, "rate": 0},
    {"cap": 238000, "rate": 0.0005},
    {"cap": 399000, "rate": 0.001},
    {"cap": 636000, "rate": 0.0015},
    {"cap": 956000, "rate": 0.002},
    {"cap": 953000, "rate": 0.0025},
    {"cap": None, "rate": 0.003},
]

DEFAULT_FEDERAL_TABLE = [
    {"income": 18500, "base": 25.41, "per100": 0.77},
    {"income": 19000, "base": 29.26, "per100": 0.77},
    {"income": 20000, "base": 36.96, "per100": 0.77},
    {"income": 21000, "base": 44.66, "per100": 0.77},
    {"income": 22000, "base": 52.36, "per100": 0.77},
    {"income": 23000, "base": 60.06, "per100": 0.77},
    {"income": 24000, "base": 67.76, "per100": 0.77},
    {"income": 25000, "base": 75.46, "per100": 0.77},
    {"income": 26000, "base": 83.16, "per100": 0.77},
    {"income": 27000, "base": 90.86, "per100": 0.77},
    {"income": 28000, "base": 98.56, "per100": 0.77},
    {"income": 29000, "base": 106.26, "per100": 0.77},
    {"income": 30000, "base": 113.96, "per100": 7.0},
    {"income": 33000, "base": 137.06, "per100": 33.0},
    {"income": 33200, "base": 138.6, "per100": 35.0},
    {"income": 33300, "base": 139.48, "per100": 0.88},
    {"income": 34000, "base": 145.64, "per100": 43.0},
    {"income": 35000, "base": 154.44, "per100": 53.0},
    {"income": 36000, "base": 163.24, "per100": 63.0},
    {"income": 37000, "base": 172.04, "per100": 73.0},
    {"income": 38000, "base": 180.84, "per100": 83.0},
    {"income": 39000, "base": 189.64, "per100": 93.0},
    {"income": 40000, "base": 198.44, "per100": 103.0},
    {"income": 41000, "base": 207.24, "per100": 113.0},
    {"income": 42000, "base": 216.04, "per100": 123.0},
    {"income": 43500, "base": 229.2, "per100": 138.0},
    {"income": 43600, "base": 231.84, "per100": 2.64},
    {"income": 44000, "base": 242.4, "per100": 143.0},
    {"income": 45000, "base": 268.8, "per100": 153.0},
    {"income": 46000, "base": 295.2, "per100": 163.0},
    {"income": 47000, "base": 321.6, "per100": 173.0},
    {"income": 48000, "base": 348.0, "per100": 183.0},
    {"income": 49000, "base": 374.4, "per100": 193.0},
    {"income": 50000, "base": 400.8, "per100": 203.0},
    {"income": 51000, "base": 427.2, "per100": 213.0},
    {"income": 53400, "base": 490.56, "per100": 237.0},
    {"income": 53500, "base": 493.2, "per100": 239.0},
    {"income": 54000, "base": 506.4, "per100": 249.0},
    {"income": 55000, "base": 532.8, "per100": 269.0},
    {"income": 56000, "base": 559.2, "per100": 289.0},
    {"income": 57000, "base": 585.6, "per100": 309.0},
    {"income": 58000, "base": 612.0, "per100": 329.0},
    {"income": 58100, "base": 614.97, "per100": 2.97},
    {"income": 59000, "base": 641.7, "per100": 349.0},
    {"income": 60000, "base": 671.4, "per100": 369.0},
    {"income": 61300, "base": 710.01, "per100": 395.0},
    {"income": 61400, "base": 712.98, "per100": 398.0},
    {"income": 65000, "base": 819.9, "per100": 506.0},
    {"income": 70000, "base": 968.4, "per100": 656.0},
    {"income": 75000, "base": 1116.9, "per100": 806.0},
    {"income": 76100, "base": 1149.55, "per100": 839.0},
    {"income": 76200, "base": 1155.49, "per100": 5.94},
    {"income": 77500, "base": 1232.71, "per100": 881.0},
    {"income": 79100, "base": 1327.75, "per100": 929.0},
    {"income": 79200, "base": 1333.69, "per100": 933.0},
    {"income": 82000, "base": 1500.0, "per100": 1045.0},
    {"income": 82100, "base": 1506.6, "per100": 6.6},
    {"income": 85000, "base": 1698.0, "per100": 1165.0},
    {"income": 90000, "base": 2028.0, "per100": 1365.0},
    {"income": 94900, "base": 2351.4, "per100": 1561.0},
    {"income": 95000, "base": 2358.0, "per100": 1566.0},
    {"income": 100000, "base": 2688.0, "per100": 1816.0},
    {"income": 105000, "base": 3018.0, "per100": 2066.0},
    {"income": 108600, "base": 3255.6, "per100": 2246.0},
    {"income": 108700, "base": 3262.2, "per100": 2252.0},
    {"income": 108800, "base": 3268.8, "per100": 2258.0},
    {"income": 108900, "base": 3277.6, "per100": 8.8},
    {"income": 110000, "base": 3374.4, "per100": 2330.0},
    {"income": 115000, "base": 3814.4, "per100": 2630.0},
    {"income": 120500, "base": 4298.4, "per100": 2960.0},
    {"income": 120600, "base": 4307.2, "per100": 2967.0},
    {"income": 125000, "base": 4694.4, "per100": 3275.0},
    {"income": 130000, "base": 5134.4, "per100": 3625.0},
    {"income": 130500, "base": 5178.4, "per100": 3660.0},
    {"income": 130600, "base": 5187.2, "per100": 3668.0},
    {"income": 135000, "base": 5574.4, "per100": 4020.0},
    {"income": 138300, "base": 5864.8, "per100": 4284.0},
    {"income": 138400, "base": 5873.6, "per100": 4293.0},
    {"income": 141500, "base": 6146.4, "per100": 4572.0},
    {"income": 141600, "base": 6157.4, "per100": 11.0},
    {"income": 144200, "base": 6443.4, "per100": 4815.0},
    {"income": 144300, "base": 6454.4, "per100": 4825.0},
    {"income": 148200, "base": 6883.4, "per100": 5215.0},
    {"income": 148300, "base": 6894.4, "per100": 5226.0},
    {"income": 150300, "base": 7114.4, "per100": 5446.0},
    {"income": 150400, "base": 7125.4, "per100": 5458.0},
    {"income": 151000, "base": 7191.4, "per100": 5530.0},
    {"income": 152300, "base": 7334.4, "per100": 5686.0},
    {"income": 152400, "base": 7345.4, "per100": 5699.0},
    {"income": 155000, "base": 7631.4, "per100": 6037.0},
    {"income": 160000, "base": 8181.4, "per100": 6687.0},
    {"income": 170000, "base": 9281.4, "per100": 7987.0},
    {"income": 184900, "base": 10920.4, "per100": 9924.0},
    {"income": 185000, "base": 10933.6, "per100": 13.2},
    {"income": 186000, "base": 11065.6, "per100": 10067.0},
    {"income": 190000, "base": 11593.6, "per100": 10587.0},
    {"income": 200000, "base": 12913.6, "per100": 11887.0},
    {"income": 250000, "base": 19513.6, "per100": 18387.0},
    {"income": 300000, "base": 26113.6, "per100": 24887.0},
    {"income": 350000, "base": 32713.6, "per100": 31387.0},
    {"income": 400000, "base": 39313.6, "per100": 37887.0},
    {"income": 500000, "base": 52513.6, "per100": 50887.0},
    {"income": 650000, "base": 72313.6, "per100": 70387.0},
    {"income": 700000, "base": 78913.6, "per100": 76887.0},
    {"income": 793300, "base": 91229.2, "per100": 89016.0},
    {"income": 793400, "base": 91241.0, "per100": 11.5},
    {"income": 800000, "base": 92000.0, "per100": 89887.0},
    {"income": 940800, "base": 108192.0, "per100": 108191.0},
    {"income": 940900, "base": 108203.5, "per100": 108203.5},
    {"income": 950000, "base": 109250.0, "per100": 108203.5},
]

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


def _calc_progressive(amount: float, brackets: List[Dict]) -> float:
    remaining = max(0.0, amount or 0.0)
    tax = 0.0
    for entry in brackets:
        cap = entry.get("cap")
        rate = entry.get("rate") or 0.0
        if remaining <= 0:
            break
        slice_amt = remaining if cap is None else min(remaining, cap)
        tax += slice_amt * rate
        remaining -= slice_amt
    return tax


def _calc_federal(income: float, table: List[Dict]) -> float:
    taxable = max(0.0, income or 0.0)
    sorted_rows = sorted(table, key=lambda x: x.get("income", 0))
    if not sorted_rows:
        return 0.0

    def _safe_per100(val):
        try:
            rate = float(val or 0)
        except (TypeError, ValueError):
            rate = 0.0
        # Manche importierte Tabellen enthalten fehlerhafte Werte (z.B. 108203.5 statt 11.5).
        # Begrenze auf max. 11.5 CHF pro 100 CHF und min. 0.
        rate = max(0.0, rate)
        if rate > 20:
            return 11.5
        return rate

    if taxable <= sorted_rows[0]["income"]:
        entry = sorted_rows[0]
        per100 = _safe_per100(entry.get("per100"))
        return entry["base"] + ((taxable - entry["income"]) / 100) * per100
    for i in range(len(sorted_rows) - 1):
        curr = sorted_rows[i]
        nxt = sorted_rows[i + 1]
        if taxable >= curr["income"] and taxable < nxt["income"]:
            per100 = _safe_per100(curr.get("per100"))
            return curr["base"] + ((taxable - curr["income"]) / 100) * per100
    last = sorted_rows[-1]
    # marginal 11.5% above last bracket (like frontend)
    return last["base"] + (taxable - last["income"]) * 0.115


def _collect_yearly_tax(transactions: List[Dict], cash_flows: List[Dict], total_history: List[tuple], scenario: Dict):
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
        "municipal_tax_factor": scenario.get("municipal_tax_factor", 1.15),
        "cantonal_tax_factor": scenario.get("cantonal_tax_factor", 0.98),
        "church_tax_factor": scenario.get("church_tax_factor", 0.14),
        "personal_tax_per_person": scenario.get("personal_tax_per_person", 24),
    }

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

    brackets_income = DEFAULT_INCOME_BRACKETS
    brackets_wealth = DEFAULT_WEALTH_BRACKETS
    federal_table = DEFAULT_FEDERAL_TABLE

    results = []
    years = sorted(taxable_map.keys() | wealth_per_year.keys())
    for year in years:
        entry = taxable_map.get(year, {"year": year, "net": 0})
        net_income = entry.get("net", 0.0)
        wealth_val = wealth_per_year.get(year)
        income_tax = _calc_progressive(net_income, brackets_income)
        wealth_tax = _calc_progressive(wealth_val or 0.0, brackets_wealth) if wealth_val is not None else 0.0
        base_tax = income_tax + (wealth_tax or 0.0)
        personal_tax = defaults["personal_tax_per_person"]  # household size = 1 aktuell
        tax_total = (
            base_tax * defaults["municipal_tax_factor"]
            + base_tax * defaults["cantonal_tax_factor"]
            + base_tax * defaults["church_tax_factor"]
            + personal_tax
        )
        federal_tax = _calc_federal(net_income, federal_table)
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
        new_tax_rows = _collect_yearly_tax(transactions, cash_flows, total, scenario)
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
