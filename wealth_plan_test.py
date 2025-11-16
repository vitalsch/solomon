import pandas as pd
import datetime

# Sample dataset (my table)
data = {
    "asset_name": ["investment_portfolio", "savings_account", "labour_contract", "house"],
    "asset_type": ["investment_portfolio", "bank_account", "contract", "real_estate"],
    "asset_value_current": [2050000, 36000, 0, 1000000],
    "purchase_month": [1, 1, 1, 1],
    "purchase_year": [2025, 2025, 2025, 2036],
    "sell-by_month": [None, None, 1, None],
    "sell-by_year": [None, None, 2050, None],
    "from_account": ["investment_portfolio", "savings_account", None, "savings_account"],
    "to_account": ["investment_portfolio", "savings_account", "savings_account", "house"],
    "appreciation_start_month": [1, 1, None, 1],
    "appreciation_start_year": [2025, 2025, None, 2036],
    "appreciation_end_month": [None, None, None, None],
    "appreciation_end_year": [None, None, None, None],
    "appreciation_period": [None, None, None, None],
    "appreciation_amount_fix": [None, None, None, None],
    "appreciation_rate_yearly": [0.2, 0, None, 0.04],
    "income_start_month": [1, 1, 1, 1],
    "income_start_year": [2025, 2025, 2025, 2036],
    "income_end_month": [None, None, 9, None],
    "income_end_year": [None, None, 2050, None],
    "income_period": [None, None, None, None],
    "income_amount_fix": [None, None, 10000, None],
    "income_amount_fix_annual_indexation_rate": [0, 0, 0.02, 0],
    "income_yield_yearly": [0.0034, 0.0025, None, None],
    "income_frequency": ["quarterly", "yearly", "monthly", None],
    "income_from_account": [None, None, None, None],
    "income_to_account": ["savings_account", "savings_account", "savings_account", "house"],
}

# Create DataFrame
df = pd.DataFrame(data)

# Initialize the transaction table
transactions = []

# Set user-defined end date
user_defined_end_month = 12
user_defined_end_year = 2050
end_date = datetime.date(user_defined_end_year, user_defined_end_month, 1)

# Fill missing end dates
for index, row in df.iterrows():
    if pd.isna(row['appreciation_end_year']):
        df.at[index, 'appreciation_end_year'] = user_defined_end_year
        df.at[index, 'appreciation_end_month'] = user_defined_end_month
    if pd.isna(row['income_end_year']):
        df.at[index, 'income_end_year'] = user_defined_end_year
        df.at[index, 'income_end_month'] = user_defined_end_month

# Function to append transactions
def add_transaction(date, account_from, account_to, value, description):
    transactions.append({
        'date': date,
        'from_account': account_from,
        'to_account': account_to,
        'value': value,
        'description': description
    })

# Helper function to determine the next income date
def get_next_income_date(start_date, frequency):
    if frequency == "monthly":
        next_date = start_date + datetime.timedelta(days=30)
    elif frequency == "quarterly":
        next_date = start_date + datetime.timedelta(days=90)
    elif frequency == "half-yearly":
        next_date = start_date + datetime.timedelta(days=180)
    elif frequency == "yearly":
        next_date = datetime.date(start_date.year + 1, start_date.month, 1)
    else:
        next_date = None
    return next_date

# Step 1: Insert assets as initial transactions
for _, row in df.iterrows():
    purchase_date = datetime.date(int(row['purchase_year']), int(row['purchase_month']), 1)
    value = row['asset_value_current']
    add_transaction(
        purchase_date,
        row['from_account'],
        row['to_account'],
        value,
        f"Initial transaction for {row['asset_name']}"
    )

# Step 2: Process monthly appreciation and income
current_date = datetime.date(2025, 1, 1)  # Start date (earliest purchase date in data)

while current_date <= end_date:
    for _, row in df.iterrows():
        asset_value = row['asset_value_current']

        # Process appreciation (update asset value without logging it as a transaction)
        if not pd.isna(row['appreciation_start_year']):
            app_start = datetime.date(int(row['appreciation_start_year']), int(row['appreciation_start_month']), 1)
            app_end = datetime.date(int(row['appreciation_end_year']), int(row['appreciation_end_month']), 1)
            if app_start <= current_date <= app_end:
                if not pd.isna(row['appreciation_amount_fix']):
                    appreciation = row['appreciation_amount_fix']
                else:
                    monthly_growth_rate = (1 + row['appreciation_rate_yearly']) ** (1 / 12) - 1
                    appreciation = asset_value * monthly_growth_rate
                asset_value += appreciation

        # Process income
        if not pd.isna(row['income_start_year']):
            income_start = datetime.date(int(row['income_start_year']), int(row['income_start_month']), 1)
            income_end = datetime.date(int(row['income_end_year']), int(row['income_end_month']), 1)

            income_frequency = row['income_frequency']
            next_income_date = income_start

            while next_income_date is not None and income_end is not None and next_income_date <= income_end and next_income_date <= current_date:
                if next_income_date == current_date:
                    if not pd.isna(row['income_amount_fix']):
                        # Adjust fixed income for indexation rate if applicable
                        indexation_rate = row['income_amount_fix_annual_indexation_rate']
                        periods_since_start = (current_date.year - income_start.year) * 12 + (current_date.month - income_start.month)
                        income = row['income_amount_fix'] * ((1 + indexation_rate) ** (periods_since_start / 12))
                    else:
                        monthly_income_rate = (1 + row['income_yield_yearly']) ** (1 / 12) - 1
                        income = asset_value * monthly_income_rate
                    add_transaction(
                        current_date,
                        row['income_from_account'],
                        row['income_to_account'],
                        income,
                        f"Income for {row['asset_name']}"
                    )
                next_income_date = get_next_income_date(next_income_date, income_frequency)

    # Increment the current date by one month
    if current_date.month == 12:
        current_date = datetime.date(current_date.year + 1, 1, 1)
    else:
        current_date = datetime.date(current_date.year, current_date.month + 1, 1)

# Step 3: Convert transactions to a DataFrame
transactions_df = pd.DataFrame(transactions)