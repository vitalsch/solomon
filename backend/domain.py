from __future__ import annotations

from datetime import date
from typing import Dict, Iterable, List, Tuple


class Account:
    """Single asset or liability that compounds monthly and processes transactions."""

    def __init__(
        self,
        name: str,
        annual_growth_rate: float = 0.0,
        initial_balance: float = 0.0,
        start_year: int | None = None,
        start_month: int | None = None,
        end_year: int | None = None,
        end_month: int | None = None,
        asset_type: str | None = None,
        growth_schedule: list[dict] | None = None,
    ):
        self.name = name
        self.asset_type = asset_type
        self.base_annual_growth_rate = annual_growth_rate
        self.growth_schedule = growth_schedule or []
        self.set_growth_rate(annual_growth_rate)
        self.initial_balance = initial_balance
        self.balance = initial_balance
        self.start_year = start_year
        self.start_month = start_month
        self.end_year = end_year
        self.end_month = end_month

    def set_growth_rate(self, annual_rate: float) -> None:
        self.annual_growth_rate = annual_rate
        self.monthly_growth_rate = (1 + annual_rate) ** (1 / 12) - 1

    def reset_balance(self) -> None:
        self.balance = self.initial_balance

    def apply_growth(self) -> None:
        # Dynamische Wachstumsrate je nach Zeitfenster
        def _to_key(year: int | None, month: int | None):
            if year is None or month is None:
                return None
            return year * 100 + month

        def _in_window(key: int, start: int | None, end: int | None):
            if start is None:
                return True
            if key < start:
                return False
            if end is not None and key > end:
                return False
            return True

        current_key = _to_key(getattr(self, "_current_year", None), getattr(self, "_current_month", None))
        rate_to_use = self.base_annual_growth_rate
        if current_key is not None:
            for window in self.growth_schedule:
                start = window.get("start")
                end = window.get("end")
                rate = window.get("rate")
                if rate is not None and _in_window(current_key, start, end):
                    rate_to_use = rate
                    break
        self.set_growth_rate(rate_to_use)
        self.balance += self.balance * self.monthly_growth_rate

    def update_balance(self, amount: float) -> None:
        self.balance += amount

    def get_balance(self) -> float:
        return self.balance

    def is_active(self, current_month: int, current_year: int) -> bool:
        """Return True if the account is within its configured active window (inclusive)."""
        # store for growth schedule evaluation
        self._current_month = current_month
        self._current_year = current_year
        if self.start_year is not None and self.start_month is not None:
            starts_before_or_now = current_year > self.start_year or (
                current_year == self.start_year and current_month >= self.start_month
            )
            if not starts_before_or_now:
                return False
        if self.end_year is not None and self.end_month is not None:
            ends_after_or_now = current_year < self.end_year or (
                current_year == self.end_year and current_month <= self.end_month
            )
            if not ends_after_or_now:
                return False
        return True


