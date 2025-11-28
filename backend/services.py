from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

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


def run_scenario_simulation(scenario_id: str, repo: Optional[WealthRepository] = None):
    repo = repo or WealthRepository()
    scenario = repo.get_scenario(scenario_id)
    if not scenario:
        raise ValueError(f"Scenario {scenario_id} not found")

    assets = repo.list_assets_for_scenario(scenario_id)
    if not assets:
        raise ValueError("Scenario has no assets configured.")

    transactions = repo.list_transactions_for_scenario(scenario_id)

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
        )

    income_tax_rate = scenario.get("income_tax_rate") or 0.0
    account_transactions, mortgage_interest_transactions = _build_transactions(
        transactions, account_map, income_tax_rate, scenario_defaults
    )
    accounts = list(account_map.values())

    balances, total, cash_flows = simulate_account_balances_and_total_wealth(
        accounts,
        account_transactions,
        scenario["start_year"],
        scenario["start_month"],
        scenario["end_year"],
        scenario["end_month"],
        mortgage_interest_transactions,
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
