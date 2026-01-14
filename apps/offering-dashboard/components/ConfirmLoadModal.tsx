
import React from 'react';
import { Button, ProgressBar } from 'react-bootstrap';

interface ConfirmLoadModalProps {
    show: boolean;
    loading: boolean;
    loadedCount: number;
    totalCount: number;
    onCancel: () => void;
    onConfirm: () => void;
}

export const ConfirmLoadModal: React.FC<ConfirmLoadModalProps> = ({
    show,
    loading,
    loadedCount,
    totalCount,
    onCancel,
    onConfirm
}) => {
    // We use a custom modal structure to match the existing one, 
    // or we could use React-Bootstrap Modal. 
    // The existing one used manual div classes "modal fade show" etc.
    // To minimize styling drift, I will replicate the existing structure 
    // but ensure standard behavior.

    // However, sticking to the exact existing JSX is safest for visual consistency.

    return (
        <div
            className={`modal fade ${show ? 'show' : ''}`}
            style={{ display: show ? 'block' : 'none', backgroundColor: 'rgba(0,0,0,0.5)' }}
            tabIndex={-1}
        // Ensure the modal itself doesn't steal focus in a weird way, 
        // but the button inside should get it.
        >
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content bg-dark text-white">
                    <div className="modal-header border-secondary">
                        <h5 className="modal-title">{loading ? 'Loading Transactions...' : 'Load Transactions?'}</h5>
                        {!loading && (
                            <button type="button" className="btn-close btn-close-white" onClick={onCancel}></button>
                        )}
                    </div>
                    <div className="modal-body">
                        {loading ? (
                            <div className="text-center py-3">
                                <ProgressBar
                                    now={(loadedCount / (totalCount || 1)) * 100}
                                    label={`${loadedCount} / ${totalCount || '...'}`}
                                    animated
                                    variant="success"
                                    className="mb-2"
                                />
                                <small className="text-muted">Please wait while transactions are retrieved.</small>
                            </div>
                        ) : (
                            <>
                                <p>This view requires loading full transaction history.</p>
                                <p>Do you want to proceed?</p>
                            </>
                        )}
                    </div>
                    {!loading && (
                        <div className="modal-footer border-secondary">
                            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                            <Button
                                variant="primary"
                                onClick={onConfirm}
                                autoFocus // Fix: Focus this button automatically
                            >
                                Load Data
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
