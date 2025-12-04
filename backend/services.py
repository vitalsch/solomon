from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from copy import deepcopy

from .domain import (
    Account,
    MortgageInterestTransaction,
    OneTimeTransaction,
    RegularTransaction,
    simulate_account_balances_and_total_wealth,
)
from .repository import WealthRepository


def normalize_id(value):
    if value is None:
        return ""
    return str(value)


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
            setattr(interest_tx, "rate_schedule", rate_schedule)
            # carry tax info so simulation can include tax effects
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
            tax_effect = taxable_amount * (income_tax_rate or 0.0)
            setattr(transaction, "tax_effect", -tax_effect)  # negative expense for tax column
            setattr(transaction, "taxable_amount", taxable_amount)
            setattr(transaction, "tax_rate", income_tax_rate or 0.0)
            setattr(transaction, "gross_amount", tx.get("amount", 0.0) or 0.0)
        account_transactions[account].append(transaction)
    return account_transactions, mortgage_interest_transactions


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


def _compute_taxable_income_by_year(
    transactions: List[Dict],
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
) -> Dict[int, Dict[str, float]]:
    """Aggregate taxable income/expenses per year from transactions."""
    results: Dict[int, Dict[str, float]] = {}

    def add_entry(year: int, income_add: float, expense_add: float):
        entry = results.get(year) or {"income": 0.0, "expense": 0.0}
        entry["income"] += income_add
        entry["expense"] += expense_add
        results[year] = entry

    for tx in transactions:
        if not tx.get("taxable"):
            continue
        amount_raw = tx.get("taxable_amount")
        amount_raw = amount_raw if amount_raw is not None else tx.get("amount", 0)
        amount = abs(float(amount_raw or 0))
        if amount == 0:
            continue

        freq = max(1, int(tx.get("frequency") or 1))
        start_y = tx.get("start_year", start_year)
        start_m = tx.get("start_month", start_month)
        end_y = tx.get("end_year", end_year)
        end_m = tx.get("end_month", end_month)
        year = start_y
        month = start_m
        limit = 2000
        count = 0
        while year < end_y or (year == end_y and month <= end_m):
            entry_type = tx.get("entry")
            if entry_type == "debit":
                add_entry(year, amount, 0)
            elif entry_type == "credit":
                add_entry(year, 0, amount)
            else:
                is_expense = float(tx.get("amount") or 0) < 0
                add_entry(year, 0 if is_expense else amount, amount if is_expense else 0)
            month += freq
            while month > 12:
                month -= 12
                year += 1
            count += 1
            if count > limit:
                break
    return results


