from __future__ import annotations

from datetime import date
from typing import Dict, Iterable, List, Tuple


class Account:
    """Single asset or liability that compounds monthly and processes transactions."""

    def __init__(self, name: str, annual_growth_rate: float = 0.0, initial_balance: float = 0.0):
        self.name = name
        self.annual_growth_rate = annual_growth_rate
        self.monthly_growth_rate = (1 + annual_growth_rate) ** (1 / 12) - 1
        self.initial_balance = initial_balance
        self.balance = initial_balance

    def reset_balance(self) -> None:
        self.balance = self.initial_balance

    def apply_growth(self) -> None:
        self.balance += self.balance * self.monthly_growth_rate

    def update_balance(self, amount: float) -> None:
        self.balance += amount

    def get_balance(self) -> float:
        return self.balance


class Transaction:
    """Base transaction object. Month and year use human readable indexing (1-12)."""

    def __init__(self, name: str, amount: float, month: int, year: int, internal: bool = False):
        self.name = name
        self.amount = amount
        self.month = month
        self.year = year
        self.internal = internal

    def is_applicable(self, current_month: int, current_year: int) -> bool:
        return self.month == current_month and self.year == current_year


class RegularTransaction(Transaction):
    """Transaction that repeats every `frequency` months and can include indexation."""

    def __init__(
        self,
        name: str,
        amount: float,
        start_month: int,
        start_year: int,
        end_month: int,
        end_year: int,
        frequency: int,
        annual_growth_rate: float = 0.0,
    ):
        super().__init__(name, amount, start_month, start_year)
        self.end_month = end_month
        self.end_year = end_year
        self.frequency = frequency
        self.annual_growth_rate = annual_growth_rate
        self.monthly_growth_rate = (1 + annual_growth_rate) ** (1 / 12) - 1
        self.original_amount = amount

    def get_amount_for_period(self, current_month: int, current_year: int) -> float:
        total_months = (current_year - self.year) * 12 + (current_month - self.month)
        periods_elapsed = total_months // self.frequency
        compounded_growth = (1 + self.monthly_growth_rate) ** periods_elapsed
        return self.original_amount * compounded_growth

    def is_applicable(self, current_month: int, current_year: int) -> bool:
        starts_before_or_now = current_year > self.year or (
            current_year == self.year and current_month >= self.month
        )
        ends_after_or_now = current_year < self.end_year or (
            current_year == self.end_year and current_month <= self.end_month
        )

        if starts_before_or_now and ends_after_or_now:
            months_since_start = (current_year - self.year) * 12 + (current_month - self.month)
            if months_since_start % self.frequency == 0:
                self.amount = self.get_amount_for_period(current_month, current_year)
                return True
        return False


class OneTimeTransaction(Transaction):
    """Single occurrence transaction, inherits base behaviour."""


class MortgageInterestTransaction(Transaction):
    """Interest payment calculated from a mortgage account balance."""

    def __init__(
        self,
        name: str,
        mortgage_account: Account,
        pay_from_account: Account,
        annual_interest_rate: float,
        frequency: int,
        start_month: int,
        start_year: int,
        end_month: int,
        end_year: int,
    ):
        super().__init__(name, 0.0, start_month, start_year)
        self.mortgage_account = mortgage_account
        self.pay_from_account = pay_from_account
        self.frequency = frequency
        self.end_month = end_month
        self.end_year = end_year
        self.annual_interest_rate = annual_interest_rate

    def _periodic_interest(self) -> float:
        periodic_rate = self.annual_interest_rate * (self.frequency / 12)
        balance = self.mortgage_account.get_balance()
        return abs(balance) * periodic_rate

    def is_applicable(self, current_month: int, current_year: int) -> bool:
        starts_before_or_now = current_year > self.year or (
            current_year == self.year and current_month >= self.month
        )
        ends_after_or_now = current_year < self.end_year or (
            current_year == self.end_year and current_month <= self.end_month
        )

        if not (starts_before_or_now and ends_after_or_now):
            return False

        months_since_start = (current_year - self.year) * 12 + (current_month - self.month)
        if months_since_start % self.frequency != 0:
            return False

        self.amount = -self._periodic_interest()
        return True


AccountTransactions = Dict[Account, Iterable[Transaction]]
AccountBalanceHistory = Dict[Account, List[Tuple[date, float]]]


def simulate_account_balances_and_total_wealth(
    accounts: Iterable[Account],
    account_transactions: AccountTransactions,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    mortgage_interest_transactions: List[MortgageInterestTransaction] | None = None,
) -> Tuple[AccountBalanceHistory, List[Tuple[date, float]], List[Dict]]:
    """Run monthly simulation returning per-account histories and total wealth."""

    for account in accounts:
        account.reset_balance()

    account_balance_histories: AccountBalanceHistory = {account: [] for account in accounts}
    total_wealth_history: List[Tuple[date, float]] = []
    cash_flow_history: List[Dict] = []
    current_date = date(start_year, start_month, 1)

    while current_date.year < end_year or (
        current_date.year == end_year and current_date.month <= end_month
    ):
        total_wealth = 0.0
        monthly_income = 0.0
        monthly_expense = 0.0
        monthly_growth = 0.0
        growth_details: List[Dict] = []
        income_details: List[Dict] = []
        expense_details: List[Dict] = []

        # Apply growth and track it separately
        for account in accounts:
            before_growth = account.get_balance()
            account.apply_growth()
            growth_amount = account.get_balance() - before_growth
            if growth_amount:
                monthly_growth += growth_amount
                growth_details.append({"name": account.name, "amount": growth_amount})

        # First process all standard transactions per account (excluding mortgage interest which depends on balances)
        for account in accounts:
            for transaction in account_transactions.get(account, []):
                if transaction.is_applicable(current_date.month, current_date.year):
                    account.update_balance(transaction.amount)
                    if getattr(transaction, "internal", False):
                        continue
                    amount = transaction.amount
                    if amount >= 0:
                        monthly_income += amount
                        income_details.append(
                            {
                                "name": transaction.name,
                                "amount": amount,
                                "account": account.name,
                            }
                        )
                    else:
                        monthly_expense += amount
                        expense_details.append(
                            {
                                "name": transaction.name,
                                "amount": amount,
                                "account": account.name,
                            }
                        )

        # Then apply mortgage interest so it reflects the current mortgage balance for the month
        for interest_tx in mortgage_interest_transactions or []:
            if interest_tx.is_applicable(current_date.month, current_date.year):
                interest_tx.pay_from_account.update_balance(interest_tx.amount)
                monthly_expense += interest_tx.amount
                expense_details.append(
                    {
                        "name": interest_tx.name,
                        "amount": interest_tx.amount,
                        "account": interest_tx.pay_from_account.name,
                    }
                )

        for account in accounts:
            account_balance_histories[account].append((current_date, account.get_balance()))
            total_wealth += account.get_balance()

        total_wealth_history.append((current_date, total_wealth))
        cash_flow_history.append(
            {
                "date": current_date,
                "income": monthly_income,
                "expenses": monthly_expense,
                "growth": monthly_growth,
                "net": monthly_income + monthly_expense + monthly_growth,
                "income_details": income_details,
                "expense_details": expense_details,
                "growth_details": growth_details,
            }
        )
        if current_date.month == 12:
            current_date = date(current_date.year + 1, 1, 1)
        else:
            current_date = date(current_date.year, current_date.month + 1, 1)

    return account_balance_histories, total_wealth_history, cash_flow_history
