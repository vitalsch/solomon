import React from 'react';

const Transaction = ({ amount, month, year }) => {
    return (
        <div className="transaction">
            <p>{`${month}/${year} - Amount: ${amount} CHF`}</p>
        </div>
    );
};

export default Transaction;