class Transaction:
    """Base transaction object. Month and year use human readable indexing (1-12)."""

    def __init__(self, name: str, amount: float, month: int, year: int, internal: bool = False):
        self.name = name
        self.amount = amount
        self.month = month
        self.year = year
        self.internal = internal
        self.inflation_schedule = getattr(self, "inflation_schedule", [])

    def is_applicable(self, current_month: int, current_year: int) -> bool:
        return self.month == current_month and self.year == current_year

    def adjusted_amount(self, current_month: int, current_year: int) -> float:
        amt = self.amount
        if not self.inflation_schedule:
            return amt
        current_key = (current_year or 0) * 100 + (current_month or 0)
        for entry in self.inflation_schedule:
            start = entry.get("start")
            end = entry.get("end")
            pct = entry.get("pct")
            if pct is None:
                continue
            if start and current_key < start:
                continue
            if end is not None and current_key > end:
                continue
            amt = amt * (1 + pct)
            break
        return amt


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
        # Guard against missing/invalid frequency values coming from the DB
        self.frequency = max(1, frequency or 1)
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
        # Guard against missing/invalid frequency values
        self.frequency = max(1, frequency or 1)
        self.end_month = end_month
        self.end_year = end_year
        self.annual_interest_rate = annual_interest_rate
        self.rate_schedule = getattr(self, "rate_schedule", [])
        self._current_year = None
        self._current_month = None

    def _periodic_interest(self) -> float:
        # Choose rate from schedule if applicable
        periodic_rate = self.annual_interest_rate
        current_year = self._current_year or self.year
        current_month = self._current_month or self.month
        if self.rate_schedule:
            current_key = (current_year or 0) * 100 + (current_month or 0)
            for start, end, rate in self.rate_schedule:
                if start and current_key < start:
                    continue
                if end is not None and current_key > end:
                    continue
                if rate is not None:
                    periodic_rate = rate
                    break
        periodic_rate = periodic_rate * (self.frequency / 12)
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

        self._current_month = current_month
        self._current_year = current_year
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
    tax_account: Account | None = None,
) -> Tuple[AccountBalanceHistory, List[Tuple[date, float]], List[Dict]]:
    """Run monthly simulation returning per-account histories and total wealth."""

    def pick_tax_account(active_accounts: list[Account]) -> Account | None:
        # Prefer configured tax_account if active; otherwise fallback to first active account.
        if tax_account and tax_account in active_accounts:
            return tax_account
        if active_accounts:
            return active_accounts[0]
        return None

    for account in accounts:
        account.reset_balance()

    account_initialized = {account: False for account in accounts}
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
        monthly_tax = 0.0
        growth_details: List[Dict] = []
        income_details: List[Dict] = []
        expense_details: List[Dict] = []
        tax_details: List[Dict] = []

        # Apply growth and track it separately; collect active accounts for this month
        active_accounts: list[Account] = []
        for account in accounts:
            if not account.is_active(current_date.month, current_date.year):
                account.balance = 0.0
                continue
            active_accounts.append(account)
            if not account_initialized[account]:
                account.balance = account.initial_balance
                account_initialized[account] = True
            before_growth = account.get_balance()
            account.apply_growth()
            growth_amount = account.get_balance() - before_growth
            if growth_amount:
                monthly_growth += growth_amount
                growth_details.append({"name": account.name, "amount": growth_amount})

        effective_tax_account = pick_tax_account(active_accounts)

        # First process all standard transactions per account (excluding mortgage interest which depends on balances)
        for account in accounts:
            if account not in active_accounts:
                continue
            for transaction in account_transactions.get(account, []):
                if transaction.is_applicable(current_date.month, current_date.year):
                    applied_amount = transaction.adjusted_amount(current_date.month, current_date.year)
                    account.update_balance(applied_amount)
                    if getattr(transaction, "tax_effect", 0):
                        tax_effect_amount = getattr(transaction, "tax_effect")
                        target_account = effective_tax_account or account
                        target_account.update_balance(tax_effect_amount)
                        monthly_tax += tax_effect_amount
                        tax_details.append(
                            {
                                "name": transaction.name,
                                "amount": tax_effect_amount,
                                "account": target_account.name if target_account else account.name,
                            }
                        )
                    if getattr(transaction, "internal", False):
                        continue
                    amount = applied_amount
                    if amount >= 0:
                        monthly_income += amount
                        detail = {
                            "name": transaction.name,
                            "amount": amount,
                            "account": account.name,
                        }
                        if getattr(transaction, "tx_type", None):
                            detail["tx_type"] = getattr(transaction, "tx_type")
                        if getattr(transaction, "id", None):
                            detail["transaction_id"] = getattr(transaction, "id")
                        income_details.append(detail)
                    else:
                        monthly_expense += amount
                        detail = {
                            "name": transaction.name,
                            "amount": amount,
                            "account": account.name,
                        }
                        if getattr(transaction, "tx_type", None):
                            detail["tx_type"] = getattr(transaction, "tx_type")
                        if getattr(transaction, "id", None):
                            detail["transaction_id"] = getattr(transaction, "id")
                        expense_details.append(detail)

        # Then apply mortgage interest so it reflects the current mortgage balance for the month
        for interest_tx in mortgage_interest_transactions or []:
            if interest_tx.is_applicable(current_date.month, current_date.year):
                if not (
                    interest_tx.mortgage_account.is_active(current_date.month, current_date.year)
                    and interest_tx.pay_from_account.is_active(current_date.month, current_date.year)
                ):
                    continue
                interest_tx.pay_from_account.update_balance(interest_tx.amount)
                monthly_expense += interest_tx.amount
                expense_detail = {
                    "name": interest_tx.name,
                    "amount": interest_tx.amount,
                    "account": interest_tx.pay_from_account.name,
                    "tx_type": getattr(interest_tx, "tx_type", None) or "mortgage_interest",
                }
                if getattr(interest_tx, "id", None):
                    expense_detail["transaction_id"] = getattr(interest_tx, "id")
                expense_details.append(expense_detail)
                # Apply tax on mortgage interest if marked taxable
                if getattr(interest_tx, "taxable", False):
                    # Interest is a cost (negative); tax credit should be positive (reduces expense)
                    tax_rate = abs(getattr(interest_tx, "tax_rate", 0.0) or 0.0)
                    tax_effect = abs(interest_tx.amount) * tax_rate  # positive credit
                    target_account = effective_tax_account or interest_tx.pay_from_account
                    target_account.update_balance(tax_effect)
                    monthly_tax += tax_effect
                    tax_details.append(
                        {
                            "name": f"{interest_tx.name} Steuer",
                            "amount": tax_effect,
                            "account": target_account.name if target_account else interest_tx.pay_from_account.name,
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
                "taxes": monthly_tax,
                # Net cashflow excludes non-cash growth; includes taxes alongside income/expenses
                "net": monthly_income + monthly_expense + monthly_tax,
                "income_details": income_details,
                "expense_details": expense_details,
                "growth_details": growth_details,
                "tax_details": tax_details,
            }
        )
        if current_date.month == 12:
            current_date = date(current_date.year + 1, 1, 1)
        else:
            current_date = date(current_date.year, current_date.month + 1, 1)

    return account_balance_histories, total_wealth_history, cash_flow_history
