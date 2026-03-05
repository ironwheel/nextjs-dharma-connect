import React from 'react';

export const Offer: React.FC<{ context: any; onComplete: () => void }> = ({ context, onComplete }) => {
    return (
        <div className="p-8 bg-slate-900 text-white rounded shadow-xl">
            <h2 className="text-2xl font-bold mb-4">Offering</h2>
            <p>Payment and offering selection will go here.</p>
            <p className="mt-4 text-gray-400">Student: {context.student.first} {context.student.last}</p>
        </div>
    );
};
