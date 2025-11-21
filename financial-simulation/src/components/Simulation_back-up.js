import React, { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
} from 'chart.js';
import Account from './Account';
import TransactionForm from './TransactionForm';
import { Account as AccountClass, simulateAccountBalancesAndTotalWealth, RegularTransaction, OneTimeTransaction } from '../simulation';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

const Simulation = () => {
    const [accounts, setAccounts] = useState([]);
    const [accountTransactions, setAccountTransactions] = useState({});
    const [accountBalances, setAccountBalances] = useState([]);
    const [totalWealth, setTotalWealth] = useState([]);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountGrowthRate, setNewAccountGrowthRate] = useState('');
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [selectedTransaction, setSelectedTransaction] = useState(null);
    const [startDate, setStartDate] = useState('2024-05');
    const [endDate, setEndDate] = useState('2044-09');

    const handleAddAccount = () => {
        const newAccount = new AccountClass(newAccountName, parseFloat(newAccountGrowthRate) / 100);
        setAccounts([...accounts, newAccount]);
        setAccountTransactions({ ...accountTransactions, [newAccount.name]: [] });
        setNewAccountName('');
        setNewAccountGrowthRate('');
    };

    const handleUpdateAccount = (account, name, annualGrowthRate, monthlyGrowthRate) => {
        account.name = name;
        account.annualGrowthRate = annualGrowthRate;
        account.monthlyGrowthRate = monthlyGrowthRate;
        setAccounts([...accounts]);
    };

    const handleDeleteAccount = (account) => {
        const updatedAccounts = accounts.filter(a => a !== account);
        const { [account.name]: _, ...updatedTransactions } = accountTransactions;
        setAccounts(updatedAccounts);
        setAccountTransactions(updatedTransactions);
    };

    const handleAddTransaction = (account, transaction) => {
        const updatedTransactions = {
            ...accountTransactions,
            [account.name]: [...(accountTransactions[account.name] || []), transaction]
        };
        setAccountTransactions(updatedTransactions);
        setSelectedTransaction(null);
    };

    const handleUpdateTransaction = (account, oldTransaction, newTransaction) => {
        const updatedTransactions = {
            ...accountTransactions,
            [account.name]: accountTransactions[account.name].map(t => t === oldTransaction ? newTransaction : t)
        };
        setAccountTransactions(updatedTransactions);
        setSelectedTransaction(null);
    };

    const handleDeleteTransaction = (account, transaction) => {
        const updatedTransactions = {
            ...accountTransactions,
            [account.name]: accountTransactions[account.name].filter(t => t !== transaction)
        };
        setAccountTransactions(updatedTransactions);
    };

    const handleSimulate = () => {
        const [startYear, startMonth] = startDate.split('-').map(Number);
        const [endYear, endMonth] = endDate.split('-').map(Number);
        const { accountBalanceHistories, totalWealthHistory } = simulateAccountBalancesAndTotalWealth(accounts, accountTransactions, startYear, startMonth, endYear, endMonth);
        setAccountBalances(accountBalanceHistories);
        setTotalWealth(totalWealthHistory);
    };

    const getStackedData = (accountBalances) => {
        const labels = totalWealth.map(([date]) => date.toDateString());
        const datasets = accounts.map((account, index) => {
            const balances = accountBalances[account.name] || [];
            return {
                label: account.name,
                data: balances.map(([_, balance]) => balance),
                backgroundColor: getRandomColor(),
            };
        });

        return {
            labels,
            datasets
        };
    };

    const chartData = getStackedData(accountBalances);

    const chartOptions = {
        responsive: true,
        plugins: {
            legend: {
                position: 'top',
            },
            title: {
                display: true,
                text: 'Total Wealth Over Time',
            },
        },
        scales: {
            x: {
                stacked: true,
            },
            y: {
                stacked: true,
                ticks: {
                    callback: function(value) {
                        return value.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
                    }
                }
            },
        },
    };

    return (
        <div className="simulation">
            <h1>Financial Simulation</h1>
            <div>
                <input
                    type="text"
                    placeholder="Account Name"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                />
                <input
                    type="number"
                    placeholder="Annual Growth Rate (%)"
                    value={newAccountGrowthRate}
                    onChange={(e) => setNewAccountGrowthRate(e.target.value)}
                />
                <button onClick={handleAddAccount}>Add Account</button>
            </div>
            <div>
                <select onChange={(e) => setSelectedAccount(accounts.find(a => a.name === e.target.value))}>
                    <option value="">Select Account</option>
                    {accounts.map(account => (
                        <option key={account.name} value={account.name}>{account.name}</option>
                    ))}
                </select>
                {selectedAccount && (
                    <>
                        <TransactionForm
                            account={selectedAccount}
                            transaction={selectedTransaction}
                            addTransaction={handleAddTransaction}
                            updateTransaction={handleUpdateTransaction}
                        />
                        <ul>
                            {(accountTransactions[selectedAccount.name] || []).map((transaction, index) => (
                                <li key={index}>
                                    <span>{`Amount: ${transaction.amount}, Month: ${transaction.month}, Year: ${transaction.year}`}</span>
                                    <button onClick={() => setSelectedTransaction(transaction)}>Edit</button>
                                    <button onClick={() => handleDeleteTransaction(selectedAccount, transaction)}>Delete</button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
            <div>
                <input
                    type="month"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                />
                <input
                    type="month"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                />
                <button onClick={handleSimulate}>Simulate</button>
            </div>
            <div className="accounts">
                {accounts.map(account => (
                    <Account
                        key={account.name}
                        account={account}
                        updateAccount={handleUpdateAccount}
                        deleteAccount={handleDeleteAccount}
                    />
                ))}
            </div>
            <div className="total-wealth">
                <h2>Total Wealth Over Time</h2>
                <Bar data={chartData} options={chartOptions} />
            </div>
        </div>
    );
};

const getRandomColor = () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
};

export default Simulation;