def _calculate_taxes_for_year(
    taxable_net: float,
    wealth: float,
    municipal_factor: float,
    cantonal_factor: float,
    church_factor: float,
    personal_tax: float,
) -> Tuple[float, float, float, float, float]:
    """Return (income_tax, wealth_tax, cantonal_municipal_total, federal_tax, total_all)."""
    income_brackets = [
        (6900, 0.0),
        (4900, 0.02),
        (4800, 0.03),
        (7900, 0.04),
        (9600, 0.05),
        (11000, 0.06),
        (12900, 0.07),
        (17400, 0.08),
        (33600, 0.09),
        (33200, 0.10),
        (52700, 0.11),
        (68400, 0.12),
        (float("inf"), 0.13),
    ]

    wealth_brackets = [
        (80000, 0.0),
        (238000, 0.0005),
        (399000, 0.001),
        (636000, 0.0015),
        (956000, 0.002),
        (953000, 0.0025),
        (float("inf"), 0.003),
    ]

    federal_table: List[Tuple[float, float, float]] = [
        (18500, 25.41, 0.77),
        (19000, 29.26, 0.77),
        (20000, 36.96, 0.77),
        (21000, 44.66, 0.77),
        (22000, 52.36, 0.77),
        (23000, 60.06, 0.77),
        (24000, 67.76, 0.77),
        (25000, 75.46, 0.77),
        (26000, 83.16, 0.77),
        (27000, 90.86, 0.77),
        (28000, 98.56, 0.77),
        (29000, 106.26, 0.77),
        (30000, 113.96, 7.0),
        (33000, 137.06, 33.0),
        (33200, 138.6, 35.0),
        (33300, 139.48, 0.88),
        (34000, 145.64, 43.0),
        (35000, 154.44, 53.0),
        (36000, 163.24, 63.0),
        (37000, 172.04, 73.0),
        (38000, 180.84, 83.0),
        (39000, 189.64, 93.0),
        (40000, 198.44, 103.0),
        (41000, 207.24, 113.0),
        (42000, 216.04, 123.0),
        (43500, 229.2, 138.0),
        (43600, 231.84, 2.64),
        (44000, 242.4, 143.0),
        (45000, 268.8, 153.0),
        (46000, 295.2, 163.0),
        (47000, 321.6, 173.0),
        (48000, 348.0, 183.0),
        (49000, 374.4, 193.0),
        (50000, 400.8, 203.0),
        (51000, 427.2, 213.0),
        (53400, 490.56, 237.0),
        (53500, 493.2, 239.0),
        (54000, 506.4, 249.0),
        (55000, 532.8, 269.0),
        (56000, 559.2, 289.0),
        (57000, 585.6, 309.0),
        (58000, 612.0, 329.0),
        (58100, 614.97, 2.97),
        (59000, 641.7, 349.0),
        (60000, 671.4, 369.0),
        (61300, 710.01, 395.0),
        (61400, 712.98, 398.0),
        (65000, 819.9, 506.0),
        (70000, 968.4, 656.0),
        (75000, 1116.9, 806.0),
        (76100, 1149.55, 839.0),
        (76200, 1155.49, 5.94),
        (77500, 1232.71, 881.0),
        (79100, 1327.75, 929.0),
        (79200, 1333.69, 933.0),
        (82000, 1500.0, 1045.0),
        (82100, 1506.6, 6.6),
        (85000, 1698.0, 1165.0),
        (90000, 2028.0, 1365.0),
        (94900, 2351.4, 1561.0),
        (95000, 2358.0, 1566.0),
        (100000, 2688.0, 1816.0),
        (105000, 3018.0, 2066.0),
        (108600, 3255.6, 2246.0),
        (108700, 3262.2, 2252.0),
        (108800, 3268.8, 2258.0),
        (108900, 3277.6, 8.8),
        (110000, 3374.4, 2330.0),
        (115000, 3814.4, 2630.0),
        (120500, 4298.4, 2960.0),
        (120600, 4307.2, 2967.0),
        (125000, 4694.4, 3275.0),
        (130000, 5134.4, 3625.0),
        (130500, 5178.4, 3660.0),
        (130600, 5187.2, 3668.0),
        (135000, 5574.4, 4020.0),
        (138300, 5864.8, 4284.0),
        (138400, 5873.6, 4293.0),
        (141500, 6146.4, 4572.0),
        (141600, 6157.4, 11.0),
        (144200, 6443.4, 4815.0),
        (144300, 6454.4, 4825.0),
        (148200, 6883.4, 5215.0),
        (148300, 6894.4, 5226.0),
        (150300, 7114.4, 5446.0),
        (150400, 7125.4, 5458.0),
        (151000, 7191.4, 5530.0),
        (152300, 7334.4, 5686.0),
        (152400, 7345.4, 5699.0),
        (155000, 7631.4, 6037.0),
        (160000, 8181.4, 6687.0),
        (170000, 9281.4, 7987.0),
        (184900, 10920.4, 9924.0),
        (185000, 10933.6, 13.2),
        (186000, 11065.6, 10067.0),
        (190000, 11593.6, 10587.0),
        (200000, 12913.6, 11887.0),
        (250000, 19513.6, 18387.0),
        (300000, 26113.6, 24887.0),
        (350000, 32713.6, 31387.0),
        (400000, 39313.6, 37887.0),
        (500000, 52513.6, 50887.0),
        (650000, 72313.6, 70387.0),
        (700000, 78913.6, 76887.0),
        (793300, 91229.2, 89016.0),
        (793400, 91241.0, 11.5),
        (800000, 92000.0, 89887.0),
        (940800, 108192.0, 108191.0),
        (940900, 108203.5, 108203.5),
        (950000, 109250.0, 108203.5),
    ]

    def progressive(amount: float, brackets: List[Tuple[float, float]]) -> float:
        tax = 0.0
        remaining = max(0.0, amount)
        for cap, rate in brackets:
            if remaining <= 0:
                break
            slice_amt = remaining if cap == float("inf") else min(cap, remaining)
            tax += slice_amt * rate
            remaining -= slice_amt
        return tax

    income_tax = progressive(taxable_net, income_brackets)
    wealth_tax = progressive(wealth, wealth_brackets) if wealth is not None else 0.0
    base_tax = income_tax + wealth_tax
    cantonal_municipal_tax = base_tax * municipal_factor + base_tax * cantonal_factor + base_tax * church_factor + personal_tax

    # federal tax lookup
    federal_table_sorted = sorted(federal_table, key=lambda x: x[0])
    taxable = max(0.0, taxable_net)
    federal_tax = 0.0
    for idx, (inc, base, per100) in enumerate(federal_table_sorted):
        if taxable < inc:
            if idx == 0:
                federal_tax = base + ((taxable - inc) / 100.0) * per100
            else:
                prev_inc, prev_base, prev_per100 = federal_table_sorted[idx - 1]
                federal_tax = prev_base + ((taxable - prev_inc) / 100.0) * prev_per100
            break
    else:
        last_inc, last_base, _ = federal_table_sorted[-1]
        federal_tax = last_base + (taxable - last_inc) * 0.115

    total_all = cantonal_municipal_tax + federal_tax
    return income_tax, wealth_tax, cantonal_municipal_tax, federal_tax, total_all


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

    income_tax_rate = scenario.get("income_tax_rate") or 0.0

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

    account_transactions, mortgage_interest_transactions = _build_transactions(
        transactions, account_map, income_tax_rate, scenario_defaults
    )
    accounts = list(account_map.values())

    # Pass 1: simulate without annual tax charge to derive wealth trajectory
    balances_initial, total_initial, _ = simulate_account_balances_and_total_wealth(
        accounts,
        account_transactions,
        scenario["start_year"],
        scenario["start_month"],
        scenario["end_year"],
        scenario["end_month"],
        mortgage_interest_transactions,
    )

    # Build wealth per year (December) and taxable income/expense map
    wealth_by_year: Dict[int, float] = {}
    for dt, value in total_initial:
        if dt.month == 12:
            wealth_by_year[dt.year] = value

    taxable_by_year = _compute_taxable_income_by_year(
        transactions,
        scenario["start_year"],
        scenario["start_month"],
        scenario["end_year"],
        scenario["end_month"],
    )

    municipal_factor = float(scenario.get("municipal_tax_factor") or 0.0)
    cantonal_factor = float(scenario.get("cantonal_tax_factor") or 0.0)
    church_factor = float(scenario.get("church_tax_factor") or 0.0)
    personal_tax_val = float(scenario.get("personal_tax_per_person") or 0.0)

    tax_schedule: Dict[int, float] = {}
    for year, entry in taxable_by_year.items():
        taxable_net = entry.get("income", 0) - entry.get("expense", 0)
        wealth = wealth_by_year.get(year, 0.0)
        _, _, cant_muni_tax, federal_tax, total_all = _calculate_taxes_for_year(
            taxable_net, wealth, municipal_factor, cantonal_factor, church_factor, personal_tax_val
        )
        if total_all:
            tax_schedule[year] = -abs(total_all)  # negative to subtract

    tax_account = account_map.get(normalize_id(scenario.get("tax_account_id")))

    # Pass 2: simulate with annual tax charge applied in December to the chosen account
    balances, total, cash_flows = simulate_account_balances_and_total_wealth(
        accounts,
        account_transactions,
        scenario["start_year"],
        scenario["start_month"],
        scenario["end_year"],
        scenario["end_month"],
        mortgage_interest_transactions,
        tax_schedule,
        tax_account,
    )

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
    }
