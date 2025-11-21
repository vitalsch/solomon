class Account {
    constructor(name, annualGrowthRate = 0.0) {
        this.initialBalance = 0;
        this.balance = 0;
        this.name = name;
        this.annualGrowthRate = annualGrowthRate;
        this.monthlyGrowthRate = Math.pow(1 + annualGrowthRate, 1 / 12) - 1;
    }

    resetBalance() {
        this.balance = this.initialBalance;
    }

    applyGrowth() {
        this.balance += this.balance * this.monthlyGrowthRate;
    }

    updateBalance(amount) {
        this.balance += amount;
    }

    getBalance() {
        return this.balance;
    }
}

class Transaction {
    constructor(name, amount, month, year) {
        this.name = name;
        this.amount = amount;
        this.month = month;
        this.year = year;
    }

    isApplicable(currentMonth, currentYear) {
        return this.month === currentMonth && this.year === currentYear;
    }
}

class RegularTransaction extends Transaction {
    constructor(name, amount, startMonth, startYear, endMonth, endYear, frequency, annualGrowthRate = 0.0) {
        super(name, amount, startMonth, startYear);
        this.endMonth = endMonth;
        this.endYear = endYear;
        this.frequency = frequency;
        this.monthlyGrowthRate = Math.pow(1 + annualGrowthRate, 1 / 12) - 1;
        this.originalAmount = amount;
    }

    getAmountForPeriod(currentMonth, currentYear) {
        const totalMonths = (currentYear - this.year) * 12 + (currentMonth - this.month);
        const periodsElapsed = Math.floor(totalMonths / this.frequency);
        const compoundedGrowth = Math.pow(1 + this.monthlyGrowthRate, periodsElapsed);
        return this.originalAmount * compoundedGrowth;
    }

    isApplicable(currentMonth, currentYear) {
        if ((currentYear > this.year || (currentYear === this.year && currentMonth >= this.month)) &&
            (currentYear < this.endYear || (currentYear === this.endYear && currentMonth <= this.endMonth))) {
            const monthsSinceStart = (currentYear - this.year) * 12 + (currentMonth - this.month);
            if (monthsSinceStart % this.frequency === 0) {
                this.amount = this.getAmountForPeriod(currentMonth, currentYear);
                return true;
            }
        }
        return false;
    }
}

class OneTimeTransaction extends Transaction {}

const simulateAccountBalancesAndTotalWealth = (accounts, accountTransactions, startYear, startMonth, endYear, endMonth) => {
    // Reset all account balances to their initial state
    accounts.forEach(account => account.resetBalance());

    const accountBalanceHistories = accounts.reduce((acc, account) => {
        acc[account.name] = [];
        return acc;
    }, {});
    const totalWealthHistory = [];
    let currentYear = startYear;
    let currentMonth = startMonth;

    while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
        let totalWealth = 0;
        accounts.forEach(account => {
            account.applyGrowth();
            (accountTransactions[account.name] || []).forEach(transaction => {
                if (transaction.isApplicable(currentMonth, currentYear)) {
                    account.updateBalance(transaction.amount);
                }
            });
            accountBalanceHistories[account.name].push([new Date(currentYear, currentMonth - 1), account.getBalance()]);
            totalWealth += account.getBalance();
        });
        totalWealthHistory.push([new Date(currentYear, currentMonth - 1), totalWealth]);

        if (currentMonth === 12) {
            currentYear += 1;
            currentMonth = 1;
        } else {
            currentMonth += 1;
        }
    }

    return { accountBalanceHistories, totalWealthHistory };
};

export { Account, RegularTransaction, OneTimeTransaction, simulateAccountBalancesAndTotalWealth };