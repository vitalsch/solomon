from backend.domain import (
    Account,
    OneTimeTransaction,
    RegularTransaction,
    simulate_account_balances_and_total_wealth,
)

import matplotlib.pyplot as plt

# Initialize accounts and map transactions to specific accounts
# Initialize accounts
savings_account = Account('Savings Account', 0.0)  # Account with 0% annual growth
investment_portfolio = Account('Portfolio', 0.2)  # Another account with 30% annual growth
real_estate_portfolio = Account('Real Estate', 0.037)  # Another account with 3.7% annual growth. This growht rate reflects the long-term history.
debt = Account('Debt', 0)

monthly_income_gross = 17814
bonus_gross = 100000

salary_base = RegularTransaction(monthly_income_gross, 1, 2024, 12, 2050, 1, 0.02) # monthly CHF 16'444, incl. 13th months equivalent 17'814
salary_bonus = RegularTransaction(bonus_gross, 6, 2024, 12, 2050, 12, 0.00)
income_tax = RegularTransaction(-25000, 1, 2024, 12, 2050, 3, 0.02) # paid every quarter (12/3)
house_income = RegularTransaction(1000, 1, 2026, 12,2050, 1, 0) # house of Jasmin net of tax and interest rate

rent_1 = RegularTransaction(-3400, 1, 2024, 12, 2029, 1, 0.01)
#rent_2 = RegularTransaction(-5500, 1, 2034, 12, 2080, 1, 0.01)
utility = RegularTransaction(-2000, 1, 2024, 12, 2050, 1, 0.01)
health_insurance_vital = RegularTransaction(-574, 12, 2024, 12, 2080, 12, 0.05)
health_insurance_jasmin = RegularTransaction(-540, 1, 2024, 12, 2080, 1, 0.05)
health_insurance_viki = RegularTransaction(-183, 12, 2024, 12, 2080, 12, 0.05)
health_insurance_child2 = RegularTransaction(-183, 12, 2025, 1, 2080, 12, 0.05)
health_insurance_child3 = RegularTransaction(-183, 12, 2027, 1, 2080, 12, 0.05)
health_insurance_child4 = RegularTransaction(-183, 12, 2029, 1, 2080, 12, 0.05)
car_insurance = RegularTransaction(-3100, 1, 2024, 12, 2080, 12)
energy_car = RegularTransaction(-200, 1, 2024, 12, 2080, 1)
birthday_stella  = RegularTransaction(-500, 2, 2024, 2, 2040, 12)
christmas_stella = RegularTransaction(-500, 12, 2024, 12, 2040, 12)
vaccation_feb = RegularTransaction(-2000, 12, 2024, 12, 2050, 12)
vaccation_sep = RegularTransaction(-2000, 9, 2024, 9, 2050, 12)
vaccation_dec = RegularTransaction(-2000, 12, 2024, 12, 2050, 12)
donation = RegularTransaction(-3000, 12, 2024, 12, 2080, 1)
school_viki = RegularTransaction(-1500, 7, 2024, 6, 2050, 1)
house_insurance = RegularTransaction(-670, 1, 2024, 12, 2050, 1)
cloths = RegularTransaction(-6000, 1, 2024, 12, 2050, 12)

# buy a house
year = 2029
month = 1

max_house_price = 10000000
mortgage_house = (monthly_income_gross*13+bonus_gross)/3/0.05
house_price = mortgage_house/0.8
if house_price > max_house_price:
    house_price = max_house_price
    mortgage_house = house_price*0.8

equity_house = house_price*0.2
interest_rate = 0.025
maintenance_rate = 0.01
costs_yearly = ((mortgage_house*interest_rate)+(house_price*maintenance_rate))
eigenmietwert = house_price*0.7*0.035*0.25 # Eigenmietwert Berechnung: https://realadvisor.ch/de/blog/eigenmietwert-im-kanton-zurich

house_equity = OneTimeTransaction(-equity_house, month, year)
house_costs = RegularTransaction(-costs_yearly, month, year, 12, 2080, 12)
mortgage = OneTimeTransaction(-mortgage_house, month, year)
house_value = OneTimeTransaction(house_price, month, year)
tax_house = RegularTransaction(-eigenmietwert, month, year, 12, 2080, 12)

print('House price: ', house_price, 'Equity: ', equity_house, 'Mortgage: ', mortgage_house, 'Yearly costs: ', costs_yearly)


# make investments
deposit_1 = OneTimeTransaction(1300000, 5, 2024) # initial investment
deposit_2 = OneTimeTransaction(100000, 1, 2028)
withdrawl_2 = OneTimeTransaction(-100000, 1, 2028)
deposit_3 = OneTimeTransaction(100000, 1, 2032)
withdrawl_3 = OneTimeTransaction(-100000, 1, 2032)

# make regular disinvestment to cover cost of living
regular_transfer_pos = RegularTransaction(30000, 1, 2035, 1, 2050, 1)
regular_transfer_neg = RegularTransaction(-30000, 1, 2035, 1, 2050, 1)

# Map transactions to specific accounts
account_transactions = {
    savings_account: [
    # Income sources
    salary_base, salary_bonus, income_tax, house_income, 
    
    # housing/ rental expenses
    rent_1, house_insurance, house_costs, tax_house,

    # transportation
    energy_car, car_insurance, 

    # health insurance
    health_insurance_vital, health_insurance_jasmin, health_insurance_viki, health_insurance_child2, health_insurance_child3, health_insurance_child4, 

    # others (food, etc.)
    utility, school_viki, cloths,
    
    # presents and donations
    birthday_stella, christmas_stella, donation,

    # vacation and hobbies 
    vaccation_feb, vaccation_sep, vaccation_dec,

    # withdrawls
    withdrawl_2, withdrawl_3

    ],
    investment_portfolio: [deposit_1, deposit_2, deposit_3, house_equity],  # Different transactions for account2
    real_estate_portfolio: [house_value],
    debt: [mortgage]

}

# Run the simulation from January 2024 to XX.XXXX
account_balances, total_wealth = simulate_account_balances_and_total_wealth([savings_account, investment_portfolio, real_estate_portfolio, debt], account_transactions, 2024, 5, 2044, 9)

# Plotting each account's balance and the total wealth over time
import matplotlib.pyplot as plt
import numpy as np


dates = [date for date, _ in total_wealth]
accounts = list(account_balances.keys())

# Prepare data for stacked bar chart
stacked_balances = np.zeros(len(dates))
fig, ax = plt.subplots(figsize=(12, 6))

for account in accounts:
    balances = np.array([balance for _, balance in account_balances[account]])
    ax.bar(dates, balances, bottom=stacked_balances, label=account)
    stacked_balances += balances

# Plot total wealth as a line
total_balances = [wealth for _, wealth in total_wealth]
ax.plot(dates, total_balances, marker='x', color='green', label='Net Worth')

plt.title("Account Balances and Total Wealth Over Time")
plt.xlabel("Date")
plt.ylabel("Balance / Total Wealth")
plt.legend()
plt.grid(True)
plt.show()
