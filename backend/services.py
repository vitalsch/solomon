from __future__ import annotations

from typing import Dict, List, Optional

from .domain import (
    Account,
    MortgageInterestTransaction,
    OneTimeTransaction,
    RegularTransaction,
    simulate_account_balances_and_total_wealth,
)
from .repository import WealthRepository


def _create_transaction_instance(tx_doc, amount_override=None):
    tx_type = tx_doc.get("type", "one_time")
    amount = tx_doc.get("amount", 0.0) if amount_override is None else amount_override
    is_internal = bool(tx_doc.get("double_entry") or tx_doc.get("counter_asset_id"))
    if tx_type == "regular":
        tx_instance = RegularTransaction(
            tx_doc.get("name", "Regular Transaction"),
            amount,
            tx_doc.get("start_month", 1),
            tx_doc.get("start_year", 2024),
            tx_doc.get("end_month", tx_doc.get("start_month", 1)),
            tx_doc.get("end_year", tx_doc.get("start_year", 2024)),
            tx_doc.get("frequency", 1),
            tx_doc.get("annual_growth_rate", 0.0),
        )
    else:
        tx_instance = OneTimeTransaction(
            tx_doc.get("name", "One-Time Transaction"),
            amount,
            tx_doc.get("start_month", 1),
            tx_doc.get("start_year", 2024),
        )
    setattr(tx_instance, "internal", is_internal)
    return tx_instance


def _build_transactions(transaction_docs, account_map):
    account_transactions: Dict[Account, List] = {account: [] for account in account_map.values()}
    mortgage_interest_transactions: List[MortgageInterestTransaction] = []

    for tx in transaction_docs:
        tx_type = tx.get("type")

        if tx_type == "mortgage_interest":
            mortgage = account_map.get(tx.get("mortgage_asset_id"))
            payer = account_map.get(tx.get("asset_id"))  # payer account
            if not mortgage or not payer:
                continue
            frequency = tx.get("frequency") or 1
            # Use the same annual_growth_rate field to carry interest for consistency with other tx
            annual_interest_rate = tx.get("annual_interest_rate", tx.get("annual_growth_rate", 0.0))
            interest_tx = MortgageInterestTransaction(
                tx.get("name", "Mortgage Interest"),
                mortgage,
                payer,
                annual_interest_rate,
                frequency,
                tx.get("start_month", 1),
                tx.get("start_year", 2024),
                tx.get("end_month", tx.get("start_month", 1)),
                tx.get("end_year", tx.get("start_year", 2024)),
            )
            mortgage_interest_transactions.append(interest_tx)
            continue

        account = account_map.get(tx.get("asset_id"))
        if not account:
            continue
        transaction = _create_transaction_instance(tx)
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

    account_map = {
        asset["id"]: Account(
            asset["name"],
            asset.get("annual_growth_rate", 0.0),
            asset.get("initial_balance", 0.0),
        )
        for asset in assets
    }

    account_transactions, mortgage_interest_transactions = _build_transactions(transactions, account_map)
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
            "net": entry["net"],
            "income_details": entry["income_details"],
            "expense_details": entry["expense_details"],
            "growth_details": entry["growth_details"],
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